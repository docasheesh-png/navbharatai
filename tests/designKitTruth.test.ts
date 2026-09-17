import { describe, it, expect } from 'vitest';
import {
  lintDesign, extractHexColors, extractTokenColors, extractSpacingPx, offGridSpacing, MAX_COLORS,
} from '../src/server/AppMakerLab/intelligence/DesignLinter';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';

/**
 * EVERY GOLDEN SCAFFOLD GRADED C OR D — and only one of the two reasons was real.
 *
 * Measured 2026-09-17 after build report 2b0a3ed5 reported `DESIGN_CONSISTENCY 68/100 (C)` on a
 * CALCULATOR build. Scoring all 40 scaffolds with the build's own linter showed the grade was not
 * about the calculator at all: **all 40 were C or D, 38 of them with identical numbers** — which
 * means the cause was in a file every template shares, not in any app.
 *
 * Splitting the two complaints settled them in opposite directions:
 *
 *   🔴 "20 distinct colours" — FALSE. The apps' own `src/App.tsx` scores 100/A, and all 19 colours
 *      are TOKEN DECLARATIONS in the shared design kit. That is a palette, not a violation of one —
 *      and a kit with a dark mode declares every token twice by construction, so a well-built
 *      two-theme system could never pass a rule that counts raw hex values. Fixed in the LINTER.
 *
 *   ✅ "11 spacing values off the 4px grid" — TRUE. `designKit.ts` really did use 9/14/6/10/22px
 *      padding, margin and gap. Fixed in the CSS.
 *
 * Acting on the first without measuring would have meant deleting colours from a correct design
 * system to make a number go up.
 */

describe('🔴 the palette is not a violation of the palette', () => {
  it('a token declaration is recognised as the palette', () => {
    const css = ':root { --accent: #4f46e5; --bg: #f6f7fb; }';
    expect(extractTokenColors(css).sort()).toEqual(['#4f46e5', '#f6f7fb']);
  });

  it('a token holding several colours declares all of them', () => {
    expect(extractTokenColors('--shadow: 0 1px 2px #112233, 0 8px 24px #445566;').sort())
      .toEqual(['#112233', '#445566']);
  });

  it('🔒 a two-theme kit does not fail for having a dark mode', () => {
    // Each token is declared twice by construction — once per theme. Counting raw hex values makes a
    // design system fail HARDER the more complete it is.
    const kit = `:root{--bg:#f6f7fb;--fg:#17171c;--accent:#4f46e5;--card:#ffffff;--border:#e5e7eb;
      --muted:#6b7280;--success:#16a34a;--danger:#dc2626;--warning:#d97706;--accent-soft:#eef0ff;}
      @media (prefers-color-scheme: dark){:root{--bg:#0d0d12;--fg:#ececf1;--accent:#7c74ff;
      --card:#17171f;--border:#2a2a35;--muted:#9ca3af;--accent-soft:#1c1b2e;}}`;
    expect(extractHexColors(kit).length).toBeGreaterThan(MAX_COLORS);
    expect(lintDesign(kit).violations.map((v) => v.type)).not.toContain('color-count');
  });

  it('🔒 …but a colour used AD-HOC still counts, which is what the rule is for', () => {
    const adhoc = Array.from({ length: 14 }, (_, i) => `'#${String(i).repeat(6).slice(0, 6)}'`).join(',');
    const r = lintDesign(`const palette = [${adhoc}];`);
    expect(r.violations.map((v) => v.type)).toContain('color-count');
  });

  it('🔒 a file that half-adopted tokens still reports its real ad-hoc problem', () => {
    // `hardcoded-colors` asks a DIFFERENT question — "many colours and NO tokens" — so it reads every
    // colour. Filtering its input would have made it near-unreachable.
    const r = lintDesign("const c=['#111111','#222222','#333333','#444444','#555555','#666666','#777777','#888888','#999999','#aaaaaa','#bbbbbb','#cccccc','#dddddd','#eeeeee'];");
    expect(r.violations.map((v) => v.type)).toContain('hardcoded-colors');
  });

  it('a token colour also used ad-hoc is still ad-hoc', () => {
    // Declaring `--accent` does not license sprinkling that hex through the markup — but it is ONE
    // colour either way, so the count is what changes, never the fact that it was seen.
    expect(extractHexColors(':root{--a:#4f46e5;} .x{color:#4f46e5}')).toEqual(['#4f46e5']);
  });
});

describe('✅ the spacing complaint was real, and is fixed in the CSS', () => {
  const kit = goldenScaffoldFiles(GOLDEN_SCAFFOLDS.find((g) => g.id === 'calculator')!);

  it('the shared design kit sits on the 4px grid', () => {
    const off = offGridSpacing(extractSpacingPx(kit['src/index.css'] ?? ''));
    expect(off).toEqual([]);
  });

  it('🔒 a button and an input still share their vertical padding', () => {
    // They are deliberately matched so a button lines up with an input beside it in a form row.
    // Snapping one to 8 and the other to 10 would have broken that in every generated app — the
    // reason this was measured rather than bulk-replaced.
    const css = kit['src/index.css'] ?? '';
    const btn = /button, \.btn \{[^}]*padding:\s*(\d+)px/.exec(css)?.[1];
    const input = /input, textarea, select \{[^}]*padding:\s*(\d+)px/.exec(css)?.[1];
    expect(btn).toBeDefined();
    expect(input).toBeDefined();
    expect(btn).toBe(input);
  });
});

describe('🔒 every golden scaffold now grades honestly', () => {
  it('all 40 reach A — and the fix is shared, not per-template', () => {
    const graded = GOLDEN_SCAFFOLDS.map((g) => {
      const q = lintBuiltApp(goldenScaffoldFiles(g));
      return { id: g.id, score: q?.design.score ?? -1, grade: q?.design.grade ?? '?' };
    });
    expect(graded.length).toBeGreaterThan(30);
    const below = graded.filter((g) => g.grade !== 'A');
    expect(below, `still below A: ${below.map((g) => `${g.id} ${g.score}`).join(', ')}`).toEqual([]);
  });

  it('🔒 the game scaffolds keep their own real colours — the linter is not blinded', () => {
    // `puzzle` genuinely carries a 12-colour tile ramp of its own. It is counted; it simply sits at
    // the limit rather than above it, which is the correct answer for a tile game.
    const files = goldenScaffoldFiles(GOLDEN_SCAFFOLDS.find((g) => g.id === 'puzzle')!);
    const joined = Object.entries(files).filter(([p]) => /\.(tsx?|css|html)$/.test(p)).map(([, c]) => c).join('\n');
    const tokens = new Set(extractTokenColors(joined));
    const adhoc = extractHexColors(joined).filter((c) => !tokens.has(c));
    expect(adhoc.length).toBeGreaterThan(5);
  });
});
