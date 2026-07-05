// B6 (audit) — the pure timing policy for the v3.0 cross-device live poll (subscribeLive).
//
// Two real gaps this encodes the fix for:
//   1. PAUSE ON HIDDEN — the poll only checked visibility when STARTING; a poll already running when
//      the tab was backgrounded kept hitting the network every few seconds (battery/data drain).
//   2. RESUME FROM THE LAST SEQ — every re-arm (on tab-focus) restarted from seq 0, re-fetching and
//      re-applying the WHOLE event history. Resuming from the last seen seq fetches only what's new.
//
// This module holds the pure decisions so they're unit-testable without a DOM or a network.

/** Fast cadence when something just happened; the ceiling both quiet-backoff and hidden climb to. */
export const LIVE_POLL_FAST_MS = 3_000;
export const LIVE_POLL_MAX_MS = 30_000;

/**
 * The delay before the NEXT live poll.
 * - hidden tab → jump straight to the max (a near-pause; we also skip the fetch itself while hidden)
 * - activity this tick → snap back to the fast cadence
 * - quiet + visible → exponential back-off (×1.6) up to the max
 * Pure.
 */
export function nextLivePollDelayMs(opts: { hidden: boolean; hadActivity: boolean; current: number }): number {
  if (opts.hidden) return LIVE_POLL_MAX_MS;
  if (opts.hadActivity) return LIVE_POLL_FAST_MS;
  const base = Number.isFinite(opts.current) && opts.current > 0 ? opts.current : LIVE_POLL_FAST_MS;
  return Math.min(LIVE_POLL_MAX_MS, Math.round(base * 1.6));
}

/**
 * The `sinceSeq` a (re-)armed poll should start from: the last seq seen for THIS workspace, else 0.
 * Resuming means a tab-focus re-arm never re-downloads the whole history. Never returns a negative /
 * non-integer. Pure.
 */
export function resumeSinceSeq(stored: number | undefined): number {
  return Number.isInteger(stored) && (stored as number) > 0 ? (stored as number) : 0;
}
