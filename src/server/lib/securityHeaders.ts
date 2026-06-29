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
 *  - `crossOriginOpenerPolicy: 'same-origin-allow-popups'` keeps `window.opener` alive so
 *    `signInWithPopup` can deliver the OAuth credential back to the app.
 */
export const securityHeadersConfig: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://www.gstatic.com", "https://www.google.com"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc:    ["'self'", "data:", "https:"],
      frameSrc:   ["'self'", "https:"],
      objectSrc:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
};
