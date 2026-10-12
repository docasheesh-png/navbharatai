/**
 * HOW LONG HAS THE USER BEEN WAITING? — the one answer every build clock on screen shows.
 *
 * 🔴 AUTOPSY 303e8a6f (2026-10-12). The status bar measured from the FIRST ACTIVITY entry — here a template file
 * revealed 11 s into the build — so the clock dropped from ~11 s to 0 s and read ~12 s when the user had waited
 * 23 s. It also started on the server's clock and ran on this device's, so a phone whose clock is off showed a
 * skewed time. The origin is now the moment the user pressed Send, on this device (`state.startedAt`), and the
 * clock freezes at `state.endedAt`, on the same device — one origin, one clock domain, never reset by an error
 * (the admin's 2026-07-21 rule, "time reset ho jata hai").
 *
 * A build re-attached mid-run or restored from history has no Send on this device; it falls back to the server's
 * own timestamps, start and end on one clock. PURE.
 */
export function buildElapsedMs(o: {
  startedAt?: number;
  endedAt?: number;
  running: boolean;
  now: number;
  firstActivityTs?: number;
  lastActivityTs?: number;
}): number {
  const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  if (finite(o.startedAt)) {
    const end = o.running ? o.now : (finite(o.endedAt) ? o.endedAt : o.now);
    return Math.max(0, end - o.startedAt);
  }
  if (finite(o.firstActivityTs)) {
    const end = o.running ? o.now : (finite(o.lastActivityTs) ? o.lastActivityTs : o.firstActivityTs);
    return Math.max(0, end - o.firstActivityTs);
  }
  return 0;
}
