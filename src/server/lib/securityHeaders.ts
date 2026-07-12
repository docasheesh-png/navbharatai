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
 */
export const securityHeadersConfig: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com", "https://www.google.com", "https://esm.sh", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://cdn.tailwindcss.com", "https://sdk.cashfree.com"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc:    ["'self'", "data:", "https:"],
      frameSrc:   ["'self'", "https:"],
      objectSrc:  ["'none'"],
      // Cashfree checkout redirects by POSTing a form from our page to its hosted pay URL; Helmet's
      // default `form-action 'self'` blocks it. Scope the allowance to Cashfree's own subdomains.
      formAction: ["'self'", "https://*.cashfree.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
};
