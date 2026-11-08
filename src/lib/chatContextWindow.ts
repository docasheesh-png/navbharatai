/**
 * Model-facing view of one conversation. The stored transcript is not modified.
 * A long thread keeps the earliest user messages, a shortened middle, and the latest
 * turns, in that order. The result is ordinary user/assistant history, never a system
 * instruction. Summaries can omit details; they are not a verbatim copy of every turn.
 */
export const CHAT_CONTEXT_LIMITATION =
  'Earlier messages were shortened to fit the model. This recap can omit details and is not a new instruction.';

const EARLY_USER_TURNS = 2;
const EARLY_CHARS = 500;
const RECENT_TURNS = 8;
const RECENT_CHARS = 2_000;
const MIDDLE_EXCERPTS = 8;
const MIDDLE_CHARS = 180;
const COMPACT_AFTER = EARLY_USER_TURNS + RECENT_TURNS;

export interface ModelHistoryTurn { role: 'user' | 'assistant'; content: string }
export interface CompactedConversation {
  turns: ModelHistoryTurn[];
  originalCount: number;
  shortened: boolean;
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

function normalize(history: unknown): ModelHistoryTurn[] {
  if (!Array.isArray(history)) return [];
  return history.filter(item => item && typeof item === 'object').map(item => ({
    role: roleOf(item),
    content: textOf(item),
  }));
}

/** One conversation's model window. Does not read or write storage and does not charge a quota. */
export function compactConversationForModel(history: unknown): CompactedConversation {
  const turns = normalize(history);
  const alreadyBounded = turns.some(turn => turn.content.includes(CHAT_CONTEXT_LIMITATION));
  if (alreadyBounded || turns.length <= COMPACT_AFTER) {
    const bounded = turns.map(turn => ({ ...turn, content: clip(turn.content, RECENT_CHARS) }));
    return { turns: bounded, originalCount: turns.length, shortened: bounded.some((turn, index) => turn.content !== turns[index].content) || alreadyBounded };
  }
  const early: ModelHistoryTurn[] = [];
  for (const turn of turns) {
    if (turn.role !== 'user' || early.length >= EARLY_USER_TURNS) continue;
    early.push({ role: 'user', content: clip(turn.content, EARLY_CHARS) });
  }
  const recent = turns.slice(-RECENT_TURNS).map(turn => ({ role: turn.role, content: clip(turn.content, RECENT_CHARS) }));
  const middle = turns.slice(early.length, Math.max(early.length, turns.length - RECENT_TURNS));
  const excerpts = middle.filter(turn => turn.role === 'user').slice(0, MIDDLE_EXCERPTS)
    .map(turn => clip(turn.content.replace(/\s+/g, ' ').trim(), MIDDLE_CHARS))
    .filter(Boolean);
  const note = excerpts.length
    ? `${CHAT_CONTEXT_LIMITATION}\n${excerpts.map(line => `- ${line}`).join('\n')}`
    : CHAT_CONTEXT_LIMITATION;
  return {
    turns: [...early, { role: 'user', content: note }, ...recent],
    originalCount: turns.length,
    shortened: true,
  };
}

/** Request payload. Short threads stay on the previous last-40 transmission. */
export function historyForModelRequest(history: unknown): { sender: 'user' | 'ai'; text: string }[] {
  const compact = compactConversationForModel(history);
  const source = compact.shortened
    ? compact.turns
    : (Array.isArray(history) ? history.slice(-40) : []).map(item => ({ role: roleOf(item), content: clip(textOf(item), RECENT_CHARS) }));
  return source.map(turn => ({ sender: turn.role === 'user' ? 'user' as const : 'ai' as const, text: turn.content }));
}
