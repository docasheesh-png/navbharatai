// HOW LONG HAS THE USER ACTUALLY HAD THEIR APP OPEN? — the Action Navigator's starting gun.
//
// The ask (admin 2026-09-21) starts the whole trail only after the app has been TRIED: *"jaise hi
// user preview chalaye, thodi der chala le, uske bad"*. So something has to measure "thodi der", and
// it has to measure the real thing rather than a proxy.
//
// 🔒 WHAT IS DELIBERATELY NOT COUNTED, because each would turn this into a lie:
//   • A preview that exists but is not on screen. The user has to be LOOKING at it.
//   • A browser tab in the background. `visibilitychange` pauses the count — a phone in a pocket is
//     not somebody testing their app, and on mobile that is the common case, not an edge one.
//   • Time before the preview URL exists. A spinner is not an app.
// The accumulation is therefore of attention, not of wall clock, which is what makes a 20-second
// threshold meaningful instead of arbitrary.
//
// ⚠️ IT ONLY EVER GOES UP, AND THAT IS ON PURPOSE. Looking away does not un-prove that the app was
// seen; it just stops adding. Resetting on blur would mean a user who checked their app, switched to
// the chat and came back would never cross the line.
//
// The THRESHOLD is not here — it lives in `actionNavigator.ts` (`PREVIEW_DWELL_MS`) with the rules
// that use it, so nobody has to read two files to know when the trail starts.

import { useEffect, useRef, useState } from 'react';

/** How often the accumulated total is published to React. One second is far finer than the rule needs. */
const TICK_MS = 1_000;

/**
 * Accumulated milliseconds during which `active` was true AND this document was visible.
 *
 * Returns a number that only increases for the life of the component. Remounting starts a fresh
 * count — that is correct rather than lossy: a remount means a new workspace or a new session, and
 * carrying a previous app's dwell into a new one would start the trail on an app nobody has seen.
 */
export function usePreviewDwell(active: boolean): number {
  const [dwellMs, setDwellMs] = useState(0);
  // The running total lives in a ref so a tick never depends on the previous render's value, and a
  // re-render caused by something else cannot double-count.
  const totalRef = useRef(0);
  const sinceRef = useRef<number | null>(null);

  useEffect(() => {
    // `document` is guarded because this module is imported by code that CI type-checks and renders
    // outside a browser; a missing document simply means nothing is counted.
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

    const start = () => {
      if (sinceRef.current === null && active && visible()) sinceRef.current = Date.now();
    };
    const stop = () => {
      if (sinceRef.current !== null) {
        totalRef.current += Math.max(0, Date.now() - sinceRef.current);
        sinceRef.current = null;
        setDwellMs(totalRef.current);
      }
    };

    const onVisibility = () => { if (visible()) start(); else stop(); };

    start();
    const timer = setInterval(() => {
      if (sinceRef.current === null) return;
      // Publish the total WITHOUT closing the open span, so the number a consumer reads is current
      // rather than one tick stale.
      setDwellMs(totalRef.current + Math.max(0, Date.now() - sinceRef.current));
    }, TICK_MS);

    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [active]);

  return dwellMs;
}
