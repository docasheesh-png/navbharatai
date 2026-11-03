import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_KIT_CSS, KIT_DARK_SWITCH, KIT_LIGHT_SWITCH } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { LIGHT_THEME_BY_DEFAULT_RULE } from '../src/server/AgentV3/noEvalRule';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { parseCssBlocks } from '../src/server/AgentV3/kitRestore';
import { themeTsx } from '../src/server/AgentV3/goldenScaffolds/base';

/**
 * ☀️ LIGHT UNLESS THE USER ASKS (admin 2026-11-02, verbatim: "jab navbharatai par koi app ya game banaya jata hai, to
 * woh, dark mode banta hai. mai chahta hu, jab tak user saf saf na bol de, tab tak light mode me hi game banne
 * chahiye!!").
 *
 * The class: a built app whose look is chosen by the PHONE's dark setting (or by the model's taste) instead of by the
 * user's words. Root: the design kit followed `prefers-color-scheme`, and most phones are set to dark. Siblings found
 * and fixed in the same change: the kit restorer re-adding the device block, the settings scaffold and the golden
 * theme toggle starting on "system/auto", the consent banner, the 3D shell's black host, the game recipe's dark
 * literals, and a second builder's prompt that said "follow the system light/dark preference".
 */
const read = (p: string) => readFileSync(p, 'utf8');
const blocks = parseCssBlocks(DESIGN_KIT_CSS);
const decls = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe('1 · the design kit is light whatever the device says', () => {
  it('declares only a light color-scheme at :root and has no device-following block', () => {
    expect(decls(blocks.find((b) => b.prelude === ':root')!.body)['--bg']).toBe('#f6f7fb');
    expect(DESIGN_KIT_CSS).toMatch(/^:root \{\n {2}color-scheme: light;/);
    expect(blocks.some((b) => /prefers-color-scheme/.test(b.prelude))).toBe(false);
  });
  it('keeps the whole dark palette behind the switch, so a dark app the user asked for is still one attribute away', () => {
    const dark = decls(blocks.find((b) => b.prelude === KIT_DARK_SWITCH)!.body);
    expect(dark['--bg']).toBe('#0d0d12');
    expect(dark['--game-bg']).toBe('#0b0a1a');
    expect(blocks.some((b) => b.prelude === KIT_LIGHT_SWITCH)).toBe(true);
  });
  it('a game is light by default: the stage, its screens, chips, keys and bars read tokens, never a dark literal', () => {
    const game = blocks.filter((b) => /\.nb-game/.test(b.prelude));
    expect(game.length).toBeGreaterThan(8);
    for (const b of game) {
      // A translucent white is only allowed on the accent-filled start button (white on the accent, in both themes).
      const literals = [...b.body.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[^)]*\)|#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
      const allowed = b.prelude.startsWith('.nb-game-btn') && !b.prelude.includes('secondary');
      if (!allowed) expect(literals, b.prelude).toEqual([]);
    }
    const root = decls(blocks.find((b) => b.prelude === ':root')!.body);
    expect(root['--game-bg']).toBe('#eef1ff');
    expect(root['--game-fg']).toBe('#17171c');
  });
  it('the game text reads on the game stage (WCAG AA) in both themes', () => {
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const light = decls(blocks.find((b) => b.prelude === ':root')!.body);
    const dark = decls(blocks.find((b) => b.prelude === KIT_DARK_SWITCH)!.body);
    for (const t of [light, dark]) expect(ratio(t['--game-fg'], t['--game-bg'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('2 · every lane is told: light unless the user\'s own words ask for dark', () => {
  it('the rule names the default, the user\'s words as the only way to dark, games and 3D scenes', () => {
    expect(LIGHT_THEME_BY_DEFAULT_RULE).toMatch(/LIGHT THEME BY DEFAULT/);
    expect(LIGHT_THEME_BY_DEFAULT_RULE).toMatch(/every app AND every game/);
    expect(LIGHT_THEME_BY_DEFAULT_RULE).toMatch(/user\\?'s OWN words/);
    expect(LIGHT_THEME_BY_DEFAULT_RULE).toMatch(/data-theme="dark"/);
    expect(LIGHT_THEME_BY_DEFAULT_RULE).toMatch(/3D scene lit as day/);
  });
  it('the architect, the fast lane, the one-shot lane and the writing sub-agents all carry it', () => {
    expect(architectSystemPrompt('vite-react')).toContain(LIGHT_THEME_BY_DEFAULT_RULE);
    expect(read('src/server/AgentV3/SimpleBuilder.ts')).toMatch(/NO_FAKE_FEATURE_RULE,\n\s*LIGHT_THEME_BY_DEFAULT_RULE,/);
    expect(read('src/server/AgentV3/OneShotBuilder.ts')).toMatch(/NO_FAKE_RESULTS_RULE,\n\s*LIGHT_THEME_BY_DEFAULT_RULE,/);
    expect(read('src/server/AgentV3/SubAgent.ts')).toContain('${NO_FAKE_FEATURE_RULE}\\n${LIGHT_THEME_BY_DEFAULT_RULE}');
  });
  it('no lane still says the app should follow the device', () => {
    const prompt = architectSystemPrompt('vite-react');
    expect(prompt).not.toMatch(/design kit follows the device/i);
    expect(read('src/server/AgentV3/SimpleBuilder.ts')).not.toMatch(/with no switch the app follows the device/);
    expect(read('src/server/project/aiEdits.ts')).not.toMatch(/Follow the system light\/dark preference/);
    expect(read('src/server/project/aiEdits.ts')).toMatch(/LIGHT theme by default/);
  });
});

describe('3 · the scaffolds that ship a theme choice start on light', () => {
  it('the settings scaffold defaults to light, not to the phone', () => {
    expect(read('src/server/lib/SettingsScaffoldGenerator.ts')).toMatch(/const DEFAULTS: Settings = \{ theme: 'light',/);
  });
  it('the golden theme toggle starts on light; "auto" is only ever the person\'s own choice', () => {
    expect(themeTsx).toMatch(/: 'light';\n\s*\} catch \{ return 'light'; \}/);
    expect(themeTsx).not.toMatch(/removeAttribute\('data-theme'\)/);
  });
  it('the 3D shell never paints black before the scene, and its fallback screen is light', () => {
    const shell = read('src/server/lib/GameShellGenerator.ts');
    expect(shell).not.toMatch(/background: '#000'/);
    expect(shell).not.toMatch(/background: '#111', color: '#eee'/);
  });
  it('the consent banner is dark only when the app is, never because the phone is', () => {
    expect(read('src/server/lib/ConsentBannerGenerator.ts')).not.toContain('prefers-color-scheme');
  });
});

describe('4 · 🔒 CLASS LOCK: nothing writes a device-following dark look into a built app', () => {
  // Every server file that mentions prefers-color-scheme, each with WHY it may. A NEW file fails here: if it writes
  // a built app's styles, it must not make the app follow the phone; if it only detects or describes, list it.
  const ALLOWED: Record<string, string> = {
    'src/server/AgentV3/previewBridge.ts': 'reads the running page to report whether it LOOKS dark; writes nothing into the app',
    'src/server/AgentV3/deadThemeSwitch.ts': 'diagnoses an app\'s OWN stylesheet that follows the device; message text only',
    'src/server/AgentV3/nextBuildSuggestions.ts': 'a detection regex: does the app already have a theme feature',
    'src/server/project/FeatureCoverage.ts': 'a detection regex for a requested theme feature',
    'src/server/AgentV3/kitRestore.ts': 'keeps a device block only when the APP\'s own old stylesheet had one (the user\'s choice); never adds one',
    'src/server/AgentV3/noEvalRule.ts': 'the rule\'s own text: "follow my phone" is a request the user may make',
    'src/server/lib/SettingsScaffoldGenerator.ts': 'resolves the "system" option only when the person picks it; the default is light',
    'src/server/AgentV3/goldenScaffolds/base.ts': 'resolves "auto" only when the person picks it; the toggle starts on light',
    'src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit.ts': 'the SOURCE writes the dark palette as a device block for readability; withThemeSwitch REPLACES it with the switch — the shipped kit is locked in section 1',
    'src/server/AppContext/AppKnowledgeBase.ts': 'search keywords for the Dark Mode Generator tool',
    'src/server/lib/legalMarkdown.ts': 'NavBharatAI\'s own legal pages, not a built app',
    'src/server/lib/marketingPages.ts': 'NavBharatAI\'s own marketing pages, not a built app',
    'src/server/lib/checkoutHandoff.ts': 'NavBharatAI\'s own checkout hand-off page, not a built app',
    'src/server/AgentV3/previewDoor.ts': 'NavBharatAI\'s own preview loading screen, not a built app',
  };
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
  it('every mention is a listed, justified one', () => {
    const found = walk('src/server').filter((f) => read(f).includes('prefers-color-scheme')).sort();
    expect(found.filter((f) => !ALLOWED[f]), 'a new file mentions prefers-color-scheme: make sure a built app stays light, then list it').toEqual([]);
    expect(Object.keys(ALLOWED).filter((f) => !found.includes(f)), 'stale entry').toEqual([]);
    // The kit is listed for its SOURCE only; what it ships must never follow the device (section 1).
    expect(DESIGN_KIT_CSS).not.toContain('prefers-color-scheme');
  });
});
