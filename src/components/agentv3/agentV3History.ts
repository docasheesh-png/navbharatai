// AgentV3 (Vargen 3.0) — rebuild a persisted build's chat history on reload (D7, option (a)).
//
// When the user reopens v5.0 after a refresh/reconnect, the backend ConversationStore (D7)
// returns the persisted build transcript. This pure module turns that transcript into the wire
// events needed to RE-DISPLAY the chat — only the architect narration (assistant text); the
// generated files come back via the existing git/restore path, not from the transcript (the
// admin-chosen "chat + git-restore" approach). Replaying these events through the existing,
// tested agentV3Reducer rebuilds the narration feed + workspaceId with no new reducer logic.

import type { AgentV3WireEvent, AgentRole } from './agentV3Types';

/** The shape returned by GET /api/agentv3/conversations/:id (mirror of the server record). */
export interface PersistedConversation {
  id: string;
  workspaceId: string;
  title: string;
  status: 'running' | 'complete' | 'stopped' | 'error';
  messages: unknown[];
  billedUsd?: number;
  updatedAt?: number;
  /** Eternal sessions: the durable evidence layer (compact server TimelineEvents) — see below. */
  timeline?: unknown[];
  /** Terminal facts of the last finished build turn (billedInr/tokens/buildHealth), plus the compact
   *  build report embedded WITH the chat so the "Build report" always returns on reopen (never a
   *  separate doc that can 404 after a long build). */
  finalState?: { ok?: boolean; billedUsd?: number; billedInr?: number; tokens?: number; walletTokensDebited?: number; buildHealth?: unknown; report?: unknown };
  /** The framework this session builds with (restored so follow-up builds stay correct). */
  framework?: string;
  /** Cumulative token usage (older field, still returned by the server). */
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * AP-3 (cross-restart resume) — a build was cut off before it could finish iff its durable status is
 * still `'running'` and it has real content. The AgentRunner patches a TERMINAL status (complete/error/
 * stopped) at every normal exit, so a reopened conversation still marked `'running'` was killed mid-build
 * (a server restart/crash). The caller additionally requires no live build (serverBuildRunning false)
 * before offering Continue — so a build genuinely still running elsewhere is never mislabelled. Pure.
 */
export function isUnfinishedBuild(conv: Pick<PersistedConversation, 'status' | 'messages'>): boolean {
  return conv.status === 'running' && Array.isArray(conv.messages) && conv.messages.length > 0;
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

/** The timestamp a persisted message restores with: its real wall-clock time when the server
 * stamped one (eternal sessions), else its transcript POSITION (idx+1 — legacy records). */
function restoredTs(m: unknown, idx: number): number {
  const ts = (m as { ts?: unknown } | null)?.ts;
  return typeof ts === 'number' && ts > 0 ? ts : idx + 1;
}

/** Map one persisted timeline event (compact server shape) back to its live wire event. */
function timelineToWireEvent(e: unknown): AgentV3WireEvent | null {
  if (!e || typeof e !== 'object') return null;
  const t = e as Record<string, unknown>;
  const ts = typeof t.ts === 'number' ? t.ts : 0;
  // Persisted agent names are plain strings; unknown ones degrade to 'architect' rendering-wise
  // (the reducer only uses the role as a map key + label, so this cast is display-safe).
  const agent = (typeof t.agent === 'string' && t.agent ? t.agent : 'architect') as AgentRole;
  switch (t.t) {
    case 'tool_call':
      if (typeof t.id !== 'string' || typeof t.tool !== 'string') return null;
      return { type: 'tool_call', agent, tool: t.tool, input: t.input ?? {}, callId: t.id, ts };
    case 'tool_result':
      if (typeof t.id !== 'string') return null;
      return { type: 'tool_result', agent, callId: t.id, ok: t.ok !== false, summary: String(t.summary ?? ''), ts };
    case 'file': {
      if (typeof t.path !== 'string') return null;
      const kind = t.kind === 'modify' || t.kind === 'delete' ? t.kind : 'create';
      return { type: 'file_changed', agent, change: { path: t.path, kind }, ts };
    }
    case 'agent':
      if (typeof t.agent !== 'string') return null;
      return { type: 'agent_spawned', agent, task: String(t.task ?? ''), ts };
    case 'preview':
      if (typeof t.url !== 'string' || !t.url) return null;
      return { type: 'preview', url: t.url, ts };
    case 'diff':
      if (typeof t.path !== 'string' || typeof t.patch !== 'string') return null;
      return { type: 'diff', agent, diff: { path: t.path, patch: t.patch }, ts };
    default:
      return null;
  }
}

/**
 * Rebuild the wire events that re-display a persisted build's chat history. Emits a `workspace`
 * event (so History → restore works), one `narration` line per assistant turn, the durable
 * TIMELINE events (eternal sessions — tool calls/results, file changes, diffs, preview), and —
 * for a build that already finished — `done` (+ a synthetic `result` carrying the durable
 * billing/token facts) so the reopened session shows the SAME action rows, Diff/Terminal tabs
 * and done-footer it showed live. A `running` build is left open (no `done`) for Resume.
 */
export function conversationToEvents(conv: PersistedConversation): AgentV3WireEvent[] {
  const events: AgentV3WireEvent[] = [];
  if (conv.workspaceId) events.push({ type: 'workspace', workspaceId: conv.workspaceId, ts: 0 });
  const msgs = conv.messages ?? [];
  const replayed: AgentV3WireEvent[] = [];
  msgs.forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'assistant') return;
    const text = messageText(msg.content).trim();
    if (text) replayed.push({ type: 'narration', agent: 'architect', text, ts: restoredTs(m, idx) });
  });
  for (const raw of conv.timeline ?? []) {
    const wire = timelineToWireEvent(raw);
    if (wire) replayed.push(wire);
  }
  // Close ORPHANED tool calls (their result fell past the recorder's cap, or the build died
  // mid-tool): an unmatched replayed tool_call keeps its activity entry active forever — a
  // spinner running on every reopen of a session that finished long ago. Synthesize a closing
  // result whose ok mirrors the build outcome; a still-`running` build is left open on purpose.
  if (conv.status !== 'running') {
    const resolved = new Set(
      replayed.filter((e) => e.type === 'tool_result').map((e) => (e as { callId: string }).callId),
    );
    for (const e of replayed.slice()) {
      if (e.type !== 'tool_call') continue;
      if (resolved.has(e.callId)) continue;
      replayed.push({ type: 'tool_result', agent: e.agent, callId: e.callId, ok: conv.status === 'complete', summary: '', ts: e.ts + 1 });
    }
  }
  // Chronological replay: the reducer's activity feed keeps array order, and the chat timeline
  // groups activity between prose by timestamp — both need the merged stream sorted by ts. Every
  // event pushed into `replayed` is a ts-bearing kind (never `result`), so `ts` is always present.
  const tsOf = (e: AgentV3WireEvent): number => ('ts' in e ? e.ts : 0);
  replayed.sort((a, b) => tsOf(a) - tsOf(b));
  events.push(...replayed);
  const lastTs = replayed.reduce((max, e) => Math.max(max, tsOf(e)), msgs.length);
  if (conv.status === 'complete' || conv.status === 'stopped' || conv.status === 'error') {
    const final = conv.finalState ?? {};
    const buildHealth = final.buildHealth as { score: number; ready: boolean; blockers: string[]; warnings: string[] } | undefined;
    const summary = `Reloaded a previous build (${conv.status}).`;
    const ok = conv.status === 'complete';
    events.push({ type: 'done', ok, summary, ts: lastTs + 1, ...(buildHealth ? { readiness: buildHealth } : {}) });
    // Synthetic `result` restores the done-footer from durable facts (₹ badge, token badge). The
    // data always survived on the record — it was simply dropped here before eternal sessions.
    const billedUsd = typeof final.billedUsd === 'number' ? final.billedUsd : (conv.billedUsd ?? 0);
    const billedInr = typeof final.billedInr === 'number' ? final.billedInr : undefined;
    const tokens = typeof final.tokens === 'number'
      ? final.tokens
      : (conv.usage ? (conv.usage.inputTokens ?? 0) + (conv.usage.outputTokens ?? 0) : 0);
    // The compact build report embedded WITH the chat (finalState.report) — rehydrated into the
    // synthetic `result` so `state.diagnostics` is populated on reopen and the "Build report"
    // download/copy works offline (no separate fetch that can 404). Fire the result whenever a report
    // exists, even for a zero-billing turn, so the report never gets dropped for a cheap build.
    const report = final.report;
    // Billing Phase 1 — the wallet deduction is a durable fact of the turn; the live BALANCE is
    // deliberately NOT restored (it would be stale the moment another build or recharge happens).
    const walletTokensDebited = typeof final.walletTokensDebited === 'number' ? final.walletTokensDebited : 0;
    if (billedUsd > 0 || (billedInr ?? 0) > 0 || tokens > 0 || report) {
      events.push({
        type: 'result', ok, summary, steps: 0, billedUsd,
        ...(billedInr !== undefined ? { billedInr } : {}),
        ...(tokens > 0 ? { tokens } : {}),
        ...(walletTokensDebited > 0 ? { walletTokensDebited } : {}),
        ...(report ? { diagnostics: report } : {}),
      });
    }
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
 * ENGINE-INJECTED user turns: prompts the ENGINE pushed into the transcript as `role:'user'` to
 * steer the model — never typed by the human. Restoring them as user bubbles shows internal
 * instructions as "things the user said" (a transcript-integrity defect found in the reopen
 * audit). Matched by their stable leading text.
 */
const ENGINE_INJECTED_USER_PREFIXES = [
  'You described a plan but have not created any files yet.',
];
export function isEngineInjectedUserText(text: string): boolean {
  return ENGINE_INJECTED_USER_PREFIXES.some((p) => text.startsWith(p));
}

/**
 * Rebuild the user's OWN chat messages from a persisted conversation (the part conversationToEvents
 * deliberately omits). Returns them as user-role chat rows timestamped with their real wall-clock
 * time when the server stamped one (position fallback for legacy records) so the UI can merge them
 * with the restored agent narration in the right order. Tool-result "user" turns (no visible text)
 * and engine-injected steering prompts are skipped — only what the human typed is kept.
 */
export function conversationToUserMessages(conv: PersistedConversation): Array<{ role: 'user'; text: string; ts: number }> {
  const out: Array<{ role: 'user'; text: string; ts: number }> = [];
  const msgs = conv.messages ?? [];
  msgs.forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role !== 'user') return;
    const text = cleanRestoredUserPrompt(messageText(msg.content).trim());
    if (text && !isEngineInjectedUserText(text)) out.push({ role: 'user', text, ts: restoredTs(m, idx) });
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
const SESSION_STATUS_META: Record<string, { dot: string; label: string; pulse?: boolean; live?: boolean }> = {
  running: { dot: 'bg-indigo-400', label: 'Building…', pulse: true },
  complete: { dot: 'bg-emerald-500', label: 'Built' },
  error: { dot: 'bg-red-500', label: 'Failed' },
  stopped: { dot: 'bg-zinc-500', label: 'Stopped' },
};
/**
 * `live` = the session's app has an ACTIVE published deployment (server-verified). It upgrades the
 * dot to a green "Live" indicator — EXCEPT while a build is running ("Building…" is the current
 * activity and must stay visible) and after a failed build ("Failed" is safety-relevant and must
 * never be painted over by a happier badge).
 */
export function sessionStatusMeta(status?: string, live?: boolean): { dot: string; label: string; pulse?: boolean; live?: boolean } {
  if (live && status !== 'running' && status !== 'error') {
    return { dot: 'bg-green-400', label: 'Live', live: true };
  }
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

/**
 * Filter saved sessions by a free-text query, matched case-insensitively against the session TITLE
 * (the only human-readable field on a list item). An empty/whitespace query returns the list
 * unchanged. Pure — the history search box calls this over the already-loaded list (instant, no
 * server round-trip). Kept generic so it works on both ConversationMeta and PersistedConversation.
 */
export function filterSessionsByQuery<T extends { title?: string }>(items: T[], query: string): T[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => (it.title || '').toLowerCase().includes(q));
}

/**
 * Split saved sessions into pinned vs the rest, PRESERVING the incoming order within each group
 * (the API returns newest-updated first, so pinned items also stay newest-first). Pinned sessions
 * render in their own section above the date-bucketed rest so a user's important builds are always
 * one glance away regardless of age. Pure.
 */
export function partitionPinnedSessions<T extends { pinned?: boolean }>(items: T[]): { pinned: T[]; rest: T[] } {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const it of items) (it.pinned ? pinned : rest).push(it);
  return { pinned, rest };
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
