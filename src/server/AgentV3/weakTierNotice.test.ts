import { describe, it, expect } from 'vitest';
import { weakTierWelcomeNotice } from './weakTierNotice';

describe('weakTierWelcomeNotice — localized, rotating weak-tier welcome (admin final spec 2026-07-12)', () => {
  it('Hindi (hi) yields a Devanagari notice pointing at the settings button + recharge unlock', () => {
    const t = weakTierWelcomeNotice('hi', 0);
    expect(t).toMatch(/Weak/);
    expect(t).toMatch(/🎚️/);          // the circled settings (sliders) button
    expect(t).toMatch(/recharge|रिचार्ज|₹1/i);
    expect(/[ऀ-ॿ]/.test(t)).toBe(true); // actually Devanagari
  });

  it('null/unknown language falls back to English (covers Hinglish/Latin prompts)', () => {
    for (const code of [null, undefined, 'ta', 'zh']) {
      const t = weakTierWelcomeNotice(code as string | null | undefined, 1);
      expect(t).toMatch(/Weak/);
      expect(t).toMatch(/🎚️/);
      expect(t).toMatch(/recharge/i);
      expect(/[ऀ-ॿ]/.test(t)).toBe(false);
    }
  });

  it('the seed rotates phrasings — same meaning, different words', () => {
    const a = weakTierWelcomeNotice('hi', 0);
    const b = weakTierWelcomeNotice('hi', 1);
    const c = weakTierWelcomeNotice('hi', 2);
    expect(new Set([a, b, c]).size).toBe(3);
    // wraps around deterministically
    expect(weakTierWelcomeNotice('hi', 3)).toBe(a);
  });

  it('never throws on junk seeds', () => {
    expect(() => weakTierWelcomeNotice('hi', NaN)).not.toThrow();
    expect(() => weakTierWelcomeNotice(null, -7)).not.toThrow();
    expect(weakTierWelcomeNotice(null, -7)).toMatch(/Weak/);
  });

  it('is HONEST: never claims a free user can switch tiers without recharging', () => {
    for (const code of ['hi', null]) {
      for (let s = 0; s < 3; s++) {
        const t = weakTierWelcomeNotice(code, s);
        expect(t.toLowerCase()).not.toMatch(/change any ?time|kabhi bhi badal/);
      }
    }
  });
});
