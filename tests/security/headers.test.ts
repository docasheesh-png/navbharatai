import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import type { Server } from 'http';
import { securityHeadersConfig } from '../../src/server/lib/securityHeaders';

/**
 * P-TQA.10 — DAST-style security-header assertion.
 *
 * Boots a minimal Express app using the EXACT production Helmet config (securityHeaders.ts) and
 * makes a real HTTP request, asserting the response carries the required security headers. This is
 * the in-process complement to the nightly OWASP ZAP baseline scan (.github/workflows/dast.yml,
 * P-SEC.2): ZAP scans a deployed instance; this fails fast on every PR if the policy regresses.
 */
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(helmet(securityHeadersConfig));
  app.get('/', (_req, res) => res.send('ok'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('P-TQA.10 — production security headers', () => {
  it('sets a Content-Security-Policy with the locked-down defaults', async () => {
    const res = await fetch(baseUrl);
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    // OAuth/Firebase-required allowances must remain (regression guard both ways).
    expect(csp).toContain('https://apis.google.com');
    // The in-browser preview's srcdoc iframe inherits this CSP and imports React + npm deps from
    // esm.sh (and the Babel-standalone fallback from jsdelivr/cdnjs). Without these in script-src the
    // preview dies with `Missing dependency "react"`. Guard them so a CSP tighten can't silently
    // re-break the in-browser preview.
    expect(csp).toContain('https://esm.sh');
    expect(csp).toContain('https://cdn.jsdelivr.net');
    expect(csp).toContain('https://cdnjs.cloudflare.com');
    // The preview's CDN-resilience fallback rungs (ReactPreview.ts) are governed by script-src too — if
    // a rung's host is not allow-listed it is silently CSP-blocked and never fires. esm.run is rung 2
    // (jsdelivr's ESM shortcut; it was MISSING, so the "fallback" was dead — autopsy ce713a7e) and
    // unpkg.com is rung 4, the independent origin. Guard both so a CSP tighten can't re-kill resilience.
    expect(csp).toContain('https://esm.run');
    expect(csp).toContain('https://unpkg.com');
    // Tailwind apps load the Play CDN (cdn.tailwindcss.com) inside the preview iframe so the no-build
    // preview is STYLED — without this in script-src the preview renders unstyled. Guard it stays.
    expect(csp).toContain('https://cdn.tailwindcss.com');
    // The Cashfree v3 checkout SDK (sdk.cashfree.com/js/v3/cashfree.js) is injected as a <script> when
    // the user pays — without this host in script-src, CSP blocks the load and the "Purchase" button
    // silently does nothing. Guard it so a CSP tighten can't re-break payments.
    expect(csp).toContain('https://sdk.cashfree.com');
    // Cashfree checkout REDIRECTS by submitting a form to its hosted pay URL (api.cashfree.com/...).
    // Helmet's default `form-action 'self'` blocks that POST — the SDK loads and an order is created,
    // but the browser refuses the redirect (payment never opens). This allowance is what actually
    // opens the pay page; guard it (and that 'self' is retained) so a CSP change can't re-break it.
    expect(csp).toContain("form-action 'self' https://*.cashfree.com https://appleid.apple.com");
    // "Sign in with Apple" on the WEB: authDomain is our own origin, so Firebase's OAuth handler runs
    // under THIS CSP and auto-SUBMITS a form to appleid.apple.com (Apple uses response_mode=form_post).
    // form-action 'self' silently blocked it → browser Apple login failed (native/Google were unaffected).
    // Guard the Apple auth host stays in form-action so a CSP tighten can't re-break browser Apple login.
    expect(csp).toContain('https://appleid.apple.com');
  });

  it('sets X-Content-Type-Options: nosniff (blocks MIME sniffing)', async () => {
    const res = await fetch(baseUrl);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets a Cross-Origin-Opener-Policy that keeps the OAuth popup working', async () => {
    const res = await fetch(baseUrl);
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups');
  });

  it('sets Referrer-Policy (helmet default: no-referrer)', async () => {
    const res = await fetch(baseUrl);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('does NOT leak the X-Powered-By: Express banner', async () => {
    const res = await fetch(baseUrl);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('sets X-DNS-Prefetch-Control (helmet baseline hardening)', async () => {
    const res = await fetch(baseUrl);
    expect(res.headers.get('x-dns-prefetch-control')).toBe('off');
  });
});
