// AgentV3 — bounded durable-flush decision (autopsy 2026-07-06).
//
// The sandbox + Cloud Run instance are EPHEMERAL: a rotation / hard-kill mid-build loses anything not
// yet durably saved. A pure RESETTING debounce never fires under a CONTINUOUS write burst (each event
// slides the timer forward), so a rotation during the burst lost the whole app AND left the build report
// empty — the admin's "yeh app nahi bani, na hi build report me kuch aya". This pure decision guarantees
// a durable flush at least every maxWaitMs regardless of the event rate: an overdue event flushes
// immediately instead of sliding the debounce again. Shared by the route's file-persist and
// diagnostics-persist so the same bug can never silently return on either. Pure + unit-tested.

export type FlushDecision = 'flush-now' | 'debounce';

/**
 * Decide how to persist on an event at `now`, given the last durable flush happened at `lastFlushAt`.
 *  - 'flush-now' : ≥ maxWaitMs since the last durable flush → persist NOW, so a continuous burst can
 *                  never starve the durable save (the exact bug this fixes). Also the first event when
 *                  lastFlushAt is 0 → the state is durable from the very start.
 *  - 'debounce'  : recent enough → let the caller schedule/keep its trailing debounce (coalesce a quiet
 *                  burst) or skip (a throttle). Either way, no immediate durable write is required yet.
 * A non-positive maxWaitMs means "always flush" (no throttling). Pure — no clocks, no I/O.
 */
export function flushDecision(lastFlushAt: number, now: number, maxWaitMs: number): FlushDecision {
  if (!(maxWaitMs > 0)) return 'flush-now';
  if (lastFlushAt <= 0) return 'flush-now'; // never flushed (sentinel 0) → make state durable immediately
  return now - lastFlushAt >= maxWaitMs ? 'flush-now' : 'debounce';
}
