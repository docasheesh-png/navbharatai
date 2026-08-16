import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * WHITE-ALPHA UTILITIES IN A LIGHT THEME (found 2026-08-16, by looking at a real screen).
 *
 * `theme-compat.css` remaps the app's hardcoded dark literals onto semantic vars, which is how one
 * attribute switch recolours everything. But it remapped `.text-white` and NOT `.text-white/50` —
 * a different class name, so it was never touched. In a light theme those stayed literally white,
 * at 50%, on a light background: invisible. App Mart's subtitle and its empty-state message were
 * the symptom; the cause covered 566 `text-white/N`, 589 `bg-white/N` and 1153 `border-white/N`
 * across 35+ files, on the two light themes.
 *
 * The fix mixes the THEME'S OWN text colour to the same percentage, which is what those classes
 * always meant ("the text colour, faded") — and makes the dark themes a no-op BY CONSTRUCTION,
 * because there `--text-primary` IS `#ffffff`. Confirmed empirically in Chromium: every step
 * resolves to the identical colour on dark.
 */

const css = readFileSync(join(process.cwd(), 'src/styles/theme-compat.css'), 'utf8');
const srcFiles = () => {
  const { execSync } = require('child_process') as typeof import('child_process');
  return execSync('grep -rohE "(text|bg|border)-white/[0-9]+" src/ --include="*.tsx" || true', { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
};

describe('every white-alpha utility the app actually uses is remapped', () => {
  it('no used step is left behind — that is how the bug happened the first time', () => {
    const missing = new Set<string>();
    for (const cls of srcFiles()) {
      // `cls` is already the full name before the slash ("bg-white"), so do NOT re-append "-white":
      // the first version of this test built ".bg-white-white\\/10" and reported every class missing.
      const [prefix, step] = cls.split('/');
      const rule = `.${prefix}\\/${step}`;
      if (!css.includes(rule)) missing.add(cls);
    }
    expect([...missing].sort(), 'these classes are still literal white in light themes').toEqual([]);
  });

  it('the remap uses the theme\'s own text colour, not a fixed grey', () => {
    // A fixed grey would be a second palette to keep in sync, and would change the dark themes.
    expect(css).toContain('color-mix(in srgb, var(--text-primary)');
    expect(css).not.toMatch(/\.text-white\\\/\d+\s*\{\s*color:\s*#/);
  });

  it('every rule stays gated on html[data-theme], so no-attribute is still the raw dark app', () => {
    const alphaRules = css.split('\n').filter((l) => /\.(text|bg|border)-white\\\//.test(l));
    expect(alphaRules.length).toBeGreaterThan(30);
    for (const line of alphaRules) expect(line.trim(), line).toMatch(/^html\[data-theme\]/);
  });

  it('the percentage in the rule matches the class name — an off-by-one here is silent', () => {
    const bad: string[] = [];
    for (const line of css.split('\n')) {
      const m = line.match(/\.(text|bg|border)-white\\\/(\d+)\s*\{[^}]*var\(--text-primary\)\s+(\d+)%/);
      if (m && m[2] !== m[3]) bad.push(line.trim());
    }
    expect(bad).toEqual([]);
  });
});
