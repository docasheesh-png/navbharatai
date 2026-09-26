/**
 * App Mart's INSTALL-ON-ANDROID half must not exist on an iPhone (admin 2026-09-26: "App Mart ka
 * Android half iOS par hide kar do").
 *
 * WHY THIS SUITE IS MOSTLY SOURCE-LEVEL. The rule is two pure functions plus WHERE they are applied,
 * and the second half is what actually protects anything: a correct predicate wired into four of the
 * five surfaces is the App Store rejection this repo already paid for once. `tsc` and `vitest` cannot
 * see that a gate was dropped from one JSX condition — nothing fails, the section simply comes back —
 * so the wiring is asserted against the source, with comments stripped first so a docblock that
 * merely DESCRIBES a gate can never stand in for one.
 *
 * Every assertion below was proven by reversion: removing the filter, either JSX gate, the download
 * refusal, or swapping the platform read for `isNativeApp()` each turns this file red.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { androidInstallsHidden, visibleAndroidApps } from '../src/lib/appStoreCompliance';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STORE = stripComments(read('src/components/ide/NavAppStore.tsx'));
const COMPLIANCE = read('src/lib/appStoreCompliance.ts');

describe('the decision: Apple hardware, and nothing else', () => {
  it('iOS hides the Android half', () => {
    expect(androidInstallsHidden('ios')).toBe(true);
  });

  it('Android does NOT — it is the one platform where an .apk genuinely installs', () => {
    expect(androidInstallsHidden('android')).toBe(false);
  });

  it('the web does not', () => {
    expect(androidInstallsHidden('web')).toBe(false);
  });

  it('spelling and spacing cannot smuggle a wrong answer through', () => {
    expect(androidInstallsHidden('iOS')).toBe(true);
    expect(androidInstallsHidden('  IOS  ')).toBe(true);
  });

  it('a platform string this build has never heard of is NOT Apple', () => {
    // The asymmetry is deliberate and is `isApplePlatform`'s own: a wrong "yes" removes a working
    // capability from a real user, a wrong "no" only leaves today's behaviour on a platform that
    // does not exist here.
    expect(androidInstallsHidden('tizen')).toBe(false);
    expect(androidInstallsHidden('')).toBe(false);
    expect(androidInstallsHidden(null)).toBe(false);
    expect(androidInstallsHidden(undefined)).toBe(false);
  });
});

describe('the list is the chokepoint', () => {
  const apps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('an Apple device is shown no Android listings at all', () => {
    expect(visibleAndroidApps(apps, 'ios')).toEqual([]);
  });

  it('every other device sees the whole list, in order', () => {
    expect(visibleAndroidApps(apps, 'android')).toEqual(apps);
    expect(visibleAndroidApps(apps, 'web')).toEqual(apps);
  });

  it('it returns a COPY, so no caller can mutate the source list', () => {
    const out = visibleAndroidApps(apps, 'android');
    expect(out).not.toBe(apps);
    out.pop();
    expect(apps).toHaveLength(3);
  });

  it('an empty list stays empty rather than throwing', () => {
    expect(visibleAndroidApps([], 'ios')).toEqual([]);
    expect(visibleAndroidApps([], 'android')).toEqual([]);
  });
});

describe('"is this iOS?" has exactly one owner', () => {
  it('appStoreCompliance asks storePurchase instead of re-matching the string', () => {
    expect(COMPLIANCE).toContain("import { isApplePlatform } from './storePurchase'");
    // A second literal match is how two copies of one fact drift apart — the class this repo has
    // paid for with safeRelPath, tagsOnLine, the HTML boot guard and PLAYWRIGHT_BROWSERS_PATH.
    expect(stripComments(COMPLIANCE)).not.toMatch(/===\s*'ios'/);
  });
});

describe('the wiring — where the rule is actually applied', () => {
  it('the platform is read from getPlatform(), NEVER from isNativeApp()', () => {
    // isNativeApp() is true on an Android phone too, so a gate built on it would hide Android apps
    // from the Android app. This is the exact mistake purchaseRail was rejected for.
    expect(STORE).toContain('const STORE_PLATFORM = nativePlatformName();');
    expect(STORE).toContain('const HIDE_ANDROID_INSTALLS = androidInstallsHidden(STORE_PLATFORM);');
    expect(STORE).not.toMatch(/androidInstallsHidden\(\s*isNativeApp/);
  });

  it('the Android list is filtered at the one place it enters state', () => {
    expect(STORE).toMatch(/setApps\(visibleAndroidApps\(/);
    // ...and nowhere does an unfiltered assignment survive beside it.
    expect(STORE).not.toMatch(/setApps\(Array\.isArray/);
  });

  it('the INSTALL section itself is gated, so no empty-state apology renders on an iPhone', () => {
    const half2 = STORE.split('\n').filter((l) => l.includes("tab === 'browse'") && l.includes('HIDE_ANDROID_INSTALLS'));
    expect(half2).toHaveLength(1);
    expect(half2[0]).toContain('!HIDE_ANDROID_INSTALLS');
  });

  it('the app-detail sheet is gated too — defence in depth behind the tile filter', () => {
    expect(STORE).toMatch(/\{openApp && !HIDE_ANDROID_INSTALLS && \(/);
  });

  it('the download itself refuses, before anything else in the function', () => {
    const fn = STORE.slice(STORE.indexOf('const startDownload = useCallback'));
    const guard = fn.indexOf('if (HIDE_ANDROID_INSTALLS) return;');
    const busy = fn.indexOf('if (dlBusy) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(busy).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(busy);
  });
});

describe('the scope — what this change must NOT have touched', () => {
  it('the instant-app half is not gated: it runs in the WebView and is why the page exists on iOS', () => {
    const half1 = STORE.slice(STORE.indexOf('Play instantly') - 2000, STORE.indexOf('Play instantly'));
    expect(half1).not.toContain('HIDE_ANDROID_INSTALLS');
  });

  it('"My apps" still shows the creator their own submissions — a record, with nothing to install', () => {
    const mine = STORE.split('\n').filter((l) => l.includes("tab === 'mine'"));
    expect(mine.length).toBeGreaterThan(0);
    for (const line of mine) expect(line).not.toContain('HIDE_ANDROID_INSTALLS');
  });

  it('the Publish tab still explains how to build an Android app of your OWN project', () => {
    // A builder telling you how to produce an artifact is not a store handing one out, and that is
    // NavBharatAI's actual product. Gating it would be scope the admin did not ask for.
    expect(STORE).toContain('Want a real Android app (.apk) instead?');
  });

  it('Android and the web keep byte-identical behaviour — the gate is false for both', () => {
    expect(androidInstallsHidden('android')).toBe(false);
    expect(visibleAndroidApps([{ id: 'x' }], 'android')).toEqual([{ id: 'x' }]);
    expect(androidInstallsHidden('web')).toBe(false);
    expect(visibleAndroidApps([{ id: 'x' }], 'web')).toEqual([{ id: 'x' }]);
  });
});
