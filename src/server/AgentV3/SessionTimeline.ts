// AgentV3 — Eternal sessions (history enhancement, admin order 2026-07-03):
// "chahe 10 saal baad chat kholo — wahi memory, wahi UX."
//
// A LIVE v3.0 session shows far more than prose: collapsed Claude-style action rows
// ("Created 33 files +812 -0", "Ran `npm install`"), per-file diffs, terminal output, the
// working-indicator step log, and the cost/token/health footer. All of that was derived from
// TRANSIENT wire events and vanished on reopen — a restored session was a bare prose transcript.
//
// This module makes the evidence layer durable and bounded:
//   • createTimelineRecorder() — taps the build's outgoing event stream and keeps a COMPACT,
//     size-capped timeline (tool calls/results, file changes, diffs, agent spawns, preview) plus
//     the terminal facts (billing, tokens, build health). Persisted once per build turn onto the
//     conversation record; the client replays it through the SAME reducer on reopen.
//   • compactMessagesForPersist() — bounds every persisted transcript turn (strips base64
//     screenshots, truncates giant tool payloads) so no single turn can exceed the store's
//     per-write limit. One oversized turn used to stall persistence PERMANENTLY from that point
//     (the fresh slice only grew, every retry failed) — the AgentRunner pairs this with a
//     skip-poison fallback so the transcript and final status always land.
//   • sessionRecallContextLine() — the AI-side of "same memory": a bounded recall context from
//     the project's episodic memory, injected into the plain-chat prompt so "what were we
//     building?" is answered from the real session history even years later.

// ── Compact timeline events (the durable form of the live wire events) ─────────────────────────

export type TimelineEvent =
  | { t: 'tool_call'; id: string; tool: string; agent: string; ts: number; input?: Record<string, string> }
  | { t: 'tool_result'; id: string; ok: boolean; summary: string; agent: string; ts: number }
  | { t: 'file'; path: string; kind: 'create' | 'modify' | 'delete'; agent: string; ts: number }
  | { t: 'agent'; agent: string; task: string; ts: number }
  | { t: 'preview'; url: string; ts: number }
  | { t: 'diff'; path: string; patch: string; ts: number };

/**
 * Terminal facts of a finished build turn — restores the done-footer (₹ / tokens / health).
 * A `type` (not interface) so it structurally satisfies the store's Record<string, unknown>
 * finalState field without a manual index signature.
 */
export type TimelineFinalState = {
  ok?: boolean | null;
  billedUsd?: number;
  billedInr?: number;
  tokens?: number;
  buildHealth?: unknown;
  /** Honesty marker: how many recorded events were dropped to fit the storage budget. */
  timelineDropped?: number;
};

// Bounds — tuned so a heavy build's full evidence layer stays well under Firestore's 1MB/doc.
const MAX_EVENTS = 500;
const MAX_DIFF_PATCH_CHARS = 16_000;
const MAX_SUMMARY_CHARS = 400;
const MAX_TASK_CHARS = 200;
const MAX_INPUT_VALUE_CHARS = 300;
const SERIALIZED_BUDGET_CHARS = 300_000;
const DIFF_TRUNCATION_NOTE = '\n… [diff truncated for storage]';

const truncate = (s: string, max: number, note = '…'): string =>
  s.length > max ? s.slice(0, max) + note : s;

/** The few input fields the client needs to redraw a tool row (command/path/pattern), compacted. */
function compactToolInput(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ['command', 'path', 'pattern', 'query', 'name', 'url']) {
    const v = src[key];
    if (typeof v === 'string' && v) out[key] = truncate(v, MAX_INPUT_VALUE_CHARS);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface TimelineRecorder {
  /** Feed every outgoing wire event through this (a pass-through tap on `send`). */
  record(event: unknown): void;
  /** The compacted, budget-enforced timeline for this build turn. */
  events(): TimelineEvent[];
  /** Terminal facts captured from the done/result events (null until one arrived). */
  final(): TimelineFinalState | null;
}

/**
 * Collects the durable timeline from the live event stream. Pure accumulation — never throws,
 * never blocks the stream (record() swallows anything malformed). Kinds NOT recorded, on purpose:
 * narration/stream_delta/thinking (already persisted as transcript messages), todo_updated
 * (durable via PLAN_STATE memory), checkpoint (durable via CheckpointStore), workspace,
 * permission_request/error (transient), files_restored (a restore echo, not build work).
 */
export function createTimelineRecorder(): TimelineRecorder {
  const events: TimelineEvent[] = [];
  let dropped = 0;
  let final: TimelineFinalState | null = null;

  const push = (e: TimelineEvent): void => {
    events.push(e);
    if (events.length > MAX_EVENTS) {
      // Drop the OLDEST — the tail of a long build (preview link, final diffs, closing
      // tool_results) is what a reopened session needs most. Dropping newest also orphaned
      // in-flight tool_calls, freezing a spinner into the restored session forever.
      events.shift();
      dropped++;
    }
  };

  return {
    record(event: unknown): void {
      try {
        if (!event || typeof event !== 'object') return;
        const e = event as { type?: unknown; ts?: unknown } & Record<string, unknown>;
        const ts = typeof e.ts === 'number' ? e.ts : Date.now();
        switch (e.type) {
          case 'tool_call':
            if (typeof e.callId === 'string' && typeof e.tool === 'string') {
              push({ t: 'tool_call', id: e.callId, tool: e.tool, agent: String(e.agent ?? 'architect'), ts, input: compactToolInput(e.input) });
            }
            return;
          case 'tool_result':
            if (typeof e.callId === 'string') {
              push({ t: 'tool_result', id: e.callId, ok: e.ok !== false, summary: truncate(String(e.summary ?? ''), MAX_SUMMARY_CHARS), agent: String(e.agent ?? 'architect'), ts });
            }
            return;
          case 'file_changed': {
            const change = e.change as { path?: unknown; kind?: unknown } | undefined;
            if (change && typeof change.path === 'string') {
              const kind = change.kind === 'modify' || change.kind === 'delete' ? change.kind : 'create';
              push({ t: 'file', path: change.path, kind, agent: String(e.agent ?? 'architect'), ts });
            }
            return;
          }
          case 'agent_spawned':
            if (typeof e.agent === 'string') {
              push({ t: 'agent', agent: e.agent, task: truncate(String(e.task ?? ''), MAX_TASK_CHARS), ts });
            }
            return;
          case 'preview':
            if (typeof e.url === 'string' && e.url) push({ t: 'preview', url: e.url, ts });
            return;
          case 'diff': {
            const diff = e.diff as { path?: unknown; patch?: unknown } | undefined;
            if (diff && typeof diff.path === 'string' && typeof diff.patch === 'string') {
              push({ t: 'diff', path: diff.path, patch: truncate(diff.patch, MAX_DIFF_PATCH_CHARS, DIFF_TRUNCATION_NOTE), ts });
            }
            return;
          }
          case 'done':
            final = { ...(final ?? {}), ok: e.ok !== false, ...(e.readiness !== undefined ? { buildHealth: e.readiness } : {}) };
            return;
          case 'result':
            final = {
              ...(final ?? {}),
              ok: e.ok !== false,
              ...(typeof e.billedUsd === 'number' ? { billedUsd: e.billedUsd } : {}),
              ...(typeof e.billedInr === 'number' ? { billedInr: e.billedInr } : {}),
              ...(typeof e.tokens === 'number' ? { tokens: e.tokens } : {}),
            };
            return;
          default:
            return;
        }
      } catch {
        /* the recorder must never disturb the live stream */
      }
    },

    events(): TimelineEvent[] {
      // Enforce the total serialized budget: first shrink the largest diff patches (the only
      // unbounded-ish payload), then — if somehow still over — drop oldest events, counting drops.
      const out = events.slice();
      let size = JSON.stringify(out).length;
      if (size > SERIALIZED_BUDGET_CHARS) {
        const diffs = out
          .map((e, i) => ({ e, i }))
          .filter((x): x is { e: Extract<TimelineEvent, { t: 'diff' }>; i: number } => x.e.t === 'diff')
          .sort((a, b) => b.e.patch.length - a.e.patch.length);
        for (const { e, i } of diffs) {
          if (size <= SERIALIZED_BUDGET_CHARS) break;
          const shrunk = { ...e, patch: truncate(e.patch, 500, DIFF_TRUNCATION_NOTE) };
          size -= e.patch.length - shrunk.patch.length;
          out[i] = shrunk;
        }
        while (size > SERIALIZED_BUDGET_CHARS && out.length > 0) {
          const removed = out.shift()!;
          size -= JSON.stringify(removed).length + 1;
          dropped++;
        }
      }
      return out;
    },

    final(): TimelineFinalState | null {
      if (final === null && dropped === 0) return null;
      const f: TimelineFinalState = final ?? {};
      // ALWAYS fully populated: Firestore set(..., {merge:true}) deep-merges map fields, so a
      // PARTIAL object here would let a previous turn's billing/tokens/buildHealth silently leak
      // into a later failed turn's restored footer (production-only staleness the in-memory
      // store's replace semantics would never show). Full population makes merge ≡ replace.
      return {
        ok: f.ok ?? null,
        billedUsd: f.billedUsd ?? 0,
        billedInr: f.billedInr ?? 0,
        tokens: f.tokens ?? 0,
        buildHealth: f.buildHealth ?? null,
        timelineDropped: dropped,
      };
    },
  };
}

// ── Transcript compaction (durability: no turn may exceed the store's per-write limit) ─────────

export interface CompactOptions {
  /** Second-chance mode after a failed write: much smaller thresholds. */
  aggressive?: boolean;
}

const OMITTED_IMAGE_NOTE = '[screenshot omitted from the saved transcript]';

interface CompactThresholds {
  toolUseString: number;
  toolResultString: number;
  textBlock: number;
  plainString: number;
}

const NORMAL: CompactThresholds = { toolUseString: 8_000, toolResultString: 20_000, textBlock: 40_000, plainString: 60_000 };
const AGGRESSIVE: CompactThresholds = { toolUseString: 800, toolResultString: 2_000, textBlock: 4_000, plainString: 6_000 };

const STORAGE_NOTE = '… [truncated for storage]';

/** Recursively bound every string inside a tool_use input (covers whole-file write payloads). */
function compactDeep(value: unknown, maxString: number): unknown {
  if (typeof value === 'string') return truncate(value, maxString, STORAGE_NOTE);
  if (Array.isArray(value)) return value.map((v) => compactDeep(v, maxString));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = compactDeep(v, maxString);
    return out;
  }
  return value;
}

function compactBlock(block: unknown, t: CompactThresholds): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as Record<string, unknown>;
  switch (b.type) {
    case 'image':
      // Base64 screenshots are the single largest payload (hundreds of KB each) and are never
      // rendered from the saved transcript — replace with an honest placeholder.
      return { type: 'text', text: OMITTED_IMAGE_NOTE };
    case 'tool_use':
      return { ...b, input: compactDeep(b.input, t.toolUseString) };
    case 'tool_result': {
      const content = b.content;
      if (typeof content === 'string') return { ...b, content: truncate(content, t.toolResultString, STORAGE_NOTE) };
      if (Array.isArray(content)) return { ...b, content: content.map((c) => compactBlock(c, t)) };
      return b;
    }
    case 'text':
      return typeof b.text === 'string' ? { ...b, text: truncate(b.text, t.textBlock, STORAGE_NOTE) } : b;
    case 'thinking':
      return typeof b.thinking === 'string' ? { ...b, thinking: truncate(b.thinking, t.toolUseString, STORAGE_NOTE) } : b;
    default:
      return b;
  }
}

/**
 * Bound a slice of transcript messages for persistence. NEVER mutates the input — the same
 * message objects are the live model conversation. Returns fresh message/block wrappers
 * (untouched leaf values are shared, large strings are replaced with truncated copies).
 */
export function compactMessagesForPersist(messages: unknown[], opts: CompactOptions = {}): unknown[] {
  const t = opts.aggressive ? AGGRESSIVE : NORMAL;
  return messages.map((m) => {
    if (!m || typeof m !== 'object') return m;
    const msg = m as { role?: unknown; content?: unknown };
    if (typeof msg.content === 'string') {
      return { ...msg, content: truncate(msg.content, t.plainString, STORAGE_NOTE) };
    }
    if (Array.isArray(msg.content)) {
      return { ...msg, content: msg.content.map((b) => compactBlock(b, t)) };
    }
    return m;
  });
}

// ── Model-side transcript compaction (A1 — the "233KB prompt → cheap-floor timeout" root cause) ──
//
// compactMessagesForPersist above bounds the transcript for STORAGE only. The LIVE `messages` array
// sent to the model each turn was never bounded — every read_file / bash result stayed verbatim, so a
// build that reads a few large files (a 2500-line routes.ts) grew the per-turn prompt to 200KB+. The
// cheap floor (GLM/KIMI over OpenAI-compatible) then TIMED OUT on the payload (real report: GLM 6×,
// KIMI 2×), and every turn fell to Claude anyway — slow + costly, the Mitrify autopsy's struggle half.
//
// This compacts a COPY for the model only (never mutates `messages`, so persistence + audit keep full
// fidelity): the last `keepRecentMessages` messages are sent VERBATIM (in-flight work untouched), and
// OLDER, large tool_result payloads are head+tail truncated with an honest "re-read the file" note —
// the model has already ACTED on those results; if it needs the full content again it calls read_file.
// tool_use↔tool_result id pairing is always preserved (blocks are never dropped, only their content
// strings shrink), so the Anthropic API never rejects an orphaned result. Pure + deterministic:
// a message truncated at one turn truncates IDENTICALLY at the next (stable cache prefix), and it is a
// natural no-op on a small build (nothing old is large).

export interface ModelCompactOptions {
  /** How many of the most-recent messages to send verbatim (default 6 ≈ the last ~3 turns). */
  keepRecentMessages?: number;
  /** Truncate an OLD tool_result's string content beyond this many chars (default 2000). */
  maxOldToolResultChars?: number;
  /**
   * VAJRA V4-2 (SMRITI discipline) — HARD ceiling on EVERY tool_result payload, INCLUDING the recent
   * verbatim window (default 40000 chars ≈ ~10k tokens). Root cause it kills: A1 compaction trimmed
   * only OLD results, so a few huge read_file/glob/grep dumps in the last 6 messages alone grew a
   * reviewer's prompt to 2,204,128 tokens — past every provider window (report 2026-07-07). No single
   * tool dump can now exceed this; the model re-reads specific lines if it needs the full content.
   * Only tool_result content is capped — assistant reasoning and the latest screenshot pass through.
   */
  maxAnyToolResultChars?: number;
}

const MODEL_OMITTED_IMAGE = '[screenshot from an earlier turn omitted to keep context small — it was already analyzed; take a new screenshot if you need to see the page again]';

/** Keep the head (70%) and tail (30%) of an oversized old result, with an honest gap note. */
function headTailTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const headLen = Math.floor(max * 0.7);
  const tailLen = max - headLen;
  const dropped = s.length - headLen - tailLen;
  return (
    s.slice(0, headLen) +
    `\n… [${dropped} chars from an earlier tool result trimmed to keep the prompt small — call read_file / the tool again if you need the full content] …\n` +
    s.slice(s.length - tailLen)
  );
}

/** Compact ONE block of an OLD message for the model: shrink big tool_result payloads + drop images. */
function compactOldBlockForModel(block: unknown, maxToolResultChars: number): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as Record<string, unknown>;
  if (b.type === 'image') return { type: 'text', text: MODEL_OMITTED_IMAGE };
  if (b.type === 'tool_result') {
    const content = b.content;
    if (typeof content === 'string') {
      const trimmed = headTailTruncate(content, maxToolResultChars);
      return trimmed === content ? b : { ...b, content: trimmed };
    }
    if (Array.isArray(content)) {
      let changed = false;
      const nc = content.map((c) => { const r = compactOldBlockForModel(c, maxToolResultChars); if (r !== c) changed = true; return r; });
      return changed ? { ...b, content: nc } : b;
    }
  }
  return b;
}

/**
 * Cap ONLY tool_result payloads in a RECENT message (VAJRA V4-2) — assistant reasoning and the latest
 * screenshot/image pass through untouched, so in-flight work keeps full fidelity; only a runaway tool
 * dump (a huge read_file/glob/grep) is bounded so it can't blow the context window on its own.
 */
function capRecentToolResults(block: unknown, max: number): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as Record<string, unknown>;
  if (b.type !== 'tool_result') return b; // images + assistant text stay verbatim in the recent window
  const content = b.content;
  if (typeof content === 'string') {
    const t = headTailTruncate(content, max);
    return t === content ? b : { ...b, content: t };
  }
  if (Array.isArray(content)) {
    let changed = false;
    const nc = content.map((c) => {
      const cc = c as Record<string, unknown>;
      if (cc && cc.type === 'text' && typeof cc.text === 'string' && cc.text.length > max) { changed = true; return { ...cc, text: headTailTruncate(cc.text, max) }; }
      return c;
    });
    return changed ? { ...b, content: nc } : b;
  }
  return b;
}

/**
 * Bound the transcript SENT TO THE MODEL (not stored): recent messages keep reasoning + images
 * verbatim but their tool_result dumps are hard-capped (V4-2); older large tool_results are head+tail
 * truncated more aggressively. Never mutates the input. Pure + deterministic.
 */
export function compactTranscriptForModel(messages: unknown[], opts: ModelCompactOptions = {}): unknown[] {
  const keepRecent = Math.max(0, opts.keepRecentMessages ?? 6);
  const maxChars = Math.max(200, opts.maxOldToolResultChars ?? 2_000);
  const maxAny = Math.max(maxChars, opts.maxAnyToolResultChars ?? 40_000); // recent cap ≥ old cap
  let anyChanged = false;
  const out = messages.map((m, i) => {
    if (!m || typeof m !== 'object') return m;
    const msg = m as { role?: unknown; content?: unknown };
    if (!Array.isArray(msg.content)) return m; // plain-string turns (the user's request) are small — keep
    const recent = i >= messages.length - keepRecent;
    let changed = false;
    const content = msg.content.map((b) => {
      // Recent → cap only tool_result dumps at the generous ceiling; old → aggressive trim + drop images.
      const r = recent ? capRecentToolResults(b, maxAny) : compactOldBlockForModel(b, maxChars);
      if (r !== b) changed = true;
      return r;
    });
    if (!changed) return m;
    anyChanged = true;
    return { ...msg, content };
  });
  return anyChanged ? out : messages; // stable identity when nothing shrank (cache prefix + no-op guarantee)
}

// ── AI-side recall (the "same memory" half of the order) ───────────────────────────────────────

export interface RecallEpisode {
  ts: number;
  kind: string;
  text: string;
}

/**
 * A bounded recall context for the plain-chat lane, built from the project's durable episodic
 * memory (requests + notes survive instance recycles and years of absence). Empty string when
 * there is nothing to recall — so a brand-new session stays cacheable. Pure.
 */
export function sessionRecallContextLine(episodes: RecallEpisode[], maxChars = 1_200): string {
  if (!Array.isArray(episodes) || episodes.length === 0) return '';
  const requests = episodes.filter((e) => e.kind === 'request' && e.text.trim()).slice(-4);
  const notes = episodes
    .filter((e) => e.kind === 'note' && e.text.trim() && !e.text.startsWith('PLAN_STATE'))
    .slice(-2);
  if (requests.length === 0 && notes.length === 0) return '';
  const lines: string[] = ['\n\nSESSION MEMORY (durable — survives any gap since the user was last here):'];
  for (const r of requests) lines.push(`- The user previously asked: ${truncate(r.text.replace(/\s+/g, ' ').trim(), 160)}`);
  for (const n of notes) lines.push(`- Project note: ${truncate(n.text.replace(/\s+/g, ' ').trim(), 200)}`);
  lines.push(
    'Use this to answer questions about what was built or discussed in this session so far. ' +
      'If asked "what were we building?", answer from these facts — never guess beyond them.',
  );
  return truncate(lines.join('\n'), maxChars, '…');
}
