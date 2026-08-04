// T2.5 (roadmap 2026-07-19) — Internationalization (i18n) generator (Tier-2, frontend UX pack).
//
// The audit flagged i18n as 🟡: a machine-translation tool existed, but no real i18n INFRASTRUCTURE
// (react-i18next + locale files + a language switcher) — so a generated app could not actually be
// multilingual. This emits a complete react-i18next setup: an init module, one JSON locale file per
// requested language (English + Hindi ship with real starter translations — on-brand for NavBharatAI's
// India-first identity; other languages start from the English keys for the user to translate), and a
// tiny language-switcher hook. Dependency: i18next + react-i18next.
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

export interface I18nResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

// Starter keys every app can use immediately; real translations for the two first-class languages.
const KEYS = ['app_name', 'welcome', 'loading', 'save', 'cancel', 'error'] as const;
const EN: Record<string, string> = {
  app_name: 'My App', welcome: 'Welcome', loading: 'Loading…', save: 'Save', cancel: 'Cancel', error: 'Something went wrong',
};
const HI: Record<string, string> = {
  app_name: 'मेरा ऐप', welcome: 'स्वागत है', loading: 'लोड हो रहा है…', save: 'सहेजें', cancel: 'रद्द करें', error: 'कुछ गलत हो गया',
};
const TRANSLATIONS: Record<string, Record<string, string>> = { en: EN, hi: HI };

/** A language code reduced to a safe lowercase token (e.g. "en", "hi", "pt-br"). */
function cleanLang(l: string): string {
  return String(l || '').trim().toLowerCase().replace(/[^a-z-]/g, '');
}

/**
 * Generate a react-i18next setup for the given language codes (default ["en","hi"]). Pure — returns the
 * files. English is always included as the fallback. Never throws.
 */
export function generateI18n(languages: string[]): I18nResult {
  const cleaned = (Array.isArray(languages) ? languages : []).map(cleanLang).filter(Boolean);
  const set = new Set(cleaned.length ? cleaned : ['en', 'hi']);
  set.add('en'); // always keep English as the fallback language
  const langs = Array.from(set);
  const primary = langs.find((l) => l !== 'en') || 'en';

  const files: Record<string, string> = {};
  for (const lang of langs) {
    const dict = TRANSLATIONS[lang] || EN; // unknown language starts from the English keys, to translate
    const obj: Record<string, string> = {};
    for (const k of KEYS) obj[k] = dict[k];
    files[`src/i18n/locales/${lang}.json`] = JSON.stringify(obj, null, 2) + '\n';
  }

  const imports = langs.map((l) => `import ${l.replace(/-/g, '_')} from './locales/${l}.json';`).join('\n');
  const resources = langs.map((l) => `    ${JSON.stringify(l)}: { translation: ${l.replace(/-/g, '_')} },`).join('\n');

  files['src/i18n/index.ts'] = `import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
${imports}

// Real i18n infrastructure. Add keys to the locale JSON files; use them with useTranslation().t('key').
i18n.use(initReactI18next).init({
  resources: {
${resources}
  },
  lng: ${JSON.stringify(primary)},
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});

export default i18n;
`;

  files['src/i18n/useLanguage.ts'] = `import { useTranslation } from 'react-i18next';

// Read + switch the active language. e.g. const { language, setLanguage, languages } = useLanguage();
export const LANGUAGES = ${JSON.stringify(langs)} as const;

export function useLanguage() {
  const { i18n } = useTranslation();
  return {
    language: i18n.language,
    languages: LANGUAGES,
    setLanguage: (lng: string) => i18n.changeLanguage(lng),
  };
}
`;

  return {
    files,
    dependencies: [
      { name: 'i18next', version: '^23' },
      { name: 'react-i18next', version: '^14' },
    ],
    instructions:
      `Wired react-i18next for [${langs.join(', ')}] (fallback: en). Import it ONCE at your app entry:\n` +
      `  import './i18n'; // in src/main.tsx, before rendering\n` +
      `Then translate anywhere:\n` +
      `  import { useTranslation } from 'react-i18next';\n` +
      `  const { t } = useTranslation(); <h1>{t('welcome')}</h1>\n` +
      `Switch language with useLanguage() (src/i18n/useLanguage.ts). English + Hindi ship with real starter ` +
      `translations; add keys to the locale JSON files as your UI grows.`,
  };
}
