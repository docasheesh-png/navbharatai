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

/**
 * P1-C (SEO verification 2026-10-18) — RELOAD ONLY FOR A REAL UPDATE, NEVER FOR THE FIRST INSTALL.
 *
 * sw.js calls `skipWaiting()` + `clients.claim()`, so the very FIRST install also takes control of the
 * open page — and that fires `controllerchange` exactly like a deploy does. main.tsx reloaded on every
 * `controllerchange`, so EVERY first-time visitor (and every crawler render) downloaded, parsed and
 * booted the whole app TWICE: Lighthouse measured ~4.7–7.5 s of "redirects" on the homepage.
 *
 * The first install changes nothing the page is running: the document and bundle it just loaded came
 * from the network, so they are already the current deploy. Only a change FROM one controller TO
 * another means "new code was deployed while this tab was open" — that is the one case the reload
 * exists for (the "my changes don't show up" fix), and it is kept unchanged, at most once per page.
 *
 * `hadController` is `navigator.serviceWorker.controller` read when the page starts. A page opened
 * with a hard reload is uncontrolled too; it also came from the network, so it is current as well.
 * PURE: the caller supplies the starting fact and the reload; no DOM, no timers.
 */
export function controllerChangeReloader(hadController: boolean, reload: () => void): () => 'adopted' | 'reloaded' | 'ignored' {
  let controlled = hadController;
  let reloaded = false;
  return () => {
    if (!controlled) {
      // First install (or first claim after a hard reload): the page is already current — adopt it.
      controlled = true;
      return 'adopted';
    }
    if (reloaded) return 'ignored';
    reloaded = true;
    reload();
    return 'reloaded';
  };
}
