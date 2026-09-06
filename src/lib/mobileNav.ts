/**
 * THE GLOBAL MOBILE TAB BAR'S HEIGHT — in one place, because it has now drifted three times.
 *
 * The bar is `fixed bottom-0`, so it sits OVER the page. Anything at the bottom of a screen — a chat
 * composer, most of all — is hidden underneath it unless the page reserves exactly as much room as
 * the bar really occupies.
 *
 * 🔒 THE BUG THIS CLOSES (admin, 2026-08-25, TestFlight screenshot: the Professionals composer cut in
 * half by the tab bar). The bar's height is `3.5rem + env(safe-area-inset-bottom)` — 3.5rem of taps
 * plus the iPhone home-indicator strip below it. The page reserved a bare `pb-14`, which is the 3.5rem
 * and NOT the inset. On any device with a home indicator the composer was therefore hidden by exactly
 * the height of that inset, every time, on every screen that shows this bar.
 *
 * The reasoning that produced it is worth recording, because it is subtly wrong rather than careless:
 * the root layout says "bottom is handled by the fixed mobile nav (its own env padding)". The nav's
 * padding pads the NAV'S OWN CONTENTS so its icons clear the home indicator. It does nothing for the
 * page behind it. Two different jobs, one number.
 *
 * App.tsx already learned this lesson once and shared a BOOLEAN (`showsGlobalMobileNav`) so the bar
 * and the reservation could not disagree about WHETHER the bar exists. They still disagreed about HOW
 * TALL it is. This shares the height for the same reason.
 */

/** Tappable height of the bar, before the device inset. */
export const MOBILE_NAV_CONTENT_HEIGHT = '3.5rem';

/**
 * The bar's TOTAL height, and therefore exactly what a page must reserve at its bottom.
 * `env(...)` resolves to 0 on the web, so this is byte-identical to `pb-14` on a desktop browser.
 */
export const MOBILE_NAV_TOTAL_HEIGHT = `calc(${MOBILE_NAV_CONTENT_HEIGHT} + env(safe-area-inset-bottom, 0px))`;

/**
 * The CSS custom property that publishes the bar's real height to the stylesheet.
 *
 * 🔒 THE FOURTH DRIFT, AND WHY IT NEEDED A VARIABLE (admin, 2026-09-06, screenshot: the Publish →
 * connect-a-domain sheet scrolled to its end with its last rows and buttons still hidden).
 *
 * The bar is `fixed bottom-0` at `z-150`, so it paints OVER every dialog with a lower z-index. The
 * shared sheet geometry (`nb-sheet-overlay` in index.css) already subtracted the two things CSS can
 * see by itself — the phone browser's toolbar, via `dvh`, and the device's home-indicator inset, via
 * `env()` — and stopped there. It never subtracted OUR OWN tab bar, so a full-height dialog laid its
 * final ~40-56px underneath it. That is worse than a crop: the scroll container ends there too, so
 * scrolling to the bottom of the sheet still leaves those rows under the bar with no scroll left to
 * give, and the buttons are permanently unreachable rather than merely off-screen.
 *
 * The reason the stylesheet could not fix itself is the interesting part: whether the bar exists is a
 * RUNTIME fact (`showsGlobalMobileNav` — device mode, focus mode, Code Studio, BotBuilder), not a
 * media query. So React has to tell CSS. This variable is that channel, and it is published from the
 * same boolean that renders the bar, so the two cannot disagree — the identical discipline that
 * `showsGlobalMobileNav` and `MOBILE_NAV_TOTAL_HEIGHT` already apply to WHETHER the bar exists and
 * HOW TALL it is.
 */
export const MOBILE_NAV_HEIGHT_VAR = '--nb-bottom-nav';

/**
 * Publish the bar's height to CSS so everything that has to clear it reads ONE number.
 *
 * `visible === false` writes `0px`, and every rule that consumes the variable is written as a
 * `max(...)` against it — so on desktop, in focus mode, and inside Code Studio / BotBuilder the
 * reservation collapses to exactly the old behaviour rather than holding a strip for a bar that is
 * not there. (Reserving space for an absent bar is not hypothetical: it is the dead strip under Code
 * Studio's own footer that this module's history already records.)
 *
 * Set on `<html>`, not the app root, because dialogs that portal to `document.body` — the publish
 * celebration, the report sheet — are outside the app root and would not inherit it there.
 */
export function publishMobileNavHeight(visible: boolean, root?: HTMLElement | null): void {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return; // no DOM (SSR, tests) — the CSS fallback of 0px is already correct
  try {
    el.style.setProperty(MOBILE_NAV_HEIGHT_VAR, visible ? MOBILE_NAV_TOTAL_HEIGHT : '0px');
  } catch { /* style unavailable — the stylesheet's own 0px default stands */ }
}
