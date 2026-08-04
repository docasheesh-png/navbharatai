import { describe, it, expect } from 'vitest';
import { weakTierWelcomeNotice, weakTierBuildFailedNotice } from './weakTierNotice';

describe('weakTierWelcomeNotice — localized, rotating weak-tier welcome (admin final spec 2026-07-12, improved 2026-07-13)', () => {
  it('Hindi (hi) yields a Devanagari notice pointing at the ⚙️ options button + recharge unlock', () => {
    const t = weakTierWelcomeNotice('hi', 0);
    expect(t).toMatch(/Weak/);
    expect(t).toMatch(/⚙️/);            // the real Settings gear button icon (composer toolbar)
    expect(t).not.toMatch(/🎛️|🎚️/);    // the OLD mismatching slider/fader icons must be gone
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
      expect(t).toMatch(/⚙️/);
      expect(script.test(t)).toBe(true);   // the translation is really in that language's script
    }
  });

  it('null/unknown/non-Indian language falls back to English (Hinglish/Latin, and zh/ja/ko/ru)', () => {
    for (const code of [null, undefined, 'zh', 'ja', 'ko', 'ru']) {
      const t = weakTierWelcomeNotice(code as string | null | undefined, 1);
      expect(t).toMatch(/Weak/);
      expect(t).toMatch(/⚙️/);
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

describe('weakTierBuildFailedNotice — weak-tier build-failed → switch-to-Strong guidance (admin spec 2026-08-02)', () => {
  it('Hindi (hi): Devanagari, names Weak + Strong, points at the ⚙️ options button', () => {
    const t = weakTierBuildFailedNotice('hi');
    expect(t).toMatch(/Weak/);
    expect(t).toMatch(/Strong/);
    expect(t).toMatch(/⚙️/);
    expect(t).toMatch(/complex/i);
    expect(/[ऀ-ॿ]/.test(t)).toBe(true);
  });

  it('English default (null/unknown/non-Indian) names Weak + Strong, no Devanagari', () => {
    for (const code of [null, undefined, 'zh', 'ja', 'ko', 'ru']) {
      const t = weakTierBuildFailedNotice(code as string | null | undefined);
      expect(t).toMatch(/Weak/);
      expect(t).toMatch(/Strong/);
      expect(t).toMatch(/⚙️/);
      expect(/[ऀ-ॿ]/.test(t)).toBe(false);
    }
  });

  it('each major Indian language returns the guidance in ITS OWN script', () => {
    const cases: Array<[string, RegExp]> = [
      ['bn', /[ঀ-৿]/], ['pa', /[਀-੿]/], ['gu', /[઀-૿]/], ['or', /[଀-୿]/],
      ['ta', /[஀-௿]/], ['te', /[ఀ-౿]/], ['kn', /[ಀ-೿]/], ['ml', /[ഀ-ൿ]/], ['ar', /[؀-ۿ]/],
    ];
    for (const [code, script] of cases) {
      const t = weakTierBuildFailedNotice(code);
      expect(t).toMatch(/Weak/);
      expect(t).toMatch(/Strong/);
      expect(script.test(t)).toBe(true);
    }
  });

  it('WHITE-LABEL: never leaks a provider/model name in any language', () => {
    const forbidden = /\b(glm|kimi|moonshot|claude|anthropic|sonnet|opus|haiku|gemini|vertex|grok|bedrock|deepseek|openai|gpt)\b/i;
    for (const code of [null, 'hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar', 'zh']) {
      expect(weakTierBuildFailedNotice(code as string | null)).not.toMatch(forbidden);
    }
  });

  it('never throws on junk input', () => {
    expect(() => weakTierBuildFailedNotice(undefined)).not.toThrow();
    expect(weakTierBuildFailedNotice('xx')).toMatch(/Weak/);
  });
});

describe('control location + icon are CORRECT (real-screenshot fix 2026-08-02): ⚙️ gear, BELOW the message box', () => {
  it('every welcome + failed notice points at the ⚙️ gear, never the wrong 🎛️/🎚️ icon', () => {
    const codes = [null, 'hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar', 'zh'] as (string | null)[];
    for (const c of codes) {
      for (const t of [weakTierWelcomeNotice(c, 0), weakTierWelcomeNotice(c, 1), weakTierWelcomeNotice(c, 2), weakTierBuildFailedNotice(c)]) {
        expect(t).toMatch(/⚙️/);
        expect(t).not.toMatch(/🎛️|🎚️/);
      }
    }
  });

  it('English notices say the button is BELOW the message box, never LEFT of it', () => {
    for (let s = 0; s < 3; s++) {
      expect(weakTierWelcomeNotice(null, s).toLowerCase()).toContain('below the message box');
      expect(weakTierWelcomeNotice(null, s).toLowerCase()).not.toContain('left of the message box');
    }
    expect(weakTierBuildFailedNotice(null).toLowerCase()).toContain('below the message box');
    expect(weakTierBuildFailedNotice(null).toLowerCase()).not.toContain('left of the message box');
  });
});
