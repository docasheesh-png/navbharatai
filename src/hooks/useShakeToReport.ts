// Shake the phone to report a problem — the browser half.
//
// The decisions (what counts as a shake, the cooldown, the user's switch) live in `reportShake.ts` and
// are unit-tested. This hook only wires them to a real device, and it is where the two platform
// realities live:
//
//   • iOS 13+ REFUSES motion access until the user grants it, and the grant can only be requested
//     inside a user gesture — which a passive listener does not have. So on iOS this hook attaches
//     only if permission has ALREADY been granted; it never pops a permission prompt at a person who
//     was doing something else. That is not a limitation to work around, it is Apple's rule, and a
//     shake-only report feature would be silently unavailable there. Hence the visible entry point.
//   • The listener is cheap but not free — it fires many times a second. It is attached once, and
//     removed the moment the user turns the preference off.

import { useEffect } from 'react';
import { feedShake, initialShakeState, shakeEnabled, type ShakeState } from '../lib/reportShake';

type MotionEventCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Call `onShake` when the user genuinely shakes the device. No-op where motion is unavailable. */
export function useShakeToReport(onShake: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof window.DeviceMotionEvent === 'undefined') return;
    if (!shakeEnabled((k) => { try { return localStorage.getItem(k); } catch { return null; } })) return;

    // iOS: attach only if the page ALREADY has motion permission. `requestPermission` exists there and
    // must be called from a gesture; calling it here would either throw or interrupt the user.
    const ctor = window.DeviceMotionEvent as MotionEventCtor;
    if (typeof ctor.requestPermission === 'function') {
      // There is no way to ASK whether permission was granted without requesting it, so the honest
      // behaviour is to skip: on iOS the visible "Report a problem" entry is the way in. Enabling
      // shake there is a separate, deliberate opt-in (a button that requests permission), not
      // something to spring on someone mid-task.
      return;
    }

    let state: ShakeState = initialShakeState();
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const out = feedShake(state, { x: a.x, y: a.y, z: a.z, at: Date.now() });
      state = out.state;
      if (out.shook) onShake();
    };

    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [onShake, enabled]);
}
