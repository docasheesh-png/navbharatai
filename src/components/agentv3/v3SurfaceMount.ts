// Keep the NavBharatAI Pro v5.0 surface (ProV3Surface) MOUNTED like a real WINDOW in NavBharatAI's
// tab/window system — its state (chat, live build stream) survives switching among any number of
// other tabs, and it only unmounts when the user explicitly CLOSES the v5.0 tab.
//
// HISTORY OF THE ROOT CAUSE (two rounds):
// • Round 1 (2026-07-05, #963): the surface rendered ONLY on `activeView === 'nbi_pro_chat'` — ANY
//   tab switch unmounted it and tore down the live NDJSON stream mid-build ("Load failed"). Fixed by
//   keeping it mounted WHILE A BUILD RAN.
// • Round 2 (2026-07-05, IMG_5715 — admin retest): running-gated keep-alive has an UNMOUNT RACE. The
//   user switches to Free chat mid-build; the build finishes (or a stream blip flips running→false)
//   while v5.0 is hidden → `running` false + not active → the surface UNMOUNTS in the background and
//   the whole chat state evaporates. Returning to v5.0 then remounts EMPTY, the fresh-open nonce
//   fires startNewSession() → the "blank page, new chat" the admin hit. The chat looked destroyed.
//
// THE FIX (window semantics, admin-mandated: "10 windows open, v5.0 chalta rahe"): mount-persist the
// surface while the v5.0 tab is OPEN in the tab bar (openTabs) — like any real window, switching away
// hides it (display:none, stream + state alive) and switching back shows the SAME live surface. It
// unmounts only when the user explicitly closes the v5.0 tab — and even then a running build keeps it
// alive so an accidental close can't kill a build in flight.

/** The ViewType under which the main v5.0 surface renders. */
export const V3_VIEW = 'nbi_pro_chat';

/**
 * Should ProV3Surface be rendered at all? True when v5.0 is the active tab, OR its tab is open in the
 * tab bar (window semantics — state persists across tab switches), OR a build is running (safety: an
 * explicit tab-close mid-build must not kill the live stream). Pure + unit-testable.
 */
export function shouldRenderV3Surface(activeView: string, v3BuildRunning: boolean, v3TabOpen = false): boolean {
  return activeView === V3_VIEW || v3TabOpen === true || v3BuildRunning === true;
}

/**
 * Tailwind display class for the keep-alive wrapper: `contents` when the v5.0 tab is active (a layout
 * NO-OP — the wrapper box disappears so ProV3Surface participates in the parent flex exactly as before),
 * and `hidden` (display:none) when the surface is kept mounted in the background under another tab.
 * Pure + unit-testable.
 */
export function v3SurfaceDisplayClass(activeView: string): 'contents' | 'hidden' {
  return activeView === V3_VIEW ? 'contents' : 'hidden';
}
