import type { HelmetOptions } from 'helmet';

/**
 * P-TQA.10 — single source of truth for the app's HTTP security-header policy (Helmet config).
 *
 * Extracted from `server.ts` so the exact policy that ships in production can be unit-tested
 * (`tests/security/headers.test.ts`) — a regression that weakens CSP, drops `X-Content-Type-Options`,
 * or breaks the OAuth-popup-safe COOP would now fail CI instead of silently going live.
 *
 * The directives encode hard-won fixes — DO NOT tighten blindly:
 *  - `scriptSrc` / `frameSrc` allow Google + https so Firebase Auth (popup/redirect + reCAPTCHA)
 *    and the embedded live app PREVIEW keep working.
 *  - `scriptSrc` ALSO allows the preview CDNs (esm.sh for React + npm deps, jsdelivr/cdnjs for the
 *    Babel-standalone fallback): the in-browser preview's <iframe srcDoc> inherits THIS page's CSP,
 *    and a module `import('https://esm.sh/react…')` is governed by script-src — without these hosts
 *    React fails to load and the preview dies with `Missing dependency "react"`.
 *    The preview's CDN-resilience fallbacks (ReactPreview.ts) MUST all be allow-listed here or they are
 *    silently CSP-blocked and never fire: `https://esm.run` is rung 2 (jsdelivr's ESM shortcut — it was
 *    MISSING, so rung 2 was dead: import('https://esm.run/react-dom…') was blocked, never a real
 *    fallback; autopsy ce713a7e 2026-08-02), and `https://unpkg.com` is rung 4, a genuinely-independent
 *    origin so a two-host esm.sh+jsdelivr blip on the React core can't blank the preview.
 *  - `crossOriginOpenerPolicy: 'same-origin-allow-popups'` keeps `window.opener` alive so
 *    `signInWithPopup` can deliver the OAuth credential back to the app.
 *  - `scriptSrc` allows `https://sdk.cashfree.com` — the Cashfree v3 checkout SDK (`cashfree.js`) is
 *    injected as a <script> at pay time; without this host CSP blocks the load and the "Purchase"
 *    button silently does nothing (the payment never boots). The checkout itself opens in an https
 *    frame (covered by `frameSrc`) and talks to the API over https (`connectSrc`).
 *  - `formAction` allows `https://*.cashfree.com` — Cashfree v3 `cashfree.checkout({redirectTarget:
 *    '_self'})` navigates by SUBMITTING A FORM from our page to the hosted checkout URL (observed:
 *    `https://api.cashfree.com/pg/view/sessions/checkout`; sandbox/payments live on sibling
 *    subdomains). Helmet's DEFAULT CSP includes `form-action 'self'`, which blocks that POST — the SDK
 *    loads, an order is created, but the browser silently refuses the redirect ("load hota hai, phir
 *    kuch nahi"). Allowing Cashfree's own domain here is the piece that actually opens the pay page;
 *    it is domain-scoped (only *.cashfree.com), so it does not broadly weaken form-action.
 *  - `formAction` ALSO allows `https://appleid.apple.com` — "Sign in with Apple" on the WEB is the same
 *    class of bug as Cashfree above. authDomain = our own origin (navbharatai.com, served via the
 *    reverse-proxy), so Firebase's OAuth handler runs under THIS CSP. Apple's web OAuth uses
 *    `response_mode=form_post` and the handler auto-SUBMITS A FORM to `appleid.apple.com/auth/authorize`
 *    — which `form-action 'self'` silently blocks, so browser Apple login never reaches Apple and fails.
 *    Google/GitHub use redirect GETs (not form_post) so they were unaffected; the phone app uses the
 *    NATIVE Apple sheet (no CSP) so it worked. Scoped to Apple's own auth host — no broad weakening.
 *  - `styleSrc` allows `https://fonts.googleapis.com` — the image editor's font picker (2026-09-21)
 *    loads a family's face on demand with a `<link rel="stylesheet">`, and a STYLESHEET is governed by
 *    `style-src`, not by `font-src`. `fontSrc` already allowed `https:` so the .woff2 files from
 *    fonts.gstatic.com were never the problem; without this line the stylesheet that NAMES them is
 *    blocked, `document.fonts.check` comes back false for all 44 families, and every font silently
 *    falls back to the device default. Found by reading this file before shipping rather than from a
 *    user's screenshot, and scoped to Google's own font host — it grants no script or frame rights.
 */
export const securityHeadersConfig: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com", "https://www.google.com", "https://esm.sh", "https://esm.run", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.tailwindcss.com", "https://sdk.cashfree.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc:    ["'self'", "data:", "https:"],
      frameSrc:   ["'self'", "https:"],
      objectSrc:  ["'none'"],
      // Cashfree checkout redirects by POSTing a form from our page to its hosted pay URL; Helmet's
      // default `form-action 'self'` blocks it. Scope the allowance to Cashfree's own subdomains.
      formAction: ["'self'", "https://*.cashfree.com", "https://appleid.apple.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
};

/**
 * Permissions-Policy — powerful features this platform never uses are switched OFF for the page and for
 * everything it frames (forensic audit 2026-10-04; ZAP rule 10063 flagged the header as missing).
 *
 * ⚠️ DELIBERATELY NOT LISTED: camera, microphone, geolocation, motion sensors, payment, MIDI, XR,
 * clipboard, fullscreen, autoplay. The app uses some of them itself (voice, screen share) and DELEGATES
 * the rest to the preview frames (`PREVIEW_IFRAME_ALLOW`) so a user's app can use them; a policy that
 * named them `(self)` would silently break that delegation to cross-origin previews. Only features with
 * no user in the platform or its previews are denied here, so this can only remove capability nobody has.
 */
export const PERMISSIONS_POLICY = [
  'usb=()',
  'serial=()',
  'hid=()',
  'bluetooth=()',
  'browsing-topics=()',
  'interest-cohort=()',
].join(', ');

export function permissionsPolicyMiddleware() {
  return (_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void): void => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    next();
  };
}

/**
 * 🔴 A PAGE THAT ANSWERS ITS OPENER MUST NOT CARRY OUR OPENER POLICY (admin 2026-10-07, Q-732).
 *
 * Admin, verbatim: *"kabhi kabhi (30% time) google login nahi hota hai … google id/pass → login
 * successfully → back to navbharatai → still logout"* — web only, phone and desktop browsers, no error.
 *
 * `crossOriginOpenerPolicy: 'same-origin-allow-popups'` above is right for the APP page (the opener):
 * it lets the windows it opens stay connected to it. But helmet sent it on EVERY response, including
 * the pages that run INSIDE those windows and must hand a result back: Firebase's sign-in handler
 * (`/__/auth/handler`, proxied from Firebase because authDomain is our own domain) and the GitHub
 * callback. Measured in real Chromium (two origins, the exact shape of the flow):
 *
 *   handler WITH this header  → the app saw the popup as "closed" 0.4 s after it went to Google, and
 *                               the return page found `window.opener === null`
 *   handler WITHOUT it        → "closed" only when the popup really closed; the result was posted back
 *
 * A document with `same-origin-allow-popups` that navigates to a cross-origin page with no policy
 * (Google's sign-in pages only send a REPORT-ONLY policy) forces a browsing-context-group switch, and
 * that switch severs the popup from the app for good. Firebase polls `popup.closed` every 2 s, sees
 * "closed", waits 8 s for a result, then rejects `auth/popup-closed-by-user`; the app gave it 2.5 s
 * more and then treated it as the user's own cancel — silently. So a user who picked an account in a
 * few seconds got in (the result still crawled through Firebase's storage relay in time), and a user
 * who typed an email and password — longer than ~10 s — stayed logged out with no error. That is the
 * 30%. The 2026-07-11 grace window and the 2026-08-20 move of Supabase-connect to a full-page redirect
 * ("GitHub's COOP severs window.opener") were both this same header, treated at the symptom.
 *
 * So: the opener keeps its policy; a popup-return page gets none (the browser default, which is what
 * Firebase's own handler on *.firebaseapp.com has always run under). `tests/aPopupReturnPageKeepsItsOpener.test.ts`
 * holds the census — a new server page that talks to `window.opener` must be listed here or CI fails.
 */
export const POPUP_RETURN_PATHS: readonly string[] = [
  '/__/auth',                    // Firebase sign-in handler + iframe (Google / GitHub / Apple), proxied
  '/__/firebase',                // Firebase helper config the handler loads, proxied
  '/api/auth/github/callback',   // GitHub repo-connect popup return (githubAuth.ts)
  '/auth/github',                // …same handler, legacy path
  '/api/github/callback',        // …same handler, legacy path
  '/api/auth/firebase',          // Firebase DevOps "not available" popup page (firebaseAuth.ts)
];

/** True when `path` is a popup-return page, or under one. PURE. */
export function isPopupReturnPath(path: string | null | undefined): boolean {
  const p = String(path || '');
  return POPUP_RETURN_PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * Removes the opener policy from popup-return pages. Mounted right after helmet (server.ts), so it
 * undoes exactly the one header helmet just set and nothing else.
 */
export function popupReturnOpenerPolicyMiddleware() {
  return (req: { path?: string }, res: { removeHeader: (k: string) => void }, next: () => void): void => {
    if (isPopupReturnPath(req.path)) res.removeHeader('Cross-Origin-Opener-Policy');
    next();
  };
}

/**
 * The upstream's own response headers for a proxied popup-return page, minus any opener policy. The
 * proxy writes these with `writeHead`, which would otherwise put an upstream policy straight back. PURE.
 */
export function withoutOpenerPolicy<T extends Record<string, unknown>>(headers: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() !== 'cross-origin-opener-policy') out[k] = v;
  }
  return out as T;
}
