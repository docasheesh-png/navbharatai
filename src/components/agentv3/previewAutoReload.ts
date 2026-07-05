// U1 (audit Batch 4) — the pure decision behind the Preview surface's auto-refresh.
//
// The parent (AgentV3Panel) bumps a monotonic `reloadSignal` on every file_changed/diff event during
// a build. The Preview surface must re-compile as the app changes — but it must NOT reload on the very
// first observation of the signal (the surface's mount effect already loads once, so reacting to the
// initial value too would double-load), and it must ignore an unchanged signal (a re-render that did
// not actually touch files). This tiny state machine encodes exactly that, so the reload trigger is
// unit-testable without a DOM.

export interface ReloadTracker {
  /** The last signal value we acted on (undefined = not yet observed). */
  seen: number | undefined;
}

/** Fresh tracker for a mount. */
export function newReloadTracker(): ReloadTracker {
  return { seen: undefined };
}

/**
 * Should a change to `signal` trigger a preview reload? Mutates the tracker to remember what it saw.
 * - `undefined` signal (caller passed nothing) → never reload.
 * - first observation → record it, do NOT reload (the mount load already covers the initial state).
 * - same value as last time → no reload (a re-render that didn't touch files).
 * - a genuinely new value → reload, and remember it.
 */
export function shouldReloadOnSignal(tracker: ReloadTracker, signal: number | undefined): boolean {
  if (signal === undefined) return false;
  if (tracker.seen === undefined) { tracker.seen = signal; return false; }
  if (signal === tracker.seen) return false;
  tracker.seen = signal;
  return true;
}
