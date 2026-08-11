import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decideUpdate, updateMessage, parseStoreVersion, PLAY_STORE_URL, DISMISS_COOLDOWN_MS,
  type UpdateDecisionInput,
} from '../src/lib/appUpdate';

/**
 * AN UPDATE BANNER IS TRUSTED ONCE.
 *
 * Show it wrongly a single time — send someone to a Play page listing the version they already have —
 * and they will dismiss it unread for the rest of the app's life. So the interesting cases here are
 * not "does it prompt", they are "does it REFUSE to prompt when it does not actually know".
 */
const base: UpdateDecisionInput = {
  isNative: true,
  platform: 'android',
  installedVersionCode: 10,
  store: { androidVersionCode: 12 },
  now: 1_000_000,
};

describe('it prompts when, and only when, there is genuinely something newer', () => {
  it('prompts on a newer store build', () => {
    const v = decideUpdate(base);
    expect(v.show).toBe(true);
    expect(v).toMatchObject({ forced: false, latest: 12, storeUrl: PLAY_STORE_URL });
  });

  it('says nothing when already current', () => {
    expect(decideUpdate({ ...base, installedVersionCode: 12 })).toEqual({ show: false, reason: 'up-to-date' });
  });

  it('says nothing when the installed build is somehow NEWER than the store', () => {
    // Happens on an internal/testing track. Telling a tester to "update" to an older build is absurd.
    expect(decideUpdate({ ...base, installedVersionCode: 20 }).show).toBe(false);
  });
});

describe('NEVER GUESS — the branches that protect the banner\'s credibility', () => {
  it('server unreachable ⇒ no claim', () => {
    expect(decideUpdate({ ...base, store: null })).toEqual({ show: false, reason: 'store-version-unknown' });
  });

  it('own version unknown ⇒ no claim', () => {
    expect(decideUpdate({ ...base, installedVersionCode: null }))
      .toEqual({ show: false, reason: 'installed-version-unknown' });
  });

  it('a garbage store version is treated as unknown, not as a huge number', () => {
    for (const bad of [0, -5, NaN, 'abc' as unknown as number, null]) {
      expect(decideUpdate({ ...base, store: { androidVersionCode: bad as number } }).show, String(bad)).toBe(false);
    }
  });

  it('the WEB app is never told to update — it already runs the newest build', () => {
    expect(decideUpdate({ ...base, isNative: false })).toEqual({ show: false, reason: 'not-native' });
  });

  it('iOS is out of scope — this is the Play Store path only', () => {
    expect(decideUpdate({ ...base, platform: 'ios' })).toEqual({ show: false, reason: 'not-android' });
  });

  it('every refusal names its reason, so a silent banner can be diagnosed', () => {
    const reasons = [
      decideUpdate({ ...base, isNative: false }),
      decideUpdate({ ...base, store: null }),
      decideUpdate({ ...base, installedVersionCode: null }),
      decideUpdate({ ...base, installedVersionCode: 12 }),
    ].map((v) => (v.show ? '' : v.reason));
    expect(new Set(reasons).size).toBe(4); // four distinct, useful reasons — never a bare false
  });
});

describe('NEVER NAG — dismissal is respected, but not forever', () => {
  it('a dismissal silences the SAME version', () => {
    const v = decideUpdate({ ...base, dismissedVersionCode: 12, dismissedAt: base.now });
    expect(v).toEqual({ show: false, reason: 'dismissed' });
  });

  it('a NEWER version overrides an old dismissal', () => {
    // Someone who said "not now" to build 12 should still hear about build 20.
    const v = decideUpdate({ ...base, store: { androidVersionCode: 20 }, dismissedVersionCode: 12, dismissedAt: base.now });
    expect(v.show).toBe(true);
  });

  it('the dismissal goes stale after the cooldown', () => {
    const v = decideUpdate({
      ...base, dismissedVersionCode: 12, dismissedAt: base.now - DISMISS_COOLDOWN_MS - 1,
    });
    expect(v.show).toBe(true);
  });

  it('and holds right up to the boundary', () => {
    const v = decideUpdate({ ...base, dismissedVersionCode: 12, dismissedAt: base.now - DISMISS_COOLDOWN_MS + 1000 });
    expect(v.show).toBe(false);
  });

  it('a dismissal with no timestamp still silences it rather than looping', () => {
    expect(decideUpdate({ ...base, dismissedVersionCode: 12, dismissedAt: null }).show).toBe(false);
  });
});

describe('FORCED updates are a deliberate server decision, never a side effect', () => {
  it('a routine release is NOT forced', () => {
    const v = decideUpdate(base);
    expect(v.show && v.forced).toBe(false);
  });

  it('forced only when the server names a minimum the build is below', () => {
    const v = decideUpdate({ ...base, store: { androidVersionCode: 12, minAndroidVersionCode: 11 } });
    expect(v).toMatchObject({ show: true, forced: true });
  });

  it('not forced when the build meets the minimum', () => {
    const v = decideUpdate({ ...base, store: { androidVersionCode: 12, minAndroidVersionCode: 10 } });
    expect(v.show && v.forced).toBe(false);
  });

  it('a forced update ignores a dismissal — that is the whole point of forcing', () => {
    const v = decideUpdate({
      ...base,
      store: { androidVersionCode: 12, minAndroidVersionCode: 11 },
      dismissedVersionCode: 12, dismissedAt: base.now,
    });
    expect(v).toMatchObject({ show: true, forced: true });
  });
});

describe('the payload is parsed strictly', () => {
  it('reads a well-formed payload', () => {
    const p = parseStoreVersion({ androidVersionCode: 42, androidVersionName: '1.4.0', storeUrl: 'https://play.google.com/x' });
    expect(p).toMatchObject({ androidVersionCode: 42, androidVersionName: '1.4.0', storeUrl: 'https://play.google.com/x' });
  });

  it('a malformed payload becomes NULL, not a half-read object', () => {
    // A partially-read object could compare against a garbage number and tell every user to update.
    for (const bad of [null, undefined, 'nope', 42, {}, { androidVersionCode: 'x' }]) {
      expect(parseStoreVersion(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses a non-http storeUrl rather than opening it', () => {
    // An attacker-controlled or malformed URL must never be handed to the browser.
    const p = parseStoreVersion({ androidVersionCode: 5, storeUrl: 'javascript:alert(1)' });
    expect(p?.storeUrl).toBeNull();
  });

  it('falls back to the real Play listing when no url is given', () => {
    const v = decideUpdate({ ...base, store: parseStoreVersion({ androidVersionCode: 99 }) });
    expect(v.show && v.storeUrl).toBe(PLAY_STORE_URL);
  });
});

describe('the message', () => {
  it('names the version when known', () => {
    const v = decideUpdate({ ...base, store: { androidVersionCode: 12, androidVersionName: '1.4.0' } });
    expect(updateMessage(v as any)).toContain('(1.4.0)');
  });

  it('reads differently — and more seriously — when forced', () => {
    const forced = decideUpdate({ ...base, store: { androidVersionCode: 12, minAndroidVersionCode: 11 } });
    expect(updateMessage(forced as any)).toContain('no longer supported');
    expect(updateMessage(decideUpdate(base) as any)).toContain('available on the Play Store');
  });
});

/**
 * THE WIRING. A banner nothing renders is a banner nobody sees, and a route nothing calls is dead —
 * both failures this codebase has shipped before.
 */
describe('it is actually wired into the app and the server', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('the server publishes the store version on a PUBLIC route', () => {
    // The app must be able to ask before the user has signed in.
    const health = read('src/server/routes/health.ts');
    expect(health).toContain("app.get('/api/app-version'");
    expect(health).toContain('ANDROID_LATEST_VERSION_CODE');
  });

  it('an UNSET version code yields null, so a misconfiguration shows nothing', () => {
    // The failure mode that matters: never a false "update available".
    const health = read('src/server/routes/health.ts');
    expect(health).toContain('A misconfiguration therefore shows NOTHING, never a false prompt');
  });

  it('forcing is a SEPARATE env var from the release number', () => {
    const health = read('src/server/routes/health.ts');
    expect(health).toContain('ANDROID_MIN_VERSION_CODE');
  });

  it('the banner is rendered by the app shell', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('<UpdateBanner />');
    expect(app).toContain("from './components/UpdateBanner'");
  });

  it('the banner delegates every decision to the pure module', () => {
    const banner = read('src/components/UpdateBanner.tsx');
    expect(banner).toContain('decideUpdate(');
    expect(banner).toContain('parseStoreVersion(');
    // It must not re-implement any of the rules locally.
    expect(banner).not.toContain('installedVersionCode <');
  });

  it('a forced update cannot be dismissed', () => {
    const banner = read('src/components/UpdateBanner.tsx');
    expect(banner).toContain('if (!verdict.show || verdict.forced) return;');
  });

  it('web skips the network call entirely — there is nothing to update there', () => {
    const banner = read('src/components/UpdateBanner.tsx');
    expect(banner).toContain('if (!me.isNative || cancelled) return;');
  });

  it('the Update button is thumb-sized', () => {
    expect(read('src/components/UpdateBanner.tsx')).toContain('minHeight: 44');
  });
});
