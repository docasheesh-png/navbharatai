/**
 * WHICH LANGUAGE A GAME'S OWN SCREENS SHOULD SPEAK (admin 2026-11-20 game-gap audit: "menus in Indian languages").
 *
 * The game kit speaks English, Hindi and nine more Indian languages (gameStringsIndic.ts), but a builder that is not
 * told the language leaves the menus English. So the request decides, the same way a person would read it:
 *   1. a language NAMED as the game's language — "Tamil mein", "in Telugu", "Bangla version", "marathi language";
 *   2. otherwise the script the request is WRITTEN in — a request typed in Tamil script wants Tamil screens.
 * A language merely mentioned as a subject ("a Tamil movie quiz") is not a language choice, and romanised Hindi
 * (Hinglish) is not a script, so both give null: the kit default (English) stands. PURE.
 */
import { INDIC_GAME_LANGUAGE_NAMES, type IndicGameLanguage } from '../lib/gameStringsIndic';

export type KitGameLanguage = 'en' | 'hi' | IndicGameLanguage;

/** English and the language's own name, for the builder's instruction. */
export const KIT_GAME_LANGUAGE_NAMES: Readonly<Record<KitGameLanguage, string>> = {
  en: 'English', hi: 'Hindi', ...INDIC_GAME_LANGUAGE_NAMES,
};

const NAMES: ReadonlyArray<[KitGameLanguage, string]> = [
  ['en', 'english|angrezi'], ['hi', 'hindi|हिंदी|हिन्दी'], ['ta', 'tamil|தமிழ்'], ['te', 'telugu|తెలుగు'],
  ['bn', 'bangla|bengali|বাংলা'], ['mr', 'marathi|मराठी'], ['gu', 'gujarati|ગુજરાતી'], ['kn', 'kannada|ಕನ್ನಡ'],
  ['ml', 'malayalam|മലയാളം'], ['pa', 'punjabi|panjabi|ਪੰਜਾਬੀ'], ['or', 'odia|oriya|ଓଡ଼ିଆ'],
];
// After the name: what makes it the game's language rather than a subject.
const AFTER = String.raw`(?:language|bhasha|bhasa|bhaasha|version|menus?|ui|text|words|mein|mei|me|men|mai|main|wala|wali|wale|में|ভাষায়|மொழியில்|భాషలో)`;
// Before the name: "in Tamil", "into Telugu".
const BEFORE = String.raw`(?:in|into)`;

const SCRIPTS: ReadonlyArray<[KitGameLanguage, RegExp]> = [
  ['hi', /[ऀ-ॿ]/g], ['bn', /[ঀ-৿]/g], ['pa', /[਀-੿]/g], ['gu', /[઀-૿]/g],
  ['or', /[଀-୿]/g], ['ta', /[஀-௿]/g], ['te', /[ఀ-౿]/g], ['kn', /[ಀ-೿]/g],
  ['ml', /[ഀ-ൿ]/g],
];

export function gameLanguageForRequest(text: string | null | undefined): KitGameLanguage | null {
  const s = String(text ?? '').normalize('NFC').slice(0, 4000);
  if (!s.trim()) return null;
  // 1. Named as the language. The LAST such mention wins ("Tamil me nahi, Telugu me banao").
  let named: { lang: KitGameLanguage; at: number } | null = null;
  for (const [lang, alts] of NAMES) {
    const re = new RegExp(String.raw`(?:^|[^\p{L}])(?:${BEFORE}\s+(?:${alts})(?![\p{L}])|(?:${alts})\s*(?:-\s*)?${AFTER}(?![\p{L}]))`, 'giu');
    for (const m of s.matchAll(re)) {
      const at = m.index ?? 0;
      if (!named || at > named.at) named = { lang, at };
    }
  }
  if (named) {
    // "Marathi" is written in Devanagari too: a named language always beats the script.
    return named.lang;
  }
  // 2. The script the request is written in: most of its letters in one Indian script.
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (letters < 6) return null;
  let best: { lang: KitGameLanguage; n: number } | null = null;
  for (const [lang, re] of SCRIPTS) {
    const n = (s.match(re) ?? []).length;
    if (n > 0 && (!best || n > best.n)) best = { lang, n };
  }
  return best && best.n / letters >= 0.5 ? best.lang : null;
}

/** The builder's instruction for that language, or '' for none/English. */
export function gameLanguageHandoff(language: KitGameLanguage | null | undefined): string {
  if (!language || language === 'en') return '';
  const name = KIT_GAME_LANGUAGE_NAMES[language];
  return `🗣️ GAME LANGUAGE: ${name}. The request asks for ${name}, so pass language: '${language}' to <GameCanvas> `
    + `(or call setGameLanguage('${language}') from src/game/core/strings.ts) — the kit's start screen, pause menu, settings, `
    + `shop, controls and captions are already written in ${name}. Write the game's own text (title, levels, dialogue, `
    + `item names, messages) in ${name} too; never leave a screen in English.`;
}
