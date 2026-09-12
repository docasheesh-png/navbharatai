import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  adultAccessAllowed, adultPreferenceFrom, adultSettingAvailable, hiddenFromBrowse, adultBadge,
  adultOptInSummary, ADULT_CONFIRMATIONS, ALWAYS_REFUSED, ADULT_PREF_OFF, type ContentClass,
} from './adultContent';

const web = (optedIn: boolean) => ({ optedIn, isNative: false });
const native = (optedIn: boolean) => ({ optedIn, isNative: true });

describe('🔒 the line the toggle may never cross', () => {
  it('illegal content is refused in EVERY state — the toggle is not even consulted', () => {
    for (const opts of [web(true), web(false), native(true), native(false)]) {
      expect(adultAccessAllowed('illegal', opts)).toBe(false);
    }
  });

  it('the always-refused list is data, so it can be read and cannot be widened by accident', () => {
    expect(ALWAYS_REFUSED).toContain('illegal');
  });

  it('the class is checked BEFORE the preference — no user state can reach a refused category', () => {
    // A future edit that wants to let something through has to delete a line naming ALWAYS_REFUSED.
    const src = readFileSync(join(__dirname, 'adultContent.ts'), 'utf8');
    const gate = src.slice(src.indexOf('export function adultAccessAllowed'));
    expect(gate.indexOf('ALWAYS_REFUSED')).toBeLessThan(gate.indexOf('opts.optedIn'));
  });
});

describe('adult content is opt-in AND web-only — both, not either', () => {
  it('off by default', () => {
    expect(adultAccessAllowed('adult', web(false))).toBe(false);
    expect(ADULT_PREF_OFF.optedIn).toBe(false);
  });

  it('on when the user turned it on, on the web', () => {
    expect(adultAccessAllowed('adult', web(true))).toBe(true);
  });

  it('🔒 NEVER in the Android app, even for a user who turned it on', () => {
    // Play policy, and this account has already taken one policy hit — see playCompliance.ts.
    expect(adultAccessAllowed('adult', native(true))).toBe(false);
    expect(adultSettingAvailable(true)).toBe(false);
    expect(adultSettingAvailable(false)).toBe(true);
  });

  it('ordinary content is unaffected everywhere — this setting must cost nobody anything', () => {
    for (const opts of [web(true), web(false), native(true), native(false)]) {
      expect(adultAccessAllowed('general', opts)).toBe(true);
    }
  });
});

describe('reading the stored preference', () => {
  it('anything unreadable is OFF — the safe direction, always', () => {
    for (const bad of [null, undefined, 0, 'yes', [], { optedIn: 'true' }, { optedIn: 1 }]) {
      expect(adultPreferenceFrom(bad).optedIn).toBe(false);
    }
  });

  it('only a real `true` counts, and the date rides with it', () => {
    const p = adultPreferenceFrom({ optedIn: true, optedInAt: '2026-09-12T00:00:00.000Z' });
    expect(p.optedIn).toBe(true);
    expect(p.optedInAt).toBe('2026-09-12T00:00:00.000Z');
  });

  it('a date without the opt-in is discarded — consent is the flag, not the timestamp', () => {
    expect(adultPreferenceFrom({ optedIn: false, optedInAt: '2026-01-01' }).optedInAt).toBe('');
  });
});

describe('browsing', () => {
  const viewerOn = web(true), viewerOff = web(false);

  it('an 18+ app is hidden from someone who has not turned it on', () => {
    expect(hiddenFromBrowse({ contentClass: 'adult' }, viewerOff)).toBe(true);
    expect(hiddenFromBrowse({ contentClass: 'adult' }, viewerOn)).toBe(false);
    expect(hiddenFromBrowse({ contentClass: 'adult' }, native(true))).toBe(true);
  });

  it('an app with no class set is treated as general — absence is never "adult"', () => {
    // A missing field must not hide somebody's ordinary app from every viewer.
    expect(hiddenFromBrowse({}, viewerOff)).toBe(false);
    expect(hiddenFromBrowse({ contentClass: null }, viewerOff)).toBe(false);
  });

  it('an illegal app is hidden from everyone, including the opted-in', () => {
    expect(hiddenFromBrowse({ contentClass: 'illegal' }, viewerOn)).toBe(true);
  });

  it('only an 18+ app carries the badge', () => {
    expect(adultBadge('adult')).toBe('18+');
    for (const c of ['general', 'illegal', null, undefined] as Array<ContentClass | null | undefined>) {
      expect(adultBadge(c)).toBe('');
    }
  });
});

describe('what the user ticks against', () => {
  it('states the age, the narrowness, the hard limit, and where it applies', () => {
    const all = ADULT_CONFIRMATIONS.join(' ').toLowerCase();
    expect(all).toContain('18 years old or older');
    expect(all).toContain('lawful adult content');
    expect(all).toContain('minors');
    expect(all).toContain('android app');
    expect(ADULT_CONFIRMATIONS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('what the admin reads', () => {
  it('a fact, not a boolean', () => {
    expect(adultOptInSummary({ optedIn: false, optedInAt: '' })).toBe('Off');
    expect(adultOptInSummary({ optedIn: true, optedInAt: '2026-09-12T10:00:00.000Z' })).toBe('On since 2026-09-12');
    expect(adultOptInSummary({ optedIn: true, optedInAt: '' })).toBe('On');
  });
});
