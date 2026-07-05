// B8 (audit Batch 5) — the pure throttle behind the service-worker update check.
//
// ROOT CAUSE (the "#973 still dead / my changes don't show up" the admin hit): the SW was checked for
// a new version exactly ONCE, at page load (`reg.update()` in main.tsx). A tab left OPEN across a
// deploy therefore kept serving the stale bundle forever — and sticky sessions (chat survives
// reload/phone-off) mean tabs stay open for a long time, so this was the common case, not the rare one.
//
// The fix re-checks for a new SW periodically AND whenever the tab regains focus (phone back on / tab
// refocus). This tiny helper decides whether enough time has passed to re-check, so rapid tab switches
// don't hammer `reg.update()`. Pure + unit-testable (no DOM, no timers).

/** Re-check for a new service worker at most this often (ms). */
export const SW_UPDATE_MIN_INTERVAL_MS = 60_000;

/**
 * Has enough time passed since the last check to run another one? Used to throttle the
 * visibility-change (refocus) path so returning to the tab re-checks, but a burst of focus/blur
 * events cannot fire an update storm.
 */
export function shouldCheckForUpdate(
  lastCheckMs: number,
  nowMs: number,
  minIntervalMs: number = SW_UPDATE_MIN_INTERVAL_MS,
): boolean {
  return nowMs - lastCheckMs >= minIntervalMs;
}
