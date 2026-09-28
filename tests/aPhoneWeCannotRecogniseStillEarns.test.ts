/**
 * ADMIN 2026-09-27: "mobile recognition aapko 100% fix karna hai, abhi problem aa rahi hai!!"
 *
 * THE FINDING. The build live on Play (134, built 2026-09-25) sends a Play Integrity request with no
 * nonce, which the SDK refuses before it reaches Google — so every device check on every phone fails.
 * The fix (#3338) is in builds 137 and 138, neither of which is on Play. Build 134 also cannot send a
 * native phone OTP (the `phone` provider was not listed). No server change can make build 134 attest.
 *
 * WHAT CAN BE MADE TRUE, and is locked here:
 *   1. Three of the five steps (signup ₹50, login ₹50, mobile ₹100) pay the same on both surfaces, so
 *      they never needed the phone to be recognised. The sign-in settle every client already calls —
 *      build 134 included — pays the day-one two; a phone whose check fails falls back to the web rules.
 *   2. A transient Play Integrity failure (no network, Google busy) is retried on the phone before it
 *      is reported as a failure.
 *   3. The preflight no longer calls a build "able to attest" when it predates the nonce fix.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isTransientIntegrityFailure, DEVICE_CHECK_RETRY_DELAYS_MS } from '../src/lib/deviceIntegrityNative';
import { FIRST_RELEASE_WITH_DEVICE_PLUGIN, FIRST_RELEASE_THAT_ATTESTS, classifyRelease } from '../src/server/lib/referralPreflight';
import { DAY_ONE_STEPS } from '../src/server/lib/referralRewards';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

afterEach(() => { vi.resetModules(); vi.doUnmock('@capacitor/core'); vi.doUnmock('../src/lib/deviceIntegrityNative'); vi.unstubAllGlobals(); });

describe('1 · a phone we cannot recognise still earns what the website earns', () => {
  it('🔴 the client sends a failed-device claim for a web step under the web rules, instead of dropping it', async () => {
    vi.doMock('../src/lib/deviceIntegrityNative', () => ({
      collectDeviceCheck: async () => ({ outcome: 'failed', message: 'Missing required properties: nonce' }),
    }));
    const posted: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      posted.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ ok: true, granted: 10_000, rupees: 100 }) };
    }));
    const { postReferral } = await import('../src/lib/referralClaim');
    const r = await postReferral('/api/referral/U/claim', { step: 'signup' }, 'android');
    expect(r.rupees).toBe(100);
    const claim = posted.find((p) => p.url.endsWith('/claim'))!;
    expect(claim.body).toEqual({ step: 'signup', platform: 'web' });
    // Still counted as a failed device check on the admin's tally.
    expect(posted.some((p) => p.url.endsWith('/claim-failed'))).toBe(true);
  });

  it('the app-only steps (code, GitHub) still need a device that can be checked', async () => {
    vi.doMock('../src/lib/deviceIntegrityNative', () => ({
      collectDeviceCheck: async () => ({ outcome: 'failed', message: 'x' }),
    }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
    const { postReferral } = await import('../src/lib/referralClaim');
    for (const step of ['github', 'referral-code']) {
      await expect(postReferral('/api/referral/U/claim', { step }, 'android'), step).rejects.toThrow(/could not check this device/i);
    }
  });

  it('the sign-in settle every client already calls pays the day-one steps — build 134 included', () => {
    const payment = read('src/server/routes/payment.ts');
    const reconcile = payment.slice(payment.indexOf("app.post('/api/payment/reconcile'"));
    expect(reconcile.slice(0, 4000)).toMatch(/settleWebReferralSteps\(db, userId, \{ only: DAY_ONE_STEPS \}\)/);
    // Never the mobile there: it would make a new app user "old" before their typed code is applied.
    expect([...DAY_ONE_STEPS]).toEqual(['signup', 'email']);
  });

  it('the server falls back too, for a phone that sends a token Google will not accept', () => {
    const route = read('src/server/routes/referral.ts');
    const deviceRefusal = route.slice(route.indexOf("const device = await proveDevice(req);\n      if (device.verdict !== 'verified') {\n        // 🔒 The CLASS"));
    expect(deviceRefusal.slice(0, 1500)).toMatch(/if \(stepAllowedOnWeb\(step\)\) return await claimWeb\(db, userId, res, 'android'\);/);
  });
});

describe('2 · a transient Play Integrity failure is retried on the phone', () => {
  it('knows Google’s transient codes, and nothing else', () => {
    for (const m of ['Integrity API error (-3): Network error', '-12: Google server unavailable', 'error -100', '-8 too many requests', '-17', 'request timed out']) {
      expect(isTransientIntegrityFailure(m), m).toBe(true);
    }
    for (const m of ['Integrity API error (-1): API not available', '-16: cloud project number is invalid', '-2 Play Store not found', 'Missing required properties: nonce', '', null]) {
      expect(isTransientIntegrityFailure(m), String(m)).toBe(false);
    }
  });

  it('retries a transient failure and returns the success that follows', async () => {
    let calls = 0;
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { getPlatform: () => 'android' },
      registerPlugin: () => ({
        getDeviceCheck: async () => (++calls < 3
          ? { outcome: 'failed', message: 'Integrity API error (-12): server unavailable' }
          : { outcome: 'ok', deviceId: 'a1b2c3d4e5f60718', integrityToken: 'tok' }),
      }),
    }));
    const { collectDeviceCheck } = await import('../src/lib/deviceIntegrityNative');
    const waited: number[] = [];
    const r = await collectDeviceCheck(async (ms) => { waited.push(ms); });
    expect(r.outcome).toBe('ok');
    expect(calls).toBe(3);
    expect(waited).toEqual([...DEVICE_CHECK_RETRY_DELAYS_MS]);
  });

  it('never retries a permanent failure — the user is not made to wait for the same answer', async () => {
    let calls = 0;
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { getPlatform: () => 'android' },
      registerPlugin: () => ({ getDeviceCheck: async () => { calls++; return { outcome: 'failed', message: '-16: cloud project number is invalid' }; } }),
    }));
    const { collectDeviceCheck } = await import('../src/lib/deviceIntegrityNative');
    const r = await collectDeviceCheck(async () => { throw new Error('must not sleep'); });
    expect(r.outcome).toBe('failed');
    expect(calls).toBe(1);
  });
});

describe('3 · the preflight tells the truth about which builds can attest', () => {
  it('🔴 build 134 carries the plugin but cannot attest — the nonce fix first shipped in 137', () => {
    expect(FIRST_RELEASE_WITH_DEVICE_PLUGIN).toBe(117);
    expect(FIRST_RELEASE_THAT_ATTESTS).toBe(137);
    const live = classifyRelease('134');
    expect(live.state).toBe('failed');
    expect(live.detail).toMatch(/137/);
    expect(classifyRelease('137').state).toBe('ok');
    expect(classifyRelease('138').state).toBe('ok');
  });

  it('the fix really is in the plugin source that 137 was built from', () => {
    const plugin = read('android/app/src/main/java/com/navbharatai/app/DeviceIntegrityPlugin.java');
    expect(plugin).toMatch(/\.setNonce\(freshNonce\(\)\)/);
    expect(read('capacitor.config.ts')).toMatch(/providers: \[[^\]]*'phone'[^\]]*\]/);
  });
});
