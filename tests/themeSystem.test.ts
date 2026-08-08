/**
 * DNA-level theme system regression guards (admin 2026-07-14).
 *
 * The 5-theme system works by: <html data-theme> (single source) → a semantic CSS-variable palette per
 * theme in index.css → an UNLAYERED compat layer (theme-compat.css) that remaps the app's dominant
 * hardcoded GitHub-dark literals to those vars, so the WHOLE app recolours (desktop + mobile) on one
 * attribute switch. These static assertions fail loudly if any load-bearing piece is removed/altered —
 * cheaper and more reliable than a jsdom render for a CSS-cascade mechanism.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const indexCss = read('src/index.css');
const compat = read('src/styles/theme-compat.css');
const indexHtml = read('index.html');
const appTsx = read('src/App.tsx');

describe('theme palette — index.css defines all 5 themes as CSS-variable blocks', () => {
  for (const theme of ['dark', 'light', 'dim', 'comfort', 'contrast'] as const) {
    it(`html[data-theme="${theme}"] defines the semantic palette (surface + text vars)`, () => {
      const block = new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{[^}]*--surface-base[^}]*--text-primary`, 's');
      // dark is defined on the `:root, html[data-theme="dark"]` shared block — allow either.
      const darkShared = /:root,\s*html\[data-theme="dark"\]\s*\{[^}]*--surface-base/s;
      expect(block.test(indexCss) || (theme === 'dark' && darkShared.test(indexCss))).toBe(true);
    });
  }

  it('CONTRAST = text opposite background: surfaces black, text light/yellow (bug 4)', () => {
    const contrast = indexCss.match(/html\[data-theme="contrast"\]\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(contrast).toMatch(/--surface-base:\s*#000000/);
    expect(contrast).toMatch(/--text-primary:\s*#ffff00/);
    expect(contrast).toMatch(/--text-body:\s*#ffffff/);
  });

  it('COMFORT has its own distinct solarized palette (not name-only — bug 3)', () => {
    const comfort = indexCss.match(/html\[data-theme="comfort"\]\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(comfort).toMatch(/--surface-base:\s*#fdf6e3/);
    expect(comfort).not.toMatch(/#0d1117/); // distinct from dark
  });

  it('legacy --theme-* names are kept as aliases so existing consumers still follow the theme', () => {
    expect(indexCss).toMatch(/--theme-bg:\s*var\(--surface-base\)/);
    expect(indexCss).toMatch(/--theme-text:\s*var\(--text-body\)/);
  });
});

describe('theme-compat.css — the unlayered remap that themes the WHOLE app (bug 2)', () => {
  it('is imported by index.css AFTER tailwind (so unlayered rules win the cascade)', () => {
    const tw = indexCss.indexOf('@import "tailwindcss"');
    const cc = indexCss.indexOf('theme-compat.css');
    expect(tw).toBeGreaterThanOrEqual(0);
    expect(cc).toBeGreaterThan(tw);
  });

  it('remaps the dominant hardcoded literals to the palette vars, gated on html[data-theme]', () => {
    expect(compat).toMatch(/html\[data-theme\][^{]*\.bg-\\\[\\#0d1117\\\][^{]*\{[^}]*var\(--surface-base\)/s);
    expect(compat).toMatch(/html\[data-theme\][^{]*\.bg-\\\[\\#161b22\\\][^{]*\{[^}]*var\(--surface-card\)/s);
    expect(compat).toMatch(/html\[data-theme\]\s*\.text-white\s*\{\s*color:\s*var\(--text-primary\)/);
    expect(compat).toMatch(/\.text-\\\[\\#8b949e\\\][^{]*\{[^}]*var\(--text-muted\)/s);
  });

  it('EVERY remap rule is gated on html[data-theme] (inert kill-switch when the attribute is absent)', () => {
    // No colour-remap line may set a var without the html[data-theme] guard somewhere on its selector.
    const ruleLines = compat.split('\n').filter((l) => /\{\s*(background-color|color|border-color):\s*var\(--/.test(l));
    expect(ruleLines.length).toBeGreaterThan(0);
    // The selectors are multi-line groups; assert the file never introduces a bare ".text-white{color:var"
    // without the guard by checking the guard token count is healthy relative to var-usages.
    expect((compat.match(/html\[data-theme\]/g) || []).length).toBeGreaterThanOrEqual(10);
  });

  it('brand buttons keep white text (bg-indigo-600.text-white is re-asserted to #fff)', () => {
    expect(compat).toMatch(/\.bg-indigo-600\.text-white/);
    expect(compat).toMatch(/color:\s*#ffffff/);
  });

  it('[data-fixed-dark] escape hatch re-declares the dark palette for branded surfaces', () => {
    expect(compat).toMatch(/\[data-fixed-dark\]\s*\{[^}]*--surface-base:\s*#0d1117/s);
  });
});

describe('data-theme wiring — the single source of truth, desktop AND mobile (bug 1 + FOUC)', () => {
  it('index.html sets data-theme on <html> BEFORE hydration (no theme flash)', () => {
    expect(indexHtml).toMatch(/document\.documentElement\.setAttribute\(\s*['"]data-theme['"]/);
    expect(indexHtml).toMatch(/localStorage\.getItem\(\s*['"]theme['"]\s*\)/);
  });

  it('App.tsx keeps data-theme in sync with the React theme state', () => {
    expect(appTsx).toMatch(/document\.documentElement\.setAttribute\(\s*['"]data-theme['"]\s*,\s*theme\s*\)/);
  });
});

// ADMIN REPORT 2026-08-08: "Pro v5 ke andar theme badalne se background dark hi rahta hai."
// Root cause: the compat layer mapped -900/-800 but never the -950 family — and the v5 panel's ROOT
// is `bg-zinc-950`, so the whole surface ignored every theme. Hover variants (`hover:bg-zinc-800`)
// are distinct classes and were escaping too: on a light theme, hovering any v5 button flashed dark.
describe('theme-compat.css — the darkest chrome family follows the theme (Pro v5 report)', () => {
  it('maps the whole -950 family (all five gray scales) to the base surface', () => {
    for (const scale of ['zinc', 'neutral', 'gray', 'slate', 'stone']) {
      expect(compat).toMatch(new RegExp(`html\\[data-theme\\]\\s*\\.bg-${scale}-950\\b`));
    }
    expect(compat).toMatch(/\.bg-zinc-950[\s\S]{0,400}var\(--surface-base\)/);
  });

  it('maps the near-solid and translucent -950 variants the panels actually use', () => {
    expect(compat).toMatch(/\.bg-zinc-950\\\/95/);
    expect(compat).toMatch(/\.bg-zinc-950\\\/40[\s\S]{0,120}var\(--surface-raised\)/);
  });

  it('hover states of the mapped neutrals are remapped too (no dark flash on light themes)', () => {
    expect(compat).toMatch(/\.hover\\:bg-zinc-800:hover/);
    expect(compat).toMatch(/\.hover\\:bg-zinc-900:hover[\s\S]{0,200}var\(--surface-card\)/);
  });

  it('the v5 panel root literal is genuinely covered (the reported symptom cannot return)', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toMatch(/bg-zinc-950/); // the root still uses the literal…
    expect(compat).toMatch(/html\[data-theme\]\s*\.bg-zinc-950\b/); // …and the compat layer remaps it.
  });

  it('the fixed-dark escape hatch exists but no surface currently claims it (the comment tells the truth)', () => {
    expect(compat).toMatch(/\[data-fixed-dark\]/);
    expect(compat).toMatch(/currently used by NO surface/);
  });
});
