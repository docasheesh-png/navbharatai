import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDeviceCheckPlatform, collectDeviceCheck, deviceCheckAvailable } from '../src/lib/deviceIntegrityNative';

/**
 * The native bridge. Two things are being protected here, and neither is about Play Integrity:
 *
 *   1. AN iPHONE IS NATIVE. playBillingNative.ts records this as a real defect — the Android-only
 *      plugin was registered on iOS and threw on every single launch. This gate is Android or
 *      nothing, for exactly that reason.
 *   2. A PARTIAL RESULT IS A FAILURE. An id with no token is what a forgery looks like, and the
 *      server must never have to guess which half it is missing.
 */

const mockCapacitor = (platform: string, impl?: () => Promise<unknown>) => {
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { getPlatform: () => platform },
    registerPlugin: () => ({ getDeviceCheck: impl ?? (async () => ({ outcome: 'ok' })) }),
  }));
};

afterEach(() => { vi.resetModules(); vi.doUnmock('@capacitor/core'); });

/** Re-import after mocking, because the plugin handle is cached per module instance. */
async function freshCollect() {
  const mod = await import('../src/lib/deviceIntegrityNative');
  return mod.collectDeviceCheck();
}

describe('the platform gate', () => {
  it('is Android and nothing else — an iPhone is native, which is the wrong question', () => {
    expect(isDeviceCheckPlatform('android')).toBe(true);
    expect(isDeviceCheckPlatform('ANDROID')).toBe(true);
    expect(isDeviceCheckPlatform(' android ')).toBe(true);
    for (const p of ['ios', 'web', '', null, undefined, 'electron']) {
      expect(isDeviceCheckPlatform(p), String(p)).toBe(false);
    }
  });

  it('returns "unavailable" on the web rather than throwing', async () => {
    mockCapacitor('web');
    expect((await freshCollect()).outcome).toBe('unavailable');
  });

  it('returns "unavailable" on iOS — no plugin is ever registered there', async () => {
    mockCapacitor('ios');
    expect((await freshCollect()).outcome).toBe('unavailable');
  });
});

describe('🔒 a partial result is a failure', () => {
  it('refuses an id with no token — which is exactly what a forgery looks like', async () => {
    mockCapacitor('android', async () => ({ outcome: 'ok', deviceId: 'a1b2c3d4e5f60718' }));
    const r = await freshCollect();
    expect(r.outcome).toBe('failed');
    expect(r.integrityToken).toBeUndefined();
  });

  it('refuses a token with no id', async () => {
    mockCapacitor('android', async () => ({ outcome: 'ok', integrityToken: 'tok' }));
    expect((await freshCollect()).outcome).toBe('failed');
  });

  it('passes both halves through when the device genuinely answered', async () => {
    mockCapacitor('android', async () => ({ outcome: 'ok', deviceId: 'a1b2c3d4e5f60718', integrityToken: 'tok' }));
    const r = await freshCollect();
    expect(r).toEqual({ outcome: 'ok', deviceId: 'a1b2c3d4e5f60718', integrityToken: 'tok' });
  });
});

describe('🔒 it never throws, on any device', () => {
  it('an older shell without the plugin is "unavailable", not a crash', async () => {
    mockCapacitor('android', async () => { throw new Error('"DeviceIntegrity" plugin is not implemented on android'); });
    const r = await freshCollect();
    expect(r.outcome).toBe('unavailable');
    expect(r.message).toContain('not implemented');
  });

  it('a build with no cloud project number says so, and carries no evidence', async () => {
    mockCapacitor('android', async () => ({ outcome: 'not-configured', message: 'no cloud project' }));
    const r = await freshCollect();
    expect(r.outcome).toBe('not-configured');
    expect(r.deviceId).toBeUndefined();
  });

  it('every junk shape becomes a named outcome rather than an exception', async () => {
    for (const junk of [null, undefined, {}, 'a string', 42]) {
      vi.resetModules();
      mockCapacitor('android', async () => junk as never);
      const r = await freshCollect();
      expect(['failed', 'unavailable'], JSON.stringify(junk)).toContain(r.outcome);
    }
  });
});

describe('deviceCheckAvailable', () => {
  it('is true only when both halves really arrived', async () => {
    mockCapacitor('android', async () => ({ outcome: 'ok', deviceId: 'a1b2c3d4e5f60718', integrityToken: 'tok' }));
    const mod = await import('../src/lib/deviceIntegrityNative');
    expect(await mod.deviceCheckAvailable()).toBe(true);
  });

  it('is false on the web, so no screen offers a button that cannot work', async () => {
    mockCapacitor('web');
    const mod = await import('../src/lib/deviceIntegrityNative');
    expect(await mod.deviceCheckAvailable()).toBe(false);
  });
});

describe('the module never exports a verdict', () => {
  it('has no "verified" boolean — only the SERVER decides whether money moves', async () => {
    const mod = await import('../src/lib/deviceIntegrityNative');
    expect(Object.keys(mod).some((k) => /verified|isvalid|trusted/i.test(k))).toBe(false);
    expect(typeof collectDeviceCheck).toBe('function');
    expect(typeof deviceCheckAvailable).toBe('function');
  });
});
