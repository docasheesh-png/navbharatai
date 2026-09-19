// THE APP MOVES BETWEEN SCREENS — it does not cut (admin 2026-09-19, item B of five).
//
// Switching tabs replaced the content INSTANTLY. That is what a web page does when you click a link,
// and it is the second-loudest "this is a website" signal after the scrollbar the same admin
// photographed: every native app acknowledges the change with motion, so the eye knows something
// moved rather than being swapped.
//
// WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
//
// It is a **fade-through** on the incoming screen: opacity 0 → 1 with a small scale-up. That is
// Material Design's own transition for a change between screens with no parent/child relationship —
// which is exactly a tab bar — not something invented here. iOS's tab bar cross-dissolves for the same
// reason. A SLIDE would be wrong: sliding says "forward/back", and Home → Studio is neither.
//
// It is NOT `document.startViewTransition`. That API morphs old into new and is the better tool for a
// push/pop, but under React it needs `flushSync` inside the transition callback to capture the new DOM
// — a forced synchronous render of this whole tree on every tab tap. The cost is real and the gain here
// is nil, because a fade-through never needs the OLD frame. A CSS animation on the incoming screen
// costs one class toggle and works on every engine, including any WebView too old for the API.
//
// 🔒 IT DOES NOT REMOUNT ANYTHING. The obvious implementation — `key={activeView}` on the container —
// would restart the animation by DESTROYING and rebuilding the subtree on every tab change, taking
// scroll positions, half-typed messages and open panels with it. That is a regression dressed as a
// polish. Restarting the animation by hand (`restartScreenEnter`) keeps the same DOM node.
//
// The GATE lives in CSS (`html.nb-native-shell`, and off under `prefers-reduced-motion`), so the class
// is inert on the website and for anyone who has asked their device for less motion. There is nothing
// for JavaScript to get wrong, and nothing to keep in sync.

/** The class index.css animates. Exported so the component and the test name the same string. */
export const SCREEN_ENTER_CLASS = 'nb-screen-enter';

/**
 * Should this view change be animated at all?
 *
 * Pure, and the two `false` cases are the ones that would look like a bug:
 *   • the FIRST render has no previous screen, so animating it would fade the whole app in right after
 *     the splash has already faded out — two hand-offs for one launch;
 *   • a "change" to the same view is not a change, and re-running the animation would make an
 *     unrelated re-render flicker.
 */
export function shouldAnimateViewChange(previous: string | null | undefined, next: string): boolean {
  if (previous === null || previous === undefined) return false;
  return previous !== next;
}

/** The minimum DOM surface this needs, so the restart is testable without a browser. */
export interface AnimatableElement {
  classList: { add(token: string): void; remove(token: string): void };
  /** Read to force a style flush between the remove and the add. */
  readonly offsetWidth?: number;
}

/**
 * Restart the enter animation on an element that is NOT being remounted.
 *
 * ⚠️ THE REFLOW READ IN THE MIDDLE IS LOAD-BEARING, not a superstition. Removing and re-adding a class
 * in the same frame is coalesced by the browser into no change at all, so the animation never restarts
 * and the second tab tap does nothing. Reading a layout property forces the style change to be
 * committed between the two, which is the standard way to replay a CSS animation.
 */
export function restartScreenEnter(el: AnimatableElement | null | undefined): void {
  if (!el) return;
  try {
    el.classList.remove(SCREEN_ENTER_CLASS);
    void el.offsetWidth;
    el.classList.add(SCREEN_ENTER_CLASS);
  } catch { /* a detached or exotic node is not worth failing a navigation over */ }
}
