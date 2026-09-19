// PULL TO REFRESH — the gesture, decided in one place (admin 2026-09-19, item D of five).
//
// A native list answers a downward drag at the top of the list by fetching again. The app had no such
// gesture anywhere, so the only way to see new data was to leave the screen and come back.
//
// 🔴 WHERE THIS MAY AND MAY NOT BE USED, because a spinner that refreshes nothing is exactly the
// "built but not really working" state NavBharatAI's second absolute rule bans:
//   • App Mart's list is an HTTP fetch (`/api/nav-store/...`). New apps published by other creators
//     appear ONLY on a re-fetch, so pulling genuinely gets you something. ✅
//   • The History list is a Firestore `onSnapshot` LIVE listener. It already updates itself the moment
//     anything changes, on any device — a pull there would spin and fetch what is already on screen.
//     ❌ Deliberately not wired, and this note exists so nobody "completes" it later.
//
// The numbers are small and deliberate: 64px to trigger, 96px of travel, and a 0.5 resistance so the
// content moves HALF as far as the finger. Resistance is what makes a pull feel attached to a surface
// rather than to a scrollbar; without it the list leaps and the gesture reads as a bug.

/** How far the indicator must travel before releasing counts as a refresh. */
export const PULL_THRESHOLD_PX = 64;

/** The furthest the list will move, however hard the pull. */
export const MAX_PULL_PX = 96;

/** Content moves this fraction of the finger's distance — the rubber band. */
export const PULL_RESISTANCE = 0.5;

/** Below this many pixels of movement the direction is noise, not an axis. */
export const AXIS_LOCK_MIN_PX = 8;

/**
 * May a pull begin?
 *
 * ⚠️ `scrollTop === 0` IS NOT ENOUGH ON ITS OWN, and each extra condition here is a real conflict:
 *   • a SECOND finger means a pinch or a two-finger scroll, never a pull;
 *   • a refresh already in flight must not start another one;
 *   • a list that is not at the very top must scroll, not pull — otherwise the gesture steals the
 *     first few pixels of every upward flick.
 */
export function canStartPull(opts: { scrollTop: number; touchCount: number; refreshing: boolean }): boolean {
  if (opts.refreshing) return false;
  if (opts.touchCount !== 1) return false;
  return opts.scrollTop <= 0;
}

/**
 * Is this drag vertical enough to be a pull?
 *
 * A horizontal-dominant drag belongs to whatever is swiping sideways — the app has horizontally
 * scrollable tab rows (`.no-scrollbar`) and a swipe-to-open menu, and stealing those would trade one
 * gesture for another. Ties go to NOT pulling.
 */
export function isPullGesture(dx: number, dy: number): boolean {
  if (dy <= 0) return false; // upward or flat is a scroll
  if (Math.abs(dy) < AXIS_LOCK_MIN_PX) return false; // too small to have a direction yet
  return Math.abs(dy) > Math.abs(dx);
}

/** How far the indicator has travelled, with resistance and the clamp applied. */
export function pullDistance(rawDy: number): number {
  if (rawDy <= 0) return 0;
  return Math.min(MAX_PULL_PX, rawDy * PULL_RESISTANCE);
}

/** Would releasing now trigger a refresh? */
export function isArmed(distance: number): boolean {
  return distance >= PULL_THRESHOLD_PX;
}

/** 0→1, for the indicator's rotation and opacity. Clamped, so it never overshoots its own animation. */
export function pullProgress(distance: number): number {
  return Math.max(0, Math.min(1, distance / PULL_THRESHOLD_PX));
}
