// What the USER actually lived through, not what one turn saw.
//
// THE GAP (admin, 2026-08-06). Two separate complaints turned out to be one root cause:
//   • "the build ran 58 minutes, not 18" — `startedAt`/`endedAt` are PER TURN, so a session of several
//     `continue` turns reports only its last slice. The number that decides whether this product feels
//     fast is the one the user waited, and it appeared nowhere.
//   • "the files were wiped three times and nothing said so" — the File Guardian DOES record every wipe
//     it repairs, but those events belonged to earlier TURNS, so all three reports were silent, each
//     being a different turn. The data existed; only its scope was wrong.
//
// Both are answered by the same line, built from the durable per-workspace history the build ALREADY
// reads for `priorFailedBuilds` — so this costs no extra query.
//
// PURE, so every branch is testable without Firestore.

export interface SessionHistoryEntry {
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  dataLossCount?: number;
}

export interface SessionSummary {
  /** Turns in this session, including the one being reported. */
  turns: number;
  /** From the FIRST turn's start to now. */
  elapsedMs: number;
  /** Workspace wipes repaired across the whole session. */
  dataLossTotal: number;
  /** Earlier turns that ended not-ok. */
  failedTurns: number;
  /**
   * True when the history was capped, so the numbers above are a FLOOR rather than a total.
   * Reporting a capped count as if it were complete would understate exactly the thing this fixes.
   */
  truncated: boolean;
}

/** Round to whole seconds and render as `Xm Ys`, or `Ys` under a minute. PURE. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Fold the durable history plus the current turn into one session view.
 *
 * `historyLimit` is the cap the caller read with: when the history came back FULL, there may be older
 * turns we never saw, and the summary says so instead of quietly under-reporting.
 */
export function summarizeSession(
  history: SessionHistoryEntry[] | null | undefined,
  currentStartedAt: number,
  nowMs: number,
  historyLimit = 50,
): SessionSummary {
  const past = (history ?? []).filter((h) => Number.isFinite(h?.startedAt));
  // The CURRENT turn is not in the durable history yet — it is written when the build finishes.
  const starts = [...past.map((h) => h.startedAt), currentStartedAt].filter((n) => Number.isFinite(n));
  const first = starts.length ? Math.min(...starts) : currentStartedAt;
  return {
    turns: past.length + 1,
    elapsedMs: Math.max(0, nowMs - first),
    dataLossTotal: past.reduce((n, h) => n + (Number.isFinite(h.dataLossCount) ? (h.dataLossCount as number) : 0), 0),
    failedTurns: past.filter((h) => h.ok === false).length,
    truncated: past.length >= historyLimit,
  };
}

/**
 * The sentence the report carries. Empty for a genuine first turn — there is no session to summarise
 * yet, and inventing one would be noise.
 *
 * Says "at least" whenever the history was capped, because a floor presented as a total is the same
 * class of understatement this whole thing exists to fix.
 */
export function sessionSummaryLine(s: SessionSummary): string {
  if (s.turns <= 1) return '';
  const about = s.truncated ? 'at least ' : '';
  const parts = [
    `This is turn ${s.turns} of this session, which has been running for ${about}${formatElapsed(s.elapsedMs)} in total`,
  ];
  if (s.failedTurns > 0) parts.push(`${s.failedTurns} earlier turn${s.failedTurns === 1 ? '' : 's'} ended without success`);
  if (s.dataLossTotal > 0) {
    parts.push(`the workspace was found empty or missing files ${s.dataLossTotal} time${s.dataLossTotal === 1 ? '' : 's'} and was restored from the durable store`);
  }
  return `${parts.join('. ')}.`;
}
