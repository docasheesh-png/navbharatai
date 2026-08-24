// TWO-FINGER PINCH MUST NOT ZOOM THE APP (admin 2026-08-24: "do unglio se jaise webpage zoom karte
// hai woh zoom app me nahi hona chahiye").
//
// Pinch-zooming the whole screen is the last big "this is a web page in a wrapper" tell left in the
// shell, alongside the tap-highlight rectangle, pull-to-refresh and the rubber-band bounce that
// index.css already removed. No native Android or iOS app lets you pinch its chrome around.
//
// 🔒 WHY THIS FILE EXISTS AT ALL — the CSS and the meta tag are NOT enough on their own.
//
//   • `touch-action: pan-x pan-y` (index.css) is the standards-based blocker and is what actually
//     stops pinch on Chrome / Android WebView.
//   • `user-scalable=no, maximum-scale=1` (index.html) is the old mechanism. Android honours it.
//     **iOS has ignored it since Safari 10** — deliberately, for accessibility — so on iPhone, the
//     platform we most need this on, the meta tag alone does nothing.
//   • WebKit's own answer is the non-standard `gesturestart` / `gesturechange` / `gestureend` pair of
//     events, which fire for a pinch and are cancellable. Preventing them is the ONLY thing that
//     reliably stops viewport zoom inside a WKWebView.
//
// So all three layers are needed, and they are needed together — this is not belt-and-braces, it is
// three platforms each requiring a different mechanism.
//
// 🔒 DELIBERATELY NARROW — pinch, and nothing else.
//
//   • Double-tap-to-zoom is left to `touch-action`, which handles it correctly. A JavaScript
//     double-tap guard would have to swallow a fast second tap, and that breaks real double-taps
//     (selecting a word in an input, any component that wants one). The admin asked about two
//     fingers; scope creep here would cost real behaviour for no request.
//   • Ctrl+wheel and the browser's own zoom controls are untouched. Those are DESKTOP zoom, they are
//     how a low-vision user on a laptop reads anything, and no native-feel argument applies to a
//     window that is already a browser window.
//
// ⚠️ THE HONEST TRADE-OFF, stated rather than buried: pinch-zoom is a genuine accessibility aid on
// mobile (WCAG 1.4.4), and this removes it. NavBharatAI's own `AccessibilityAnalysis` flags exactly
// this pattern in apps we BUILD, and that advice is unchanged and still right for a website. The
// difference is that this shell ships as an installed app on Play and the App Store, where users
// expect app behaviour — and the app has its own font-scale setting, which is the accessible way to
// make text bigger and does not fight the layout. If that ever stops being true, the whole thing
// reverts by deleting one call, one CSS line and two meta attributes.

/** The minimum surface this needs — an object with the two listener methods. Keeps it testable. */
export interface ZoomLockTarget {
  addEventListener(type: string, handler: (e: Event) => void, options?: unknown): void;
  removeEventListener(type: string, handler: (e: Event) => void, options?: unknown): void;
}

/** WebKit's pinch events. Non-standard, and the only cancellable signal iOS gives us. */
export const PINCH_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/**
 * Block WebKit's pinch-to-zoom gesture. Returns a cleanup that removes every listener.
 *
 * `passive: false` is REQUIRED and is the whole point: a passive listener may not call
 * preventDefault, so registering these without it would install three handlers that quietly do
 * nothing — a dead feature that looks alive, which is exactly what this codebase keeps deleting.
 *
 * Never throws: a target that rejects the listener options object (or is not there at all) leaves the
 * app running normally, just without the lock. A native-feel polish must never be able to break the
 * app it is polishing.
 */
export function installZoomLock(target: ZoomLockTarget | null | undefined): () => void {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const block = (e: Event) => {
    // `cancelable` is checked because preventDefault on a non-cancellable event is a console warning
    // in every browser and does nothing useful.
    if (e.cancelable) e.preventDefault();
  };
  const attached: string[] = [];
  for (const type of PINCH_EVENTS) {
    try {
      target.addEventListener(type, block, { passive: false });
      attached.push(type);
    } catch { /* this target cannot take the listener — the other layers still apply */ }
  }
  return () => {
    for (const type of attached) {
      try { target.removeEventListener(type, block, { passive: false } as unknown); } catch { /* already gone */ }
    }
  };
}
