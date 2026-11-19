// THE BUILD'S WORKING CLOCK: wall time minus the time spent waiting for the user (failedbr #2431, 21d59838, 2026-11-17).
//
// 🔴 WHAT HAPPENED. The build asked for two Razorpay keys. For ten minutes the live line said, every minute, "the build
// carries on the moment you reply, and this time is not counted against it." Then the build carried on, said "Half the
// build time is used" (it was 16 minutes in, 6 of them working), asked for THE SAME keys again at 22.6 minutes, and the
// 25-minute wall-clock watchdog stopped it mid-wait: OUTCOME_STOPPED, release gate RED. It had spent 12.4 minutes
// waiting for the user and 12.7 working. The promise was true for the ETA and for the futility breaker (both corrected
// by `onUserWaitEnded`, autopsy 1219c639) and false for everything that decides whether the build may go on: the hard
// deadline timer, the runner's own clock, and ~40 "is there time left?" checks, each computing `Date.now() -
// buildStartedAt` for itself.
//
// 🧬 THE FIX. ONE credit, read by all of them: the total time the user was waited on, capped so the build can never
// outlive the request that carries it (Cloud Run cuts a request at 3600 s, `cloudbuild.yaml --timeout`; a paid window
// can already be 58 minutes). The hard deadline is pushed back by the credit when a wait ends, the runner subtracts it
// from its own clock, and the route's budget checks read `workElapsedMs`. PURE.

/** Cloud Run's request timeout for this service (`cloudbuild.yaml`, `--timeout 3600`). */
export const CLOUD_RUN_REQUEST_CEILING_MS = 3600_000;
/** Room kept below that ceiling for the finalizer to emit the terminal result and close the stream. */
export const CEILING_MARGIN_MS = 5 * 60_000;

/**
 * How much of the user-wait total may be left off the build's clock. Everything, when the build has no deadline
 * (`budgetMs <= 0`); otherwise at most what keeps budget + credit under the request ceiling. PURE.
 */
export function waitCreditMs(totalWaitMs: number, budgetMs: number, ceilingMs: number = CLOUD_RUN_REQUEST_CEILING_MS - CEILING_MARGIN_MS): number {
  const total = Number.isFinite(totalWaitMs) && totalWaitMs > 0 ? totalWaitMs : 0;
  if (!(budgetMs > 0)) return total;
  return Math.min(total, Math.max(0, ceilingMs - budgetMs));
}

/** How long the build has WORKED: wall time since it started, minus the credited wait. PURE. */
export function workElapsedMs(nowMs: number, startedAtMs: number, creditMs: number): number {
  return Math.max(0, nowMs - startedAtMs - (creditMs > 0 ? creditMs : 0));
}

/** When the hard deadline should fire now, measured from `nowMs`: its budget plus the credit, from when it was armed. PURE. */
export function hardDeadlineRemainingMs(nowMs: number, armedAtMs: number, budgetMs: number, creditMs: number): number {
  return Math.max(1, budgetMs + (creditMs > 0 ? creditMs : 0) - (nowMs - armedAtMs));
}
