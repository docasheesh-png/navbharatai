// THE GAME SPEAKS INDIAN LANGUAGES (admin 2026-11-20 game-gap audit: "menus in Indian languages: Tamil, Telugu, Bangla
// and others"). Runs the REAL generated core/strings.ts: nine more languages with every word, every {placeholder} and
// every key name kept; 'auto' finds them; the player's own choice in Settings is saved and wins; and the request decides
// which language the builder is told to use.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { INDIC_GAME_LANGUAGES } from '../src/server/lib/gameStringsIndic';
import { gameLanguageForRequest, gameLanguageHandoff } from '../src/server/AgentV3/gameLanguage';
import { gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-indic-strings-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let S: any;
const store = new Map<string, string>();
const g = globalThis as any;
beforeAll(async () => {
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } };
  for (const [p, c] of Object.entries(generateGameRuntime(['strings']).files)) {
    mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c);
  }
  S = await import(join(DIR, 'src/game/core/strings.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete g.localStorage; delete g.document; delete g.navigator; });
beforeEach(() => { store.clear(); delete g.document; S.setGameLanguage('en'); });

const SCRIPT: Record<string, RegExp> = {
  ta: /[஀-௿]/, te: /[ఀ-౿]/, bn: /[ঀ-৿]/, mr: /[ऀ-ॿ]/, gu: /[઀-૿]/,
  kn: /[ಀ-೿]/, ml: /[ഀ-ൿ]/, pa: /[਀-੿]/, or: /[଀-୿]/,
};
const placeholders = (v: string) => (v.match(/\{[a-z]+\}/gi) ?? []).sort();
const TOKENS = ['WASD', 'Space', 'Esc', 'XP', 'FPS'];

describe('🗣️ nine more Indian languages in the kit', () => {
  it('every language has every word, keeps every {placeholder} and key name, and is written in its own script', () => {
    const en = S.GAME_STRINGS.en;
    expect(S.GAME_LANGUAGES).toEqual(['en', 'hi', ...INDIC_GAME_LANGUAGES]);
    for (const lang of INDIC_GAME_LANGUAGES) {
      const table = S.GAME_STRINGS[lang];
      expect(Object.keys(table).sort(), lang).toEqual(Object.keys(en).sort());
      let inScript = 0;
      for (const [k, v] of Object.entries<string>(table)) {
        expect(v.trim(), `${lang}.${k} is blank`).not.toBe('');
        expect(placeholders(v), `${lang}.${k} placeholders`).toEqual(placeholders(en[k]));
        for (const tok of TOKENS) if (new RegExp(`\\b${tok}\\b`).test(en[k])) expect(v, `${lang}.${k} lost ${tok}`).toMatch(new RegExp(`\\b${tok}\\b`));
        if (SCRIPT[lang].test(v)) inScript += 1;
        // Not English left behind: a word the same as the English one is only allowed for a pure token.
        if (v === en[k]) expect(/^[A-Z0-9 {}]+$/.test(v), `${lang}.${k} is untranslated`).toBe(true);
      }
      expect(inScript / Object.keys(table).length, `${lang} script share`).toBeGreaterThan(0.95);
      expect(S.GAME_LANGUAGE_NATIVE_NAMES[lang]).toMatch(SCRIPT[lang]);
    }
  });

  it('setGameLanguage shows the language, and t() fills its placeholders', () => {
    S.setGameLanguage('ta');
    expect(S.t('play')).toBe(S.GAME_STRINGS.ta.play);
    expect(S.t('scoreBest', { score: 12, best: 40 })).toContain('12');
    expect(S.t('scoreBest', { score: 12, best: 40 })).toContain('40');
    S.setGameLanguage('bn');
    expect(S.gameLanguage()).toBe('bn');
  });

  it("'auto' finds the page's language, then the browser's", () => {
    g.document = { documentElement: { lang: 'te-IN' } };
    expect(S.setGameLanguage('auto')).toBe('te');
    g.document = { documentElement: { lang: '' } };
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'ml-IN' }, configurable: true });
    expect(S.setGameLanguage('auto')).toBe('ml');
    g.document = { documentElement: { lang: 'fr' } };
    expect(S.setGameLanguage('auto')).toBe('en');
  });

  it("the player's choice in Settings is saved and wins; going back restores the game's own words", () => {
    S.setGameLanguage('hi', { play: 'शुरू' });
    expect(S.t('play')).toBe('शुरू');
    expect(S.choosePlayerLanguage('ta')).toBe('ta');
    expect(S.t('play')).toBe(S.GAME_STRINGS.ta.play);       // the Hindi word change does not leak into Tamil
    expect(store.get('nb-game-lang-v1')).toBe('ta');
    // Next launch: the game asks for Hindi again; the player's Tamil wins.
    S.setGameLanguage('hi', { play: 'शुरू' });
    expect(S.currentGameLanguage()).toBe('ta');
    expect(S.t('play')).toBe(S.GAME_STRINGS.ta.play);
    // Picking the game's own language keeps its word changes; null forgets the choice.
    S.choosePlayerLanguage('hi');
    expect(S.t('play')).toBe('शुरू');
    S.choosePlayerLanguage(null);
    expect(store.has('nb-game-lang-v1')).toBe(false);
    expect(S.t('play')).toBe('शुरू');
    // Junk is not a language.
    store.set('nb-game-lang-v1', 'xx');
    expect(S.playerLanguage()).toBeNull();
  });

  it('Settings has a Language list with every language in its own script, and the screens re-render on a change', () => {
    const hud = generateGameShell().files['src/game/ui/Hud.tsx'];
    expect(hud).toMatch(/GAME_LANGUAGES\.map\(/);
    expect(hud).toMatch(/choosePlayerLanguage\(/);
    expect(hud).toMatch(/events\.on\('LANGUAGE_CHANGED'/);
    expect(hud).toMatch(/GAME_LANGUAGE_NATIVE_NAMES\[l\]/);
  });
});

describe('🗣️ the request decides the language the builder is told to use', () => {
  it.each([
    ['Tamil mein ek racing game banao', 'ta'],
    ['make a ludo game in Telugu', 'te'],
    ['ek cricket game, bangla version', 'bn'],
    ['marathi language madhe quiz game', 'mr'],
    ['ಒಂದು ಕಾರ್ ರೇಸಿಂಗ್ ಆಟ ಮಾಡಿ', 'kn'],
    ['ஒரு கார் பந்தய விளையாட்டு செய்', 'ta'],
    ['একটা ফুটবল খেলা বানাও', 'bn'],
    ['ഒരു കാർ റേസിംഗ് ഗെയിം ഉണ്ടാക്കൂ', 'ml'],
    ['ਇੱਕ ਕਾਰ ਰੇਸਿੰਗ ਗੇਮ ਬਣਾਓ', 'pa'],
    ['ଗୋଟିଏ କାର ରେସିଂ ଖେଳ ତିଆରି କର', 'or'],
    ['એક કાર રેસિંગ ગેમ બનાવો', 'gu'],
    ['एक कार रेसिंग गेम बनाओ', 'hi'],
    ['एक कार रेसिंग गेम बनाओ, मराठी में', 'mr'],
    ['Tamil me nahi, Telugu me banao', 'te'],
  ])('"%s" → %s', (prompt, lang) => {
    expect(gameLanguageForRequest(prompt)).toBe(lang);
  });

  it.each([
    'a Tamil movie quiz game',
    'ek racing game banao bike wala',
    'build a 3D shooter',
    '',
  ])('"%s" → no language (the kit default stands)', (prompt) => {
    expect(gameLanguageForRequest(prompt)).toBeNull();
  });

  it('the handoff names the language and the option, only when the kit strings are on disk', () => {
    expect(gameLanguageHandoff('ta')).toMatch(/language: 'ta'/);
    expect(gameLanguageHandoff('en')).toBe('');
    expect(gameLanguageHandoff(null)).toBe('');
    const shell = [{ recipe: 'generate_game_shell', ok: true, content: 'Created src/game/Game.ts' }];
    expect(gameKitHandoffBlock(shell, { request: 'Telugu lo game kaadu, Telugu mein banao' })).toMatch(/GAME LANGUAGE: Telugu/);
    expect(gameKitHandoffBlock(shell, { request: 'make a racing game' })).not.toMatch(/GAME LANGUAGE/);
    expect(gameKitHandoffBlock([{ recipe: 'generate_board_games', ok: true, content: 'x' }], { request: 'Tamil mein ludo' })).not.toMatch(/GAME LANGUAGE/);
  });
});
