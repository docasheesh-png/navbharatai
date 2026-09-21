// `https://localhost/ is not enabled or approved` — the Android top-up, and why a console setting
// could never have fixed it (admin report 2026-09-20/21).
//
// THE SEQUENCE, because the second step is what makes the diagnosis certain rather than plausible:
//   1. tapping Purchase in the Android app showed that error;
//   2. the admin whitelisted the app package `com.navbharat.ai` in the gateway console — APPROVED —
//      and the error did not change.
//
// It could not have. The app is a Capacitor shell in BUNDLED mode, so its WebView origin is
// `https://localhost`; `paymentService.ts` loads the gateway's JAVASCRIPT SDK into that WebView; and
// a browser SDK identifies its merchant by PAGE ORIGIN, never by package name. Nobody can own
// `localhost`, and every Capacitor app on earth shares it.
//
// `apiBase.ts` cannot rescue it either, and its own docblock says why: it rewrites fetch and
// XMLHttpRequest, and already names the WebSocket as "the ONE transport the rewrite above cannot
// reach". A third-party script reading `window.location.origin` is the second — no transport is
// involved, so there is nothing to intercept.
//
// THE FIX IS AN ORIGIN, NOT A WHITELIST ENTRY: the app opens our own `/pay` page, served by
// `navbharatai.com`, in the SYSTEM BROWSER. That origin is already approved in the same console.
//
// These tests lock the four things that make it work and keep it honest.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECKOUT_HANDOFF_PATH,
  checkoutMode,
  checkoutHandoffUrl,
} from '../src/server/lib/checkoutHandoff';
import { checkoutHandoffHtml } from '../src/server/lib/checkoutHandoff';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';
import { NATIVE_API_ORIGIN } from '../src/lib/apiBase';

// The module pulls in a Capacitor plugin that has no meaning under Node.
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => undefined) } }));
const { shouldHandOffCheckout } = await import('../src/services/paymentService');

describe('WHO hands off — the native shell, and only where the origin is really unusable', () => {
  it('the plain web never hands off — today’s behaviour, byte for byte', () => {
    expect(shouldHandOffCheckout(false, 'https://navbharatai.com')).toBe(false);
    expect(shouldHandOffCheckout(false, 'http://localhost:5173')).toBe(false);
  });

  it('the bundled Android shell DOES — this is the reported failure', () => {
    expect(shouldHandOffCheckout(true, 'https://localhost')).toBe(true);
  });

  it('the bundled iOS shell does too (its origin is a custom scheme, even less approvable)', () => {
    expect(shouldHandOffCheckout(true, 'capacitor://localhost')).toBe(true);
  });

  it('🔒 a HOSTED native shell does NOT — it is already on the approved origin', () => {
    // Handing off there would throw the user out of the app for no reason at all. Same two-part test
    // `needsApiRewrite` makes, for the same underlying reason.
    expect(shouldHandOffCheckout(true, NATIVE_API_ORIGIN)).toBe(false);
  });
});

describe('WHERE it hands off to — and the session must not leak on the way', () => {
  it('points at our own page on the approved origin', () => {
    const url = checkoutHandoffUrl(NATIVE_API_ORIGIN, 'session_abc', 'production');
    expect(url.startsWith(`${NATIVE_API_ORIGIN}${CHECKOUT_HANDOFF_PATH}`)).toBe(true);
    expect(CHECKOUT_HANDOFF_PATH).toBe('/pay');
  });

  it('🔒 THE SESSION TRAVELS IN THE FRAGMENT, NEVER THE QUERY STRING', () => {
    // A fragment is never sent to a server, never lands in an access log, and never appears in a
    // Referer header. A query string does all three. This is the whole reason the page reads
    // `location.hash`, and it is one character away from being wrong.
    const url = checkoutHandoffUrl(NATIVE_API_ORIGIN, 'session_abc', 'production');
    const [beforeHash, afterHash] = url.split('#');
    expect(beforeHash).not.toContain('session_abc');
    expect(beforeHash).not.toContain('?');
    expect(afterHash).toContain('session_abc');
  });

  it('encodes a session that contains URL punctuation, and tolerates a trailing slash on the origin', () => {
    expect(checkoutHandoffUrl(NATIVE_API_ORIGIN, 'a b&c=d#e', 'sandbox')).toContain(encodeURIComponent('a b&c=d#e'));
    expect(checkoutHandoffUrl('https://navbharatai.com/', 's', 'production')).toBe(`${NATIVE_API_ORIGIN}/pay#s=s&env=production`);
  });

  it('mode: only the exact word sandbox means sandbox; anything unknown means production', () => {
    expect(checkoutMode('sandbox')).toBe('sandbox');
    expect(checkoutMode(' SANDBOX ')).toBe('sandbox');
    expect(checkoutMode('production')).toBe('production');
    // The dangerous mistake is taking real money in a test environment; this ordering cannot make it.
    for (const junk of ['', null, undefined, 'prod', 'test', 42, {}]) {
      expect(checkoutMode(junk as unknown)).toBe('production');
    }
  });
});

describe('the page itself', () => {
  const html = checkoutHandoffHtml();

  it('🔒 IS DECLARED TO THE SPA CATCH-ALL, or it would answer 200 with the app shell', () => {
    // The worst version of spaFallback.ts's own documented bug: the app opens a payment link and is
    // served index.html, so the user sees a blank-looking page instead of a checkout — and nothing
    // fails anywhere.
    expect(spaFallbackShouldDefer('/pay')).toBe(true);
    expect(spaFallbackShouldDefer('/pay/')).toBe(true);
    // and an ordinary client route is still the SPA's
    expect(spaFallbackShouldDefer('/store')).toBe(false);
  });

  it('reads the session from the hash, not from a query parameter', () => {
    expect(html).toContain('location.hash');
    expect(html).not.toContain('location.search');
  });

  it('never leaves the user on a silent spinner — every failure says something', () => {
    expect(html).toContain('onerror');                    // a blocked or offline SDK
    expect(html).toMatch(/missing its payment session/);  // a malformed link
    expect(html).toMatch(/did not load/);                 // a partial load
    expect(html).toMatch(/Nothing has been charged/);     // and it says so, which is the true part
  });

  it('asks search engines to stay out — a payment redirector is not a page to index', () => {
    expect(html).toMatch(/noindex/);
    expect(html).toMatch(/no-referrer/);
  });
});

describe('🔒 REVERSION GUARD — the native branch must stay in the source', () => {
  // Deleting the hand-off would make no behavioural test above fail on the WEB path, and the web
  // path is the one CI can exercise. So the branch is asserted in the source itself.
  const src = readFileSync(join(process.cwd(), 'src/services/paymentService.ts'), 'utf8');

  it('triggerCashfreeCheckout still consults shouldHandOffCheckout before the in-page SDK', () => {
    const handOffAt = src.indexOf('shouldHandOffCheckout(');
    const inPageAt = src.indexOf("if ((window as any).Cashfree)");
    expect(handOffAt).toBeGreaterThan(-1);
    expect(inPageAt).toBeGreaterThan(-1);
    expect(handOffAt).toBeLessThan(inPageAt);
  });

  it('and it opens the SYSTEM browser, not another WebView', () => {
    expect(src).toContain("from '@capacitor/browser'");
    expect(src).toContain('Browser.open(');
  });
});
