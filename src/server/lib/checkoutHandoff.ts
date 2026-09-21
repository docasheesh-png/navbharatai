// THE CHECKOUT HAND-OFF — why a payment cannot start inside the Android app, and the one place it can.
//
// 🔴 THE FAILURE (admin, 2026-09-20/21): tapping Purchase in the Android app shows
// `https://localhost/ is not enabled or approved`. Whitelisting the app package `com.navbharat.ai`
// in the gateway's console was APPROVED and did not change it — which is not a surprise once the
// mechanism is named.
//
// THE MECHANISM: this app is a Capacitor shell in BUNDLED mode, so the WebView serves our own files
// from the origin `https://localhost` (Capacitor's `androidScheme` default; `apiBase.ts` exists
// entirely because of that fact). We do NOT use the gateway's native Android SDK — `paymentService.ts`
// loads their **JavaScript** SDK into that WebView, and a browser SDK identifies its merchant by the
// **page origin**. So the gateway is asked to approve `https://localhost`:
//
//   • it can never approve it — nobody owns `localhost`, and every Capacitor app on earth shares it;
//   • APP whitelisting cannot help, because the JS SDK never sends a package name;
//   • `apiBase.ts`'s rewrite cannot help either. That module rewrites fetch and XMLHttpRequest, and
//     it already names the WebSocket as "the ONE transport the rewrite above cannot reach". A
//     third-party SDK reading `window.location.origin` is the second: no transport is involved, so
//     there is nothing to intercept.
//
// 🔑 THE FIX IS NOT A WHITELIST ENTRY, IT IS AN ORIGIN. `navbharatai.com` is already an APPROVED
// website in that same console. So the native app stops trying to run checkout locally and opens
// this page — served BY navbharatai.com — in the system browser. The SDK then runs on an origin the
// gateway has approved, which is the condition it was actually checking all along.
//
// 🔒 THE SESSION ID TRAVELS IN THE URL **FRAGMENT**, and that is deliberate. A fragment is never sent
// to a server, never appears in an access log, and is never put in a Referer header — so handing the
// page its session costs strictly less exposure than the status quo, where the same value is already
// delivered to the client and handed to the SDK. This server therefore never sees it, and there is
// nothing here to log, store or leak.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not authenticate. The payment session IS the capability
// — it is minted by the gateway for one order, it is short-lived, and the client already holds it.
// Adding a sign-in wall here would only break the hand-off, because the system browser does not carry
// the app's session.

/** The public path this page is served at. Must also be declared in `spaFallback.ts`. */
export const CHECKOUT_HANDOFF_PATH = '/pay';

/** The only two modes the gateway's SDK accepts. Anything else is refused rather than guessed. */
export type CheckoutMode = 'production' | 'sandbox';

/**
 * Narrow an arbitrary string to a mode. PURE.
 *
 * Unknown ⇒ `production`, and that is the safe direction here rather than the usual "refuse on
 * doubt": a live session opened in sandbox mode fails outright, while a sandbox session opened in
 * production mode is rejected by the gateway with its own clear message. The dangerous mistake is
 * the one that silently takes real money in a test environment, and this ordering cannot make it.
 */
export function checkoutMode(raw: unknown): CheckoutMode {
  return String(raw ?? '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
}

/**
 * The absolute URL the native app opens. PURE.
 *
 * `origin` is passed in rather than read from a constant so the caller (which already knows the API
 * origin from `apiBase.ts`) stays the single source of truth for where our server lives.
 */
export function checkoutHandoffUrl(origin: string, sessionId: string, mode: CheckoutMode): string {
  const s = encodeURIComponent(sessionId);
  return `${origin.replace(/\/+$/, '')}${CHECKOUT_HANDOFF_PATH}#s=${s}&env=${mode}`;
}

/**
 * The page itself: no framework, no bundle, no app shell — it exists for the seconds between the tap
 * and the gateway's own screen, and every one of those seconds is a user staring at a blank phone.
 *
 * It names no vendor in what the user reads. The gateway's own branding appears on the page it
 * redirects to, which is theirs and is unavoidable; ours stays ours.
 */
export function checkoutHandoffHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Opening secure checkout — NavBharatAI</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#0d1117; color:#e6edf3; padding:24px; }
  .card { max-width:22rem; text-align:center; }
  .spin { width:38px; height:38px; margin:0 auto 20px; border-radius:50%;
          border:3px solid rgba(255,255,255,.18); border-top-color:#4f46e5; animation:r .9s linear infinite; }
  @keyframes r { to { transform:rotate(360deg); } }
  h1 { font-size:1rem; font-weight:700; margin:0 0 8px; }
  p  { font-size:.82rem; line-height:1.55; color:#9aa4b2; margin:0; }
  .err { color:#f8b4b4; }
  @media (prefers-color-scheme: light) {
    body { background:#ffffff; color:#111827; } p { color:#4b5563; } .err { color:#b91c1c; }
    .spin { border-color:rgba(0,0,0,.12); border-top-color:#4f46e5; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="spin" id="spin"></div>
    <h1 id="t">Opening secure checkout…</h1>
    <p id="m">Please do not close this page.</p>
  </div>
<script>
(function () {
  var t = document.getElementById('t'), m = document.getElementById('m'), spin = document.getElementById('spin');
  function fail(msg) {
    if (spin) spin.style.display = 'none';
    t.textContent = 'Checkout could not be opened';
    m.className = 'err';
    m.textContent = msg + ' Nothing has been charged. Please go back to NavBharatAI and try again.';
  }
  // The session rides in the FRAGMENT, so it never reached this server and is not in any log.
  var q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  var session = q.get('s') || '';
  var mode = q.get('env') === 'sandbox' ? 'sandbox' : 'production';
  if (!session) { fail('This link is missing its payment session.'); return; }
  var el = document.createElement('script');
  el.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
  el.async = true;
  el.onload = function () {
    try {
      if (typeof window.Cashfree !== 'function') { fail('The payment gateway did not load.'); return; }
      window.Cashfree({ mode: mode }).checkout({ paymentSessionId: session, redirectTarget: '_self' });
    } catch (e) {
      fail('The payment gateway refused to start.');
    }
  };
  // Without onerror a blocked or offline SDK fails SILENTLY and the user watches a spinner for ever.
  el.onerror = function () { fail('The payment gateway could not be reached.'); };
  document.body.appendChild(el);
})();
</script>
</body>
</html>`;
}
