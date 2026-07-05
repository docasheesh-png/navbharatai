// Keep the NavBharatAI Pro v3.0 surface (ProV3Surface) MOUNTED while a build is running — even when
// the user switches to another NavBharatAI tab.
//
// ROOT CAUSE it fixes (2026-07-05, admin report): the v3.0 surface was rendered ONLY on
// `activeView === 'nbi_pro_chat'`. NavBharatAI has a tab bar (openTabs) where several surfaces —
// e.g. v3.0 AND Free chat — can be open at once, but only the ACTIVE one is mounted. So the instant
// v3.0 stopped being the active tab (switch tabs, or click Free while a v3.0 build runs), its panel
// UNMOUNTED, tearing down the live NDJSON event stream mid-build → the "Load failed" the admin saw on
// a tab switch, and the "connection fails when both are open" report. The server build keeps running
// (runningBuilds) and auto-resume re-attaches on return, but that teardown→re-attach churn is exactly
// what surfaces as a failure.
//
// The fix: while a build is RUNNING, keep the surface mounted regardless of the active tab, so the
// stream keeps flowing invisibly in the background across tab switches and multi-tab usage. When
// active it renders normally; when another tab is active it is display:none (mounted, hidden). Once
// the build ends (running→false) it unmounts as before — zero idle overhead.

/** The ViewType under which the main v3.0 surface renders. */
export const V3_VIEW = 'nbi_pro_chat';

/**
 * Should ProV3Surface be rendered at all? True when it is the active tab OR a build is still running
 * (keep-alive so a tab switch never kills the live stream). Pure + unit-testable.
 */
export function shouldRenderV3Surface(activeView: string, v3BuildRunning: boolean): boolean {
  return activeView === V3_VIEW || v3BuildRunning === true;
}

/**
 * Tailwind display class for the keep-alive wrapper: `contents` when the v3.0 tab is active (a layout
 * NO-OP — the wrapper box disappears so ProV3Surface participates in the parent flex exactly as before),
 * and `hidden` (display:none) when the surface is kept mounted in the background under another tab.
 * Pure + unit-testable.
 */
export function v3SurfaceDisplayClass(activeView: string): 'contents' | 'hidden' {
  return activeView === V3_VIEW ? 'contents' : 'hidden';
}
