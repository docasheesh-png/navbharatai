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
 */
export const securityHeadersConfig: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com", "https://www.google.com", "https://esm.sh", "https://esm.run", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.tailwindcss.com", "https://sdk.cashfree.com"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
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
