// AgentV3 (Vargen 3.0) — rebuild a persisted build's chat history on reload (D7, option (a)).
//
// When the user reopens v3.0 after a refresh/reconnect, the backend ConversationStore (D7)
// returns the persisted build transcript. This pure module turns that transcript into the wire
// events needed to RE-DISPLAY the chat — only the architect narration (assistant text); the
// generated files come back via the existing git/restore path, not from the transcript (the
// admin-chosen "chat + git-restore" approach). Replaying these events through the existing,
// tested agentV3Reducer rebuilds the narration feed + workspaceId with no new reducer logic.

import type { AgentV3WireEvent } from './agentV3Types';

/** The shape returned by GET /api/agentv3/conversations/:id (mirror of the server record). */
export interface PersistedConversation {
  id: string;
  workspaceId: string;
  title: string;
  status: 'running' | 'complete' | 'stopped' | 'error';
  messages: unknown[];
  billedUsd?: number;
  updatedAt?: number;
}

/** Extract the visible text from a Claude message's `content` (a string or a block array). */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Rebuild the wire events that re-display a persisted build's chat history. Emits a `workspace`
 * event (so History → restore works), one `narration` line per assistant turn, and — for a build
 * that already finished — a `done` event so the UI is not stuck showing "building". A build whose
 * status is still `running` is left open (no `done`) so the user can Resume it.
 */
export function conversationToEvents(conv: PersistedConversation): AgentV3WireEvent[] {
  const events: AgentV3WireEvent[] = [];
  if (conv.workspaceId) events.push({ type: 'workspace', workspaceId: conv.workspaceId, ts: 0 });
  const msgs = conv.messages ?? [];
  // Timestamp by TRANSCRIPT POSITION (idx+1), not by assistant-only counter, so restored agent
  // narration interleaves correctly with the restored USER messages (which use the same scheme).
  msgs.forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'assistant') return;
    const text = messageText(msg.content).trim();
    if (text) events.push({ type: 'narration', agent: 'architect', text, ts: idx + 1 });
  });
  if (conv.status === 'complete' || conv.status === 'stopped' || conv.status === 'error') {
    events.push({
      type: 'done',
      ok: conv.status === 'complete',
      summary: `Reloaded a previous build (${conv.status}).`,
      ts: msgs.length + 1,
    });
  }
  return events;
}

/**
 * The build prompt persisted in the transcript is AUGMENTED server-side (a leading "Language: …"
 * instruction, recalled-lesson blocks, attachment text, an "Approved plan:" suffix). Strip those so
 * the restored user bubble shows what the user actually typed, not the engine's internal wrapping.
 */
export function cleanRestoredUserPrompt(text: string): string {
  let t = typeof text === 'string' ? text : '';
  // The real prompt always sits AFTER the last "\n\n---\n\n" separator (lessons / attachment blocks).
  const sep = '\n\n---\n\n';
  const last = t.lastIndexOf(sep);
  if (last !== -1) t = t.slice(last + sep.length);
  // Drop a leading single-line "Language: …" instruction paragraph.
  t = t.replace(/^Language:[^\n]*\n\n/, '');
  // Drop a trailing "Approved plan: …" block appended after plan approval.
  t = t.replace(/\n\nApproved plan:[\s\S]*$/, '');
  return t.trim();
}

/**
 * Rebuild the user's OWN chat messages from a persisted conversation (the part conversationToEvents
 * deliberately omits). Returns them as user-role chat rows with transcript-position timestamps so the
 * UI can merge them with the restored agent narration in the right order. Tool-result "user" turns
 * (no visible text) are skipped — only real prompts are kept.
 */
export function conversationToUserMessages(conv: PersistedConversation): Array<{ role: 'user'; text: string; ts: number }> {
  const out: Array<{ role: 'user'; text: string; ts: number }> = [];
  const msgs = conv.messages ?? [];
  msgs.forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'user') return;
    const text = cleanRestoredUserPrompt(messageText(msg.content).trim());
    if (text) out.push({ role: 'user', text, ts: idx + 1 });
  });
  return out;
}

/**
 * HISTORY REBUILD (single source of truth) — legacy-thread continuity for sessions that straddle
 * the cutover. The server ConversationStore is now the ONLY transcript writer, but sessions from
 * before the cutover have their thread only in the (frozen, read-only) client-side chat_sessions
 * copy. When such a session is CONTINUED after the cutover, the server record holds only the new
 * turns — so on open, the frozen legacy turns must be shown BEFORE the server transcript.
 *
 * Safety rule (duplication is worse than omission): the legacy copy is prepended ONLY when it is
 * provably DISJOINT from the server transcript — i.e. no legacy user message matches any server
 * user message. Old BUILD sessions have overlapping copies in both stores (the server has
 * persisted build turns since the stable-id fix), so they overlap → return [] → server-only
 * (exactly today's behavior). Returned messages get NEGATIVE transcript-position timestamps so
 * they sort before the server-restored messages (which use positions 1..N).
 */
export function legacyPrependMessages(
  legacy: Array<{ text: string; isUser: boolean }>,
  serverUserTexts: string[],
): Array<{ role: 'user' | 'agent'; text: string; ts: number }> {
  const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');
  const serverSet = new Set(serverUserTexts.map(clean).filter(Boolean));
  if (serverSet.size === 0) return []; // empty server thread → the caller's legacy-fallback path owns this
  const kept = legacy.filter((m) => clean(m.text));
  if (kept.length === 0) return [];
  const overlaps = kept.some((m) => m.isUser && serverSet.has(clean(m.text)));
  if (overlaps) return [];
  return kept.map((m, idx) => ({ role: m.isUser ? ('user' as const) : ('agent' as const), text: m.text, ts: idx - kept.length }));
}

// ── Session-history menu (the 3-line hamburger menu's dropdown) ──────────────────────────────
//
// Was a flat list of raw truncated first-prompt text with no structure — indistinguishable from
// "old text history". This groups saved builds into a real SESSION history (Claude/ChatGPT-style):
// date-bucketed, each item showing its build status (running/built/failed/stopped), not just text.

/** Visual status dot + label for a saved build session, keyed by ConversationStatus. Pure. */
const SESSION_STATUS_META: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  running: { dot: 'bg-indigo-400', label: 'Building…', pulse: true },
  complete: { dot: 'bg-emerald-500', label: 'Built' },
  error: { dot: 'bg-red-500', label: 'Failed' },
  stopped: { dot: 'bg-zinc-500', label: 'Stopped' },
};
export function sessionStatusMeta(status?: string): { dot: string; label: string; pulse?: boolean } {
  return SESSION_STATUS_META[status || ''] ?? { dot: 'bg-zinc-600', label: '' };
}

/** Date-bucket label for a session-history group header (Today / Yesterday / Previous 7 Days / Older). Pure. */
export function sessionDateBucket(ts: number, now: number): string {
  const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = startOfDay(now);
  const day = startOfDay(ts);
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Previous 7 days';
  if (diffDays <= 30) return 'Previous 30 days';
  return 'Older';
}

/** Group saved sessions (already sorted newest-first by the API) into ordered date buckets. Pure. */
export function groupSessionsByDate<T extends { updatedAt?: number }>(items: T[], now: number): Array<{ label: string; items: T[] }> {
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const label = sessionDateBucket(item.updatedAt ?? now, now);
    const list = buckets.get(label);
    if (list) list.push(item); else buckets.set(label, [item]);
  }
  return order.filter((label) => buckets.has(label)).map((label) => ({ label, items: buckets.get(label)! }));
}
