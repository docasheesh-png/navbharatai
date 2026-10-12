/**
 * LIVE STATUS IS NOT HISTORY — one predicate for the lines that say what is happening NOW.
 *
 * Two narration lines are live status rather than conversation: the "still working" clock (`id: 'working'`,
 * AgentRunner's heartbeat) and the ETA line (`id: 'eta-live'`). Each is re-emitted with the same id so a surface
 * replaces one line instead of appending a new one every few seconds.
 *
 * 🔴 AUTOPSY 303e8a6f (2026-10-12). Readers recognised these lines by their FIRST CHARACTER: the report's
 * silence detector and the saved transcript by '⏱', the report's record-once rule by '⏳'. The heartbeat's '⏳'
 * slipped past every '⏱' reader (a tick counted as activity and split a real silence), and the '⏳' rule swallowed
 * real progress that happens to start with the same emoji (the build-budget steer, the hand-back notice). On the
 * client the line kept its FIRST timestamp, so a tick from a later turn rewrote a bubble far above the fold, and
 * nothing removed it when the call ended. The id is what the emitter controls, so the id is what is read; the
 * text forms are kept only for lines persisted before the id existed.
 *
 * Shared by the client (reducer, chat thread) and the server (build report), so the two cannot drift.
 */

/** The heartbeat's id — AgentRunner's "⏳ Still working — Ns so far". */
export const WORKING_LINE_ID = 'working';

/** The ETA line's id — the route's "⏱️ …" estimate and "Still building…" updates. */
export const ETA_LINE_ID = 'eta-live';

const LIVE_IDS: ReadonlySet<string> = new Set([WORKING_LINE_ID, ETA_LINE_ID]);

/** Text forms of the same lines, for transcripts saved before every emitter carried an id. */
const LEGACY_LIVE_TEXT = /^(?:⏳\s*Still working\b|⏱️?\s*Still building…)/;

/** Is this narration line live status (replaced in place, never history)? PURE. */
export function isLiveStatusLine(line: { id?: string | null; text?: string | null } | null | undefined): boolean {
  if (!line) return false;
  if (typeof line.id === 'string' && LIVE_IDS.has(line.id)) return true;
  return LEGACY_LIVE_TEXT.test(String(line.text ?? '').trimStart());
}

/** Is this the id of a live-status line? PURE. Used where only the id may decide (the live reducer). */
export function isLiveStatusId(id: string | null | undefined): boolean {
  return typeof id === 'string' && LIVE_IDS.has(id);
}

/**
 * The narration a thread shows: every line, except live status that is no longer true — the build stopped, or
 * something newer has been said since (the call it was timing has ended). A frozen clock reads as a frozen
 * build, so a stale one is dropped rather than left in place. PURE; keeps order.
 */
export function withoutStaleLiveStatus<T extends { id?: string | null; text?: string | null }>(lines: readonly T[], running: boolean): T[] {
  let lastNonLive = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (!isLiveStatusLine(lines[i])) { lastNonLive = i; break; }
  return lines.filter((line, i) => !isLiveStatusLine(line) || (running && i > lastNonLive));
}

/**
 * The newest line carrying a live-status id, or null. PURE.
 *
 * 🔴 WHY THE ETA NEEDS IT (found working autopsy 303e8a6f). The admin decided on 2026-09-26 that a build shows
 * its ETA — labelled a rough guess where unmeasured — and the report records it as "Shown to the user". But the
 * chat timeline drops every '⏱' line as progress noise (the 2026-07-02 redesign moved timers OUT of the prose),
 * so on the main chat the ETA reached nobody. Live status belongs in the status line, so that is where it goes.
 */
export function latestLiveStatusText(lines: readonly { id?: string | null; text?: string | null }[], id: string): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.id === id && typeof line.text === 'string' && line.text.trim()) return line.text.trim();
  }
  return null;
}
