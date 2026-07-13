import { describe, it, expect } from 'vitest';
import { weakTierWelcomeNotice } from './weakTierNotice';

describe('weakTierWelcomeNotice — localized, rotating weak-tier welcome (admin final spec 2026-07-12, improved 2026-07-13)', () => {
  it('Hindi (hi) yields a Devanagari notice pointing at the 🎛️ options button + recharge unlock', () => {
    const t = weakTierWelcomeNotice('hi', 0);
    expect(t).toMatch(/Weak/);
    expect(t).toMatch(/🎛️/);           // the real settings/options (sliders) button icon
    expect(t).not.toMatch(/🎚️/);       // the OLD, mismatching vertical-fader icon must be gone
    expect(t).toMatch(/recharge|रिचार्ज/i);
    expect(/[ऀ-ॿ]/.test(t)).toBe(true); // actually Devanagari
  });

  it('does NOT advertise the ₹1 minimum recharge anymore (admin 2026-07-13)', () => {
    for (const code of ['hi', 'en', null, 'ta', 'bn', 'te']) {
      for (let s = 0; s < 3; s++) {
        const t = weakTierWelcomeNotice(code as string | null, s);
        expect(t).not.toMatch(/₹\s*1\b/);   // no "₹1" hint in any language/variant
      }
    }
  });

  it('each major Indian language returns a notice in ITS OWN script (not English)', () => {
    const cases: Array<[string, RegExp]> = [
      ['bn', /[ঀ-৿]/],   // Bengali
      ['pa', /[਀-੿]/],   // Gurmukhi
      ['gu', /[઀-૿]/],   // Gujarati
      ['or', /[଀-୿]/],   // Odia
      ['ta', /[஀-௿]/],   // Tamil
      ['te', /[ఀ-౿]/],   // Telugu
      ['kn', /[ಀ-೿]/],   // Kannada
      ['ml', /[ഀ-ൿ]/],   // Malayalam
      ['ar', /[؀-ۿ]/],   // Urdu (Arabic script)
    ];
    for (const [code, script] of cases) {
      const t = weakTierWelcomeNotice(code, 0);
      expect(t).toMatch(/Weak/);
      expect(t).toMatch(/🎛️/);
      expect(script.test(t)).toBe(true);   // the translation is really in that language's script
    }
  });

  it('null/unknown/non-Indian language falls back to English (Hinglish/Latin, and zh/ja/ko/ru)', () => {
    for (const code of [null, undefined, 'zh', 'ja', 'ko', 'ru']) {
      const t = weakTierWelcomeNotice(code as string | null | undefined, 1);
      expect(t).toMatch(/Weak/);
      expect(t).toMatch(/🎛️/);
      expect(t).toMatch(/recharge/i);
      expect(/[ऀ-ॿ]/.test(t)).toBe(false);
    }
  });

  it('the seed rotates Hindi/English phrasings — same meaning, different words', () => {
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
    for (const code of ['hi', null, 'ta']) {
      for (let s = 0; s < 3; s++) {
        const t = weakTierWelcomeNotice(code, s);
        expect(t.toLowerCase()).not.toMatch(/change any ?time|kabhi bhi badal/);
      }
    }
  });
});
