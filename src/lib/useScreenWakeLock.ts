// KEEP THE SCREEN AWAKE while something long-running is happening (admin 2026-08-14: a build was dying
// when the phone auto-locked and cut the connection). Uses the standard Screen Wake Lock API — the exact
// mechanism a video player uses to keep the screen on during playback.
//
// Honest boundaries:
//   • The wake lock only holds while the TAB IS VISIBLE. The browser auto-releases it when the tab is
//     hidden/backgrounded; we re-acquire it on `visibilitychange` when the page comes back AND it is still
//     wanted. So it keeps the screen on while the user is watching the build — it cannot (and must not)
//     keep a phone awake with the app in the background; no web API can, and pretending otherwise would be
//     a false promise.
//   • Where the API is unsupported (older browsers, some in-app webviews) this is a silent no-op — the
//     toggle simply has no effect there rather than throwing.
//   • Best-effort by construction: a denied/failed request never surfaces an error to the build.

import { useEffect } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void };
interface WakeLockNav { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }
interface WakeLockDoc { visibilityState: string; addEventListener: (t: string, cb: () => void) => void; removeEventListener: (t: string, cb: () => void) => void }
interface WakeLockEnv { nav?: WakeLockNav; doc?: WakeLockDoc }

/**
 * React-free core: hold a screen wake lock between start() and stop(), re-acquiring on tab re-visibility.
 * Extracted (with injectable nav/doc) so the lifecycle is unit-testable without a DOM environment. Never
 * throws.
 */
export function createScreenWakeLock(env: WakeLockEnv = {}) {
  const nav = env.nav ?? ((typeof navigator !== 'undefined' ? navigator : undefined) as unknown as WakeLockNav | undefined);
  const doc = env.doc ?? ((typeof document !== 'undefined' ? document : undefined) as unknown as WakeLockDoc | undefined);
  const supported = !!nav?.wakeLock && typeof nav.wakeLock.request === 'function';

  let sentinel: WakeLockSentinelLike | null = null;
  let acquiring = false; // in-flight guard: request() is async, so rapid calls must not each fire one
  let stopped = false;

  const isVisible = () => !doc || doc.visibilityState === 'visible';

  const acquire = async () => {
    if (stopped || sentinel || acquiring || !supported || !isVisible()) return;
    acquiring = true;
    try {
      const s = await nav!.wakeLock!.request('screen');
      if (stopped) { try { await s.release(); } catch { /* ignore */ } return; }
      sentinel = s;
      // The OS may release the lock on its own (e.g. low battery); clear our handle so a later
      // visibility change can re-acquire it.
      s.addEventListener?.('release', () => { sentinel = null; });
    } catch { /* denied / not allowed right now — best-effort, never throw into the app */ } finally {
      acquiring = false;
    }
  };

  const onVisibility = () => { if (isVisible()) void acquire(); };

  return {
    supported,
    start(): void {
      if (!supported) return;
      stopped = false;
      doc?.addEventListener('visibilitychange', onVisibility);
      void acquire();
    },
    stop(): void {
      stopped = true;
      doc?.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      if (s) { try { void s.release(); } catch { /* ignore */ } }
    },
    /** Test-only: is a lock currently held? */
    _held(): boolean { return sentinel !== null; },
  };
}

/** Hold a screen wake lock for as long as `active` is true (and the tab is visible). */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const wl = createScreenWakeLock();
    wl.start();
    return () => wl.stop();
  }, [active]);
}
