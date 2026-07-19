import { describe, it, expect } from 'vitest';
import { generateI18n } from './I18nGenerator';

describe('generateI18n', () => {
  it('emits an init module, a language hook, and one locale file per language (default en+hi)', () => {
    const out = generateI18n(['en', 'hi']);
    expect(Object.keys(out.files).sort()).toEqual([
      'src/i18n/index.ts',
      'src/i18n/locales/en.json',
      'src/i18n/locales/hi.json',
      'src/i18n/useLanguage.ts',
    ]);
    expect(out.dependencies.map((d) => d.name).sort()).toEqual(['i18next', 'react-i18next']);
  });

  it('ships real English + Hindi starter translations', () => {
    const out = generateI18n(['en', 'hi']);
    const en = JSON.parse(out.files['src/i18n/locales/en.json']);
    const hi = JSON.parse(out.files['src/i18n/locales/hi.json']);
    expect(en.welcome).toBe('Welcome');
    expect(hi.welcome).toBe('स्वागत है');
    expect(hi.save).toBe('सहेजें');
  });

  it('always includes English as the fallback and sets a non-English primary when asked', () => {
    const out = generateI18n(['hi']);
    expect(out.files['src/i18n/locales/en.json']).toBeDefined(); // en added as fallback
    expect(out.files['src/i18n/index.ts']).toContain("lng: \"hi\"");
    expect(out.files['src/i18n/index.ts']).toContain("fallbackLng: 'en'");
  });

  it('an unknown language starts from the English keys (a scaffold to translate)', () => {
    const out = generateI18n(['fr']);
    const fr = JSON.parse(out.files['src/i18n/locales/fr.json']);
    expect(fr.welcome).toBe('Welcome'); // English placeholder keys present
    expect(out.files['src/i18n/index.ts']).toContain("import fr from './locales/fr.json'");
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error — malformed input must not throw
    expect(() => generateI18n(null)).not.toThrow();
    expect(() => generateI18n([])).not.toThrow();
  });
});
