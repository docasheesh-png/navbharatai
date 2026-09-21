// FIVE TO TEN SECONDS ON OUR OWN PAGE, BETWEEN "Purchase" AND THE GATEWAY (admin 2026-09-21,
// verbatim: *"button prss aur cashfee page par jane me 5-10second lag rhe, hamare page par hi"*).
//
// THE CAUSE WAS AN ORDER OF OPERATIONS, NOT A SLOW NETWORK. The purchase ran strictly in series:
//
//     click → await POST /api/payment/create-order   (our server → the gateway's orders API)
//           → THEN create <script src="https://sdk.cashfree.com/js/v3/cashfree.js">
//           → THEN checkout()
//
// **The SDK does not need the session id.** Nothing about fetching a third-party script depends on
// the order existing — so the download was queued behind a network round trip for no reason, and
// the user waited for the SUM of the two while looking at our page. There was no `preconnect`
// either, so that second step also paid for a cold DNS lookup and TLS handshake.
//
// The fix is to start the download when the purchase BEGINS, beside the order call. Nothing is
// preloaded for people who never press Purchase, and the native shell — which hands the checkout to
// the system browser and never touches this SDK — downloads nothing at all.
//
// These tests lock the parts that a later edit could silently undo. Three of them are SOURCE-level,
// because `tsc` and `vitest` cannot see that a call sits before an `await` rather than after it,
// and putting it back afterwards would restore the 5-10 seconds while every behavioural test stayed
// green — which is exactly how this shipped in the first place.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => undefined) } }));

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments are where the REASONS live, so a source assertion must not be satisfied by one. */
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SDK_HOST = 'https://sdk.cashfree.com';

describe('the connection is warmed before the button is ever pressed', () => {
  const html = read('index.html');

  it('index.html preconnects to the gateway SDK origin', () => {
    expect(html).toMatch(/<link[^>]+rel="preconnect"[^>]+sdk\.cashfree\.com/);
    // crossorigin matters: a script is fetched in CORS mode, and a preconnect without it opens a
    // connection the script cannot reuse — the hint would look present and buy nothing.
    expect(html).toMatch(/rel="preconnect"[^>]*crossorigin|crossorigin[^>]*rel="preconnect"/);
    expect(html).toMatch(/<link[^>]+rel="dns-prefetch"[^>]+sdk\.cashfree\.com/);
  });

  it('🔒 preconnect is a HINT — the page must not also download the SDK for every visitor', () => {
    // A `rel="preload"`/`<script src=…>` here would make every visitor to the site pay for a
    // payment SDK they will probably never use. The download belongs to the purchase.
    expect(html).not.toMatch(/rel="preload"[^>]+sdk\.cashfree\.com/);
    expect(html).not.toMatch(/<script[^>]+src="[^"]*sdk\.cashfree\.com/);
  });
});

describe('preloadCheckoutSdk — one load, shared, and a retry that is really a retry', () => {
  let appended: any[] = [];

  beforeEach(() => {
    vi.resetModules();
    appended = [];
    (globalThis as any).window = { location: { origin: 'https://navbharatai.com' } };
    (globalThis as any).document = {
      createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
      body: { appendChild: (el: any) => appended.push(el) },
    };
  });
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('is idempotent — two callers share ONE script tag and ONE promise', async () => {
    const { preloadCheckoutSdk } = await import('../src/services/paymentService');
    const a = preloadCheckoutSdk();
    const b = preloadCheckoutSdk();
    expect(appended).toHaveLength(1);
    expect(a).toBe(b);

    (globalThis as any).window.Cashfree = () => ({});
    appended[0].onload();
    expect(await a).toBe(true);
    expect(await b).toBe(true);

    // Once the global exists there is nothing left to fetch.
    await preloadCheckoutSdk();
    expect(appended).toHaveLength(1);
  });

  it('🔒 A FAILED load is NOT remembered — caching the failure would kill Purchase for the session', async () => {
    const { preloadCheckoutSdk } = await import('../src/services/paymentService');
    const first = preloadCheckoutSdk();
    appended[0].onerror();
    expect(await first).toBe(false);

    // One bad moment on a train must not leave a permanently dead button.
    const second = preloadCheckoutSdk();
    expect(appended).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it('a script that ARRIVES BROKEN also lets a retry through, and is reported as broken not missing', async () => {
    const { preloadCheckoutSdk } = await import('../src/services/paymentService');
    const first = preloadCheckoutSdk();
    appended[0].onload();                    // resolved, but no global
    expect(await first).toBe(false);
    preloadCheckoutSdk();
    expect(appended).toHaveLength(2);
  });

  it('asks for the real SDK, asynchronously', async () => {
    const { preloadCheckoutSdk } = await import('../src/services/paymentService');
    preloadCheckoutSdk();
    expect(appended[0].src).toBe(`${SDK_HOST}/js/v3/cashfree.js`);
    expect(appended[0].async).toBe(true);
  });
});

describe('warmCheckout — and the one place it must spend nothing', () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as any).document = {
      createElement: () => ({ src: '', async: false, onload: null, onerror: null }),
      body: { appendChild: () => undefined },
    };
  });
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('🔒 DOWNLOADS NOTHING ON THE NATIVE SHELL — that path never runs this SDK', async () => {
    // The app hands the checkout to the system browser, so fetching the SDK inside the WebView
    // would spend a mobile user's data on a script that cannot run there.
    let appended = 0;
    (globalThis as any).window = { location: { origin: 'https://localhost' }, Capacitor: { isNativePlatform: () => true } };
    (globalThis as any).document.body.appendChild = () => { appended += 1; };
    const { warmCheckout } = await import('../src/services/paymentService');
    warmCheckout();
    expect(appended).toBe(0);
  });

  it('DOES warm it on the plain web, where the in-page SDK is the real path', async () => {
    let appended = 0;
    (globalThis as any).window = { location: { origin: 'https://navbharatai.com' } };
    (globalThis as any).document.body.appendChild = () => { appended += 1; };
    const { warmCheckout } = await import('../src/services/paymentService');
    warmCheckout();
    expect(appended).toBe(1);
  });
});

describe('🔒 SOURCE GUARDS — what tsc and vitest structurally cannot see', () => {
  it('the purchase starts the SDK BEFORE awaiting the order, not after', () => {
    const src = codeOf('src/hooks/usePaymentEngine.ts');
    const warm = src.indexOf('warmCheckout()');
    const order = src.indexOf("axios.post('/api/payment/create-order'");
    expect(warm, 'warmCheckout() is not called at all').toBeGreaterThan(-1);
    expect(order).toBeGreaterThan(-1);
    // THE WHOLE FIX IS THIS ORDERING. Moving the call below the await restores the serial wait and
    // breaks no behavioural test anywhere in this repo.
    expect(warm).toBeLessThan(order);
  });

  it('the warm-up is NOT awaited — an optimisation may never fail a purchase', () => {
    const src = codeOf('src/hooks/usePaymentEngine.ts');
    expect(src).not.toMatch(/await\s+warmCheckout\s*\(/);
  });

  it('the checkout builds no <script> of its own any more — one loader, or the memo means nothing', () => {
    // A second inline `createElement('script')` would fetch the SDK twice and make the shared
    // promise a decoration.
    const src = codeOf('src/services/paymentService.ts');
    expect(src.match(/createElement\('script'\)/g) || []).toHaveLength(1);
    expect(src.match(/sdk\.cashfree\.com/g) || []).toHaveLength(1);
  });
});
