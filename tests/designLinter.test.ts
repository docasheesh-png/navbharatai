import { describe, it, expect } from 'vitest';
import {
  normalizeHex,
  extractHexColors,
  extractFontFamilies,
  extractSpacingPx,
  offGridSpacing,
  lintDesign,
  designSummary,
  MAX_COLORS,
} from '../src/server/AppMakerLab/intelligence/DesignLinter';

/** P-DESIGN.8 — pure design-lint logic (colours, fonts, spacing grid, score). */

describe('normalizeHex', () => {
  it('expands 3-digit and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#AaBbCc')).toBe('#aabbcc');
  });
  it('drops the alpha byte so rrggbbaa dedupes with rrggbb', () => {
    expect(normalizeHex('#112233ff')).toBe('#112233');
  });
  it('rejects non-hex', () => {
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });
});

describe('extractHexColors', () => {
  it('returns distinct normalized colours', () => {
    const code = 'a{color:#fff} b{color:#FFFFFF} c{background:#ff0000} d{border:#f00}';
    const colors = extractHexColors(code);
    expect(colors).toContain('#ffffff');
    expect(colors).toContain('#ff0000');
    // #fff, #FFFFFF collapse to one; #ff0000 and #f00 collapse to one → 2 distinct
    expect(colors.length).toBe(2);
  });
});

describe('extractFontFamilies', () => {
  it('captures the first family in each stack, deduped', () => {
    const code = "h1{font-family:'Inter',sans-serif} p{font-family:Inter, Arial} code{font-family:'Fira Code',monospace}";
    const fonts = extractFontFamilies(code);
    expect(fonts).toContain('inter');
    expect(fonts).toContain('fira code');
    expect(fonts.length).toBe(2);
  });
  it('ignores keyword/var families', () => {
    expect(extractFontFamilies('a{font-family:inherit} b{font-family:var(--f)}')).toEqual([]);
  });
});

describe('extractSpacingPx + offGridSpacing', () => {
  it('pulls px values from padding/margin/gap', () => {
    const code = 'a{padding:8px 16px} b{margin:12px} c{gap:10px}';
    const vals = extractSpacingPx(code);
    expect(vals).toEqual([8, 16, 12, 10]);
  });
  it('flags values off the 4px grid', () => {
    expect(offGridSpacing([8, 16, 12, 10, 7])).toEqual([10, 7]);
    expect(offGridSpacing([8, 16, 32])).toEqual([]);
  });
});

describe('lintDesign', () => {
  it('perfect score for clean/empty code', () => {
    expect(lintDesign('').score).toBe(100);
    expect(lintDesign('a{padding:8px;color:#fff;font-family:Inter}').grade).toBe('A');
  });

  it('penalises a colour explosion and attaches an AI fix-prompt', () => {
    // 15 distinct colours (> MAX_COLORS=12)
    const colors = Array.from({ length: 15 }, (_, i) => `.c${i}{color:#${(i + 10).toString(16).padStart(2, '0')}00ff}`).join('');
    const r = lintDesign(colors);
    expect(r.stats.colors).toBeGreaterThan(MAX_COLORS);
    const cc = r.violations.find((v) => v.type === 'color-count');
    expect(cc).toBeDefined();
    expect(typeof cc?.fix).toBe('string');
    expect(cc?.fix.length).toBeGreaterThan(10);
    expect(r.score).toBeLessThan(100);
  });

  it('penalises too many fonts and off-grid spacing', () => {
    const code = `
      h1{font-family:Inter} h2{font-family:Roboto} h3{font-family:Georgia}
      a{padding:7px} b{margin:13px} c{gap:9px} d{padding:11px}
    `;
    const r = lintDesign(code);
    expect(r.violations.some((v) => v.type === 'font-count')).toBe(true);
    expect(r.violations.some((v) => v.type === 'off-grid-spacing')).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it('flags hardcoded colours when there are no CSS variables', () => {
    const many = Array.from({ length: 10 }, (_, i) => `.c${i}{color:#${i}${i}${i}${i}${i}${i}}`).join('');
    const r = lintDesign(many);
    expect(r.violations.some((v) => v.type === 'hardcoded-colors')).toBe(true);
    // Same colours but WITH tokens present → no hardcoded-colors violation.
    const withTokens = many + ' :root{--brand:var(--x)} .z{color:var(--brand)}';
    expect(lintDesign(withTokens).violations.some((v) => v.type === 'hardcoded-colors')).toBe(false);
  });

  it('score is clamped to [0,100] and grade tracks it', () => {
    const r = lintDesign('');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D']).toContain(r.grade);
  });
});

describe('designSummary (P-PIPE.C stage 32 — advisory build-report line)', () => {
  it('gives a clean tick with grade + score when the design is cohesive', () => {
    const s = designSummary(lintDesign('.a{color:#112233;padding:8px}'));
    expect(s).toMatch(/Design consistency: ✓ [A-D] \(\d+\/100\)/);
    expect(s).not.toContain('⚠');
  });
  it('lists concrete issues (grade + count) when the design is inconsistent', () => {
    // Many one-off colours → a color-count violation.
    const many = Array.from({ length: 20 }, (_, i) => `.c${i}{color:#${(i + 16).toString(16).padStart(2, '0')}0000}`).join('\n');
    const r = lintDesign(many);
    const s = designSummary(r);
    expect(s).toContain(`Design consistency — grade ${r.grade}`);
    expect(s).toContain(`${r.violations.length} issue(s)`);
    expect(s).toContain('⚠');
  });
});
