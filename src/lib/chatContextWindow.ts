/**
 * Model-facing view of ONE conversation, and the ONLY place a chat history is bounded.
 * The stored transcript is never modified.
 *
 * 🔴 WHY THIS IS A BUDGET AND NOT A TURN COUNT (admin 2026-11-25, verbatim: "memory —
 * navbharatai chat me user ki chat jyada se jyada yad rahe, aisa na ho kuch 10-15 message
 * ke baad starting me text bhul jaye!").
 *
 * The reported forgetting was not one bug. THREE separate places each cut the same history to
 * their own turn count, none of them aware of the other two, and the cuts multiplied:
 *   1. this file — `COMPACT_AFTER = 10`, so from the 11th message on, the whole middle of the
 *      conversation collapsed into eight 180-character bullets of the USER's lines only and every
 *      assistant turn in the middle was dropped outright;
 *   2. `FreeChain.trimHistory` — `FREE_CHAIN_HISTORY_TURNS = 6`, which threw away whatever
 *      survived step 1 and sent the model two opening user turns plus the last four turns;
 *   3. `UniversalAIRouter.buildPrompt` — its own last-15-turns-at-1500-characters rule.
 * Ten to fifteen messages is exactly where those three meet, which is why the user saw the
 * opening of the conversation disappear at that point and not later.
 *
 * A TURN COUNT IS THE WRONG UNIT, and that is the class behind all three. What a provider charges
 * for and limits is CHARACTERS (tokens), not turns, so a cap of six turns spends the same on six
 * long turns as on sixty short ones — and an ordinary chat turn is 200–400 characters. Budgeting by
 * characters therefore remembers several times more conversation at the SAME worst-case cost. All
 * three call sites now come here, so a future change to the window happens once (fourth absolute
 * rule, step 2: fix the class, centralize the drifted copies).
 *
 * What a window keeps, in order: the opening turns (where people state the facts they expect to be
 * remembered), a shortened middle that keeps BOTH sides of the conversation, and the recent turns
 * whole. A recap line is added ONLY when turns genuinely had to be dropped. The result is ordinary
 * user/assistant history, never a system instruction.
 */
export const CHAT_CONTEXT_LIMITATION =
  'Earlier messages were shortened to fit the model. This recap can omit details and is not a new instruction.';

/** Transport budget: what the client may send for one conversation. ~12k tokens of history. */
export const CHAT_MODEL_WINDOW_CHARS = 48_000;
/** A window never exceeds this many turns, so no later per-turn-count bound can clip its opening. */
export const CHAT_MODEL_WINDOW_TURNS = 120;

/** A recent turn survives up to this many characters — the server's own per-turn bound
 *  (`CHAT_MAX_HISTORY_TURN_CHARS`), so a turn is never clipped twice to two different lengths. */
export const CHAT_MODEL_TURN_CHARS = 4_000;

const EARLY_TURNS = 6;
const EARLY_CHARS = 2_000;
const RECENT_TURNS = 30;
const RECENT_CHARS = CHAT_MODEL_TURN_CHARS;
const MIDDLE_CHARS = 600;
const EXCERPT_CHARS = 180;
const MAX_EXCERPTS = 12;
/** Worst-case size of the recap turn, so the window can budget for it before building it. */
const RECAP_RESERVE = CHAT_CONTEXT_LIMITATION.length + MAX_EXCERPTS * (EXCERPT_CHARS + 3) + 1;

export interface ModelHistoryTurn { role: 'user' | 'assistant'; content: string }
export interface CompactedConversation {
  turns: ModelHistoryTurn[];
  originalCount: number;
  shortened: boolean;
}
export interface ChatWindowOptions {
  /** Character budget for the whole window. Defaults to `CHAT_MODEL_WINDOW_CHARS`. */
  budgetChars?: number;
  /** Hard turn ceiling. Defaults to `CHAT_MODEL_WINDOW_TURNS`. */
  maxTurns?: number;
}

function textOf(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const row = value as { text?: unknown; content?: unknown };
  return typeof row.text === 'string' ? row.text : typeof row.content === 'string' ? row.content : '';
}

function roleOf(value: unknown): 'user' | 'assistant' {
  if (!value || typeof value !== 'object') return 'assistant';
  const row = value as { sender?: unknown; role?: unknown };
  return row.sender === 'user' || row.role === 'user' ? 'user' : 'assistant';
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function sizeOf(turns: ModelHistoryTurn[]): number {
  return turns.reduce((total, turn) => total + turn.content.length, 0);
}

function normalize(history: unknown): ModelHistoryTurn[] {
  if (!Array.isArray(history)) return [];
  return history.filter(item => item && typeof item === 'object').map(item => ({
    role: roleOf(item),
    content: textOf(item),
  }));
}

function recapTurn(dropped: ModelHistoryTurn[]): ModelHistoryTurn {
  const excerpts = dropped.filter(turn => turn.role === 'user')
    .slice(0, MAX_EXCERPTS)
    .map(turn => clip(turn.content.replace(/\s+/g, ' ').trim(), EXCERPT_CHARS))
    .filter(Boolean);
  return {
    role: 'user',
    content: excerpts.length
      ? `${CHAT_CONTEXT_LIMITATION}\n${excerpts.map(line => `- ${line}`).join('\n')}`
      : CHAT_CONTEXT_LIMITATION,
  };
}

/**
 * One conversation's model window. Does not read or write storage and does not charge a quota.
 * PURE: the array handed in is never mutated.
 */
export function compactConversationForModel(history: unknown, options: ChatWindowOptions = {}): CompactedConversation {
  const budget = Math.max(1_000, options.budgetChars ?? CHAT_MODEL_WINDOW_CHARS);
  const maxTurns = Math.max(EARLY_TURNS + 1, options.maxTurns ?? CHAT_MODEL_WINDOW_TURNS);
  const turns = normalize(history);
  const originalCount = turns.length;

  // Nothing is shortened while the whole conversation fits. This is the case the report was about:
  // at ten, fifteen or forty ordinary messages the model now receives every word that was said.
  const whole = turns.map(turn => ({ role: turn.role, content: clip(turn.content, RECENT_CHARS) }));
  const clipped = whole.some((turn, index) => turn.content !== turns[index].content);
  if (whole.length <= maxTurns && sizeOf(whole) <= budget) {
    return { turns: whole, originalCount, shortened: clipped };
  }

  // Over budget. Keep the opening and the recent turns whole, shorten the middle, and drop from the
  // oldest end of the middle only while still over budget — the middle keeps BOTH roles, because an
  // answer the user is replying to is part of what they expect to be remembered.
  const headCount = Math.min(EARLY_TURNS, Math.max(0, turns.length - RECENT_TURNS));
  const head = turns.slice(0, headCount).map(turn => ({ role: turn.role, content: clip(turn.content, EARLY_CHARS) }));
  const tail = turns.slice(Math.max(headCount, turns.length - RECENT_TURNS))
    .map(turn => ({ role: turn.role, content: clip(turn.content, RECENT_CHARS) }));
  const middleSource = turns.slice(headCount, Math.max(headCount, turns.length - RECENT_TURNS));
  const middle = middleSource.map(turn => ({ role: turn.role, content: clip(turn.content.replace(/\s+/g, ' ').trim(), MIDDLE_CHARS) }));

  // The recap turn has a size of its own, and a window that forgot to count it came out OVER budget —
  // which made the window unstable over its own output: the next pass re-compacted an already-compacted
  // history and wrapped the old recap inside a new one. The reserve is its worst case, counted up front.
  const dropped: ModelHistoryTurn[] = [];
  const over = (extra: number) =>
    sizeOf(head) + sizeOf(middle) + sizeOf(tail) + extra > budget
    || head.length + middle.length + tail.length + (dropped.length ? 1 : 0) > maxTurns;
  while (middle.length && over(RECAP_RESERVE)) {
    dropped.push(middleSource[dropped.length]);
    middle.shift();
  }
  // Turns long enough that the opening and the recent window alone overflow the budget. The oldest of
  // the recent turns go into the recap, newest-last, because the latest turn is the one being answered.
  while (tail.length > 1 && over(dropped.length ? RECAP_RESERVE : 0)) {
    dropped.push(tail[0]);
    tail.shift();
  }
  const recap = dropped.length ? [recapTurn(dropped)] : [];
  const window = [...head, ...recap, ...middle, ...tail];
  // Last resort: one turn on its own is larger than the whole budget. Clip from the oldest kept turn
  // forward so the invariant "a window never exceeds its budget" holds for every possible input.
  let excess = sizeOf(window) - budget;
  for (let index = 0; excess > 0 && index < window.length - 1; index += 1) {
    const keep = Math.max(0, window[index].content.length - excess);
    excess -= window[index].content.length - keep;
    window[index] = { ...window[index], content: clip(window[index].content, keep) };
  }
  if (excess > 0 && window.length) {
    const last = window[window.length - 1];
    window[window.length - 1] = { ...last, content: clip(last.content, Math.max(1, last.content.length - excess)) };
  }
  return { turns: window.filter(turn => turn.content.length), originalCount, shortened: true };
}

/**
 * Request payload for one conversation, in the client's own `{ sender, text }` shape.
 * Re-running this over its own output is stable: a window that already fits is returned as it is,
 * so the recap line is never duplicated and the opening facts never shift.
 */
export function historyForModelRequest(history: unknown, options: ChatWindowOptions = {}): { sender: 'user' | 'ai'; text: string }[] {
  return compactConversationForModel(history, options).turns
    .map(turn => ({ sender: turn.role === 'user' ? 'user' as const : 'ai' as const, text: turn.content }));
}
