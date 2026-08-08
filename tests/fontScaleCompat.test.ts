import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * ADMIN REPORT 2026-08-08: "text size change karne se app ka text badal jata hai, par AI ke message
 * aur response wala size same rahta hai."
 *
 * ROOT CAUSE: the Text Size zoom scales the ROOT font size, so rem-based utilities follow it — but
 * the app carries ~1,800 arbitrary `text-[Npx]` utilities, and px is immune to the root. The chat
 * bubbles were sized in px, so the one surface a user most needs to read was the one the zoom could
 * not touch. font-scale-compat.css remaps every px text utility in use to its exact rem equivalent
 * (identical at 100%, scaling at every other zoom).
 *
 * The sweep below is the anti-rot guard: it greps the REAL component tree for px text utilities and
 * fails if one exists that the compat file does not cover — a new size cannot silently escape the
 * accessibility zoom again.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const compat = read('src/styles/font-scale-compat.css');

describe('the compat layer — px text sizes become rem (N/16), exactly', () => {
  it('maps every size at the mathematically exact rem value', () => {
    const pairs: Array<[number, string]> = [
      [6, '0.375rem'], [7, '0.4375rem'], [8, '0.5rem'], [9, '0.5625rem'], [10, '0.625rem'],
      [11, '0.6875rem'], [12, '0.75rem'], [13, '0.8125rem'], [14, '0.875rem'], [15, '0.9375rem'],
      [16, '1rem'], [18, '1.125rem'],
    ];
    for (const [px, rem] of pairs) {
      expect(compat).toMatch(new RegExp(`\\.text-\\\\\\[${px}px\\\\\\]\\s*\\{\\s*font-size:\\s*${rem.replace('.', '\\.')}`));
      expect(px / 16).toBeCloseTo(parseFloat(rem), 6); // the math itself, locked
    }
  });

  it('is imported OUTSIDE any @layer, after tailwind, so it wins the cascade like theme-compat does', () => {
    const idx = read('src/index.css');
    const tw = idx.indexOf('@import "tailwindcss"');
    const fc = idx.indexOf('font-scale-compat.css');
    expect(tw).toBeGreaterThanOrEqual(0);
    expect(fc).toBeGreaterThan(tw);
    expect(compat).not.toMatch(/^\s*@layer/m); // no real layer block (the comment MENTIONS @layer)
  });

  it('the responsive variant in use keeps its override (media rule AFTER the base sizes)', () => {
    const baseAt = compat.indexOf('.text-\\[9px\\]');
    const variantAt = compat.indexOf('.sm\\:text-\\[10px\\]');
    expect(variantAt).toBeGreaterThan(baseAt);
    expect(compat.slice(variantAt - 200, variantAt)).toContain('@media (min-width: 640px)');
  });

  it('px line-heights in use are remapped too (fixed px leading + scaled text = overlapping lines)', () => {
    expect(compat).toMatch(/\.leading-\\\[14px\\\]\s*\{\s*line-height:\s*0\.875rem/);
  });
});

describe('ANTI-ROT SWEEP — no px text utility may exist that the compat layer does not cover', () => {
  it('every text-[Npx] and leading-[Npx] in the component tree has a compat rule', () => {
    // The real tree, not a fixture: the same grep a human would run.
    const out = execSync(
      String.raw`grep -rho -E '(text|leading)-\[[0-9.]+px\]' src/components src/App.tsx src/main.tsx | sort -u`,
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim();
    const used = out ? out.split('\n') : [];
    expect(used.length).toBeGreaterThan(5); // sanity: the sweep genuinely found the utilities
    const missing = used.filter((u) => !compat.includes(u.replace('[', '\\[').replace(']', '\\]').replace('.', '\\.')));
    // A failure here means someone added a NEW px size — add its rem rule to font-scale-compat.css
    // (or better, use a rem-based utility like text-xs/text-sm in the new code).
    expect(missing).toEqual([]);
  });
});
