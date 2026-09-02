import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PixelInstaller } from './metaPixel';
import {
  isValidPixelId,
  shouldLoadPixel,
  pixelEventFor,
  initMetaPixel,
  forwardToMetaPixel,
  isPixelReady,
  __resetPixelForTests,
} from './metaPixel';

const ID = '1234567890123456';
const base = { pixelId: ID, hasConsent: true, isNative: false, isProd: true };

describe('isValidPixelId — a typo must disable the pixel, not inject junk', () => {
  it('accepts a real numeric pixel id', () => {
    expect(isValidPixelId(ID)).toBe(true);
    expect(isValidPixelId('  1234567890123456  ')).toBe(true);
  });

  it('rejects empty, placeholder and non-numeric values', () => {
    expect(isValidPixelId(null)).toBe(false);
    expect(isValidPixelId(undefined)).toBe(false);
    expect(isValidPixelId('')).toBe(false);
    expect(isValidPixelId('your-pixel-id')).toBe(false);
    expect(isValidPixelId('123')).toBe(false); // too short to be real
    expect(isValidPixelId('12345678901234567890123')).toBe(false); // too long
  });
});

describe('shouldLoadPixel — every reason not to load lives in one place', () => {
  it('loads when prod + consent + web + a valid id', () => {
    expect(shouldLoadPixel(base)).toBe(true);
  });

  it('NEVER loads without analytics consent (GDPR / DPDP)', () => {
    expect(shouldLoadPixel({ ...base, hasConsent: false })).toBe(false);
  });

  it('NEVER loads inside the native app — the Android SDK owns those events', () => {
    expect(shouldLoadPixel({ ...base, isNative: true })).toBe(false);
  });

  it('never loads in dev, so local work cannot pollute real campaign data', () => {
    expect(shouldLoadPixel({ ...base, isProd: false })).toBe(false);
  });

  it('stays off when the id is unset — an unconfigured pixel is silent, not broken', () => {
    expect(shouldLoadPixel({ ...base, pixelId: null })).toBe(false);
  });
});

describe('pixelEventFor — allowlist, and never an invented value', () => {
  it('maps a signup to the standard CompleteRegistration', () => {
    expect(pixelEventFor('signup')).toEqual({ name: 'CompleteRegistration', standard: true });
  });

  it('forwards nothing for an event no code fires — the allowlist carries no dead entries', () => {
    // A mapping for an event nothing emits would let the code send something the published Privacy
    // Policy does not list. See tests/privacyPolicyTruth.test.ts.
    expect(pixelEventFor('checkout_started')).toBeNull();
  });

  it('maps a purchase with a REAL amount to Purchase carrying that amount in INR', () => {
    expect(pixelEventFor('purchase', { value: 499 })).toEqual({
      name: 'Purchase',
      standard: true,
      params: { value: 499, currency: 'INR' },
    });
  });

  it('rounds to paise so no float remainder reaches Meta', () => {
    const e = pixelEventFor('purchase', { value: 499.00000000000006 });
    expect(e?.params).toEqual({ value: 499, currency: 'INR' });
  });

  it('reports a purchase of UNKNOWN value with NO value rather than a guessed one', () => {
    // The sale really happened, so the conversion is still reported — but a fabricated amount would
    // misstate revenue in Meta's reporting and train the campaign on a lie.
    for (const props of [undefined, {}, { value: 0 }, { value: -5 }, { value: 'lots' }]) {
      expect(pixelEventFor('purchase', props as Record<string, unknown>)).toEqual({ name: 'Purchase', standard: true });
    }
  });

  it('maps a built app to a clearly-named CUSTOM event, not a borrowed standard one', () => {
    expect(pixelEventFor('app_generated')).toEqual({ name: 'AppBuilt', standard: false });
  });

  it('forwards NOTHING for ordinary product telemetry — the default is silence', () => {
    for (const e of ['message_sent', 'app_load', 'web_vital', 'feedback', 'anything_else']) {
      expect(pixelEventFor(e)).toBeNull();
    }
  });
});

describe('initMetaPixel — the gates hold at runtime, not just in the pure helper', () => {
  beforeEach(() => __resetPixelForTests());

  // A fake installer stands in for the browser: it records what it was asked to install and hands
  // back a sender that records what was sent. No DOM needed — the decision is what matters.
  const fakeInstall = () => {
    const installed: string[] = [];
    const sent: unknown[][] = [];
    const install = vi.fn((pixelId: string) => {
      installed.push(pixelId);
      return (method: string, name: string, params?: Record<string, unknown>) => { sent.push([method, name, params]); };
    });
    return { install: install as unknown as PixelInstaller, installed, sent };
  };

  const deps = (over: Record<string, unknown> = {}) => ({
    hasConsent: () => true,
    isNative: () => false,
    isProd: true,
    fetchPixelId: vi.fn(async () => ID),
    ...over,
  });

  it('does not even REQUEST the id when consent was declined', async () => {
    const fetchPixelId = vi.fn(async () => ID);
    const f = fakeInstall();
    await initMetaPixel({ ...deps({ hasConsent: () => false, fetchPixelId }), install: f.install });
    expect(fetchPixelId).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
    expect(isPixelReady()).toBe(false);
  });

  it('does not request the id inside the native app — the Android SDK owns those events', async () => {
    const fetchPixelId = vi.fn(async () => ID);
    const f = fakeInstall();
    await initMetaPixel({ ...deps({ isNative: () => true, fetchPixelId }), install: f.install });
    expect(fetchPixelId).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });

  it('does nothing in dev, so local work cannot pollute real campaign data', async () => {
    const f = fakeInstall();
    await initMetaPixel({ ...deps({ isProd: false }), install: f.install });
    expect(f.install).not.toHaveBeenCalled();
  });

  it('installs exactly once with the configured id when everything is satisfied', async () => {
    const f = fakeInstall();
    await initMetaPixel({ ...deps(), install: f.install });
    expect(isPixelReady()).toBe(true);
    expect(f.installed).toEqual([ID]);

    // A second call must not install again (the consent listener calls this on every change).
    await initMetaPixel({ ...deps(), install: f.install });
    expect(f.installed).toEqual([ID]);
  });

  it('trims a padded id before installing', async () => {
    const f = fakeInstall();
    await initMetaPixel({ ...deps({ fetchPixelId: vi.fn(async () => `  ${ID}  `) }), install: f.install });
    expect(f.installed).toEqual([ID]);
  });

  it('stays off when the server reports no configured pixel — unconfigured is silent, not broken', async () => {
    const f = fakeInstall();
    await initMetaPixel({ ...deps({ fetchPixelId: vi.fn(async () => null) }), install: f.install });
    expect(isPixelReady()).toBe(false);
    expect(f.install).not.toHaveBeenCalled();
  });

  it('aborts if consent is withdrawn while the id request is still in flight', async () => {
    let consent = true;
    const f = fakeInstall();
    await initMetaPixel({
      ...deps({ hasConsent: () => consent, fetchPixelId: vi.fn(async () => { consent = false; return ID; }) }),
      install: f.install,
    });
    expect(isPixelReady()).toBe(false);
    expect(f.install).not.toHaveBeenCalled();
  });

  it('a failing config request disables the pixel instead of throwing into the app', async () => {
    const f = fakeInstall();
    await expect(
      initMetaPixel({ ...deps({ fetchPixelId: vi.fn(async () => { throw new Error('offline'); }) }), install: f.install }),
    ).resolves.toBeUndefined();
    expect(isPixelReady()).toBe(false);
  });

  it('an installer that cannot start (no browser) leaves the pixel off, not half-on', async () => {
    await initMetaPixel({ ...deps(), install: () => null });
    expect(isPixelReady()).toBe(false);
  });
});

describe('forwardToMetaPixel — silent until the pixel is genuinely ready', () => {
  beforeEach(() => __resetPixelForTests());

  const start = async () => {
    const sent: unknown[][] = [];
    await initMetaPixel({
      hasConsent: () => true,
      isNative: () => false,
      isProd: true,
      fetchPixelId: async () => ID,
      install: () => (method, name, params) => { sent.push([method, name, params]); },
    });
    return sent;
  };

  it('does nothing at all before the pixel has loaded', () => {
    expect(() => forwardToMetaPixel('signup')).not.toThrow();
    expect(isPixelReady()).toBe(false);
  });

  it('sends a standard event with track, and a custom one with trackCustom', async () => {
    const sent = await start();

    forwardToMetaPixel('signup');
    expect(sent).toContainEqual(['track', 'CompleteRegistration', undefined]);

    forwardToMetaPixel('purchase', { value: 250 });
    expect(sent).toContainEqual(['track', 'Purchase', { value: 250, currency: 'INR' }]);

    forwardToMetaPixel('app_generated');
    expect(sent).toContainEqual(['trackCustom', 'AppBuilt', undefined]);
  });

  it('forwards NOTHING for ordinary product telemetry', async () => {
    const sent = await start();
    forwardToMetaPixel('message_sent');
    forwardToMetaPixel('web_vital', { name: 'LCP' });
    forwardToMetaPixel('app_load');
    expect(sent).toEqual([]);
  });

  it('a throwing sender never escapes into the app', async () => {
    await initMetaPixel({
      hasConsent: () => true,
      isNative: () => false,
      isProd: true,
      fetchPixelId: async () => ID,
      install: () => () => { throw new Error('blocked by an ad blocker'); },
    });
    expect(() => forwardToMetaPixel('signup')).not.toThrow();
  });
});
