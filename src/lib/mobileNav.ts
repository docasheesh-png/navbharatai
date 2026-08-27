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
