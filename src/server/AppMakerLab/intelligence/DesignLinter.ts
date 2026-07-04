// P-DESIGN.8 — Design Governance / visual linter (pure, deterministic — no AI, no credit spend).
//
// Scans generated app code for design-consistency issues a polished app shouldn't have: an
// explosion of one-off colours, too many font families, off-grid spacing, and heavy hardcoded
// colours (instead of tokens/CSS variables). Returns a 0–100 consistency score + a letter grade +
// concrete violations. All logic is pure and unit-tested; the route + UI are thin adapters.
//
// This is a *consistency* linter (works from the code alone). A future pass can additionally compare
// against a specific brand token set (WhitelabelBranding); the pure extractors here are the base.

export type ViolationType = 'color-count' | 'font-count' | 'off-grid-spacing' | 'hardcoded-colors';

export interface DesignViolation {
  type: ViolationType;
  severity: 'info' | 'warn';
  message: string;
  /** A ready-to-send instruction that tells the builder AI how to fix this (one-click "Fix with AI"). */
  fix: string;
  count: number;
  examples: string[];
}

/** The AI fix-prompt for each design violation type. */
const DESIGN_FIX: Record<ViolationType, string> = {
  'color-count': 'Consolidate the colours in this app into a small, consistent palette (about 4–6 brand colours) and reuse them everywhere.',
  'font-count': 'Reduce this app to at most two font families — one for headings and one for body text — and apply them consistently.',
  'off-grid-spacing': 'Align all padding, margin, and gap values in this app to a consistent 4px spacing grid (use multiples of 4px/8px).',
  'hardcoded-colors': 'Extract the hardcoded colours in this app into CSS variables (design tokens like --brand-primary) and use them throughout.',
};

export interface DesignLintResult {
  score: number; // 0–100
  grade: 'A' | 'B' | 'C' | 'D';
  violations: DesignViolation[];
  stats: { colors: number; fonts: number; spacingValues: number; offGridSpacing: number; hasTokens: boolean };
}

// Tunable thresholds (kept here so the intent is explicit and the tests pin them).
export const MAX_COLORS = 12;
export const MAX_FONTS = 2;
export const SPACING_GRID = 4; // px
export const MAX_OFFGRID = 3;
export const HARDCODE_COLOR_LIMIT = 8;

/** Expand `#abc` → `#aabbcc`; lowercase; drop any alpha byte so `#rrggbbaa` dedupes with `#rrggbb`. Pure. */
export function normalizeHex(hex: string): string | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h.slice(0, 6);
}

/** All distinct normalized hex colours in the code. Pure. */
export function extractHexColors(code: string): string[] {
  const out = new Set<string>();
  const re = /#[0-9a-fA-F]{3,8}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const n = normalizeHex(m[0]);
    if (n) out.add(n);
  }
  return [...out];
}

/** Distinct font-family names declared in the code (CSS `font-family` + Tailwind `font-[...]`). Pure. */
export function extractFontFamilies(code: string): string[] {
  const out = new Set<string>();
  const re = /font-family\s*:\s*([^;}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // First family in the stack identifies the choice; strip quotes/whitespace.
    const first = m[1].split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    if (first && !/^(inherit|initial|unset|var\()/.test(first)) out.add(first);
  }
  // Tailwind arbitrary font-family utilities: `font-['Playfair_Display']`, `font-[Inter]`,
  // `font-[family-name:'Roboto']`. The JSDoc promised this but it was never implemented, so a
  // Tailwind app that sets fonts ONLY via classes (no `font-family:` anywhere) reported [] fonts and
  // the too-many-fonts check never fired. Underscore = space in Tailwind arbitrary values; a numeric
  // arbitrary value (`font-[600]` = weight) is excluded — a real family name always has a letter.
  const tw = /font-\[([^\]]+)\]/gi;
  while ((m = tw.exec(code)) !== null) {
    const raw = (m[1].split(':').pop() ?? '')      // drop a `family-name:` type hint
      .replace(/_/g, ' ').replace(/['"]/g, '').trim().toLowerCase();
    if (raw && /[a-z]/.test(raw) && !/^(inherit|initial|unset)$/.test(raw)) out.add(raw);
  }
  return [...out];
}

/** All px spacing values from padding/margin/gap declarations. Pure. */
export function extractSpacingPx(code: string): number[] {
  const values: number[] = [];
  const re = /(?:padding|margin|gap|row-gap|column-gap)[^:;{}]*:\s*([^;"'}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const nums = m[1].match(/(\d+(?:\.\d+)?)px/g);
    if (nums) for (const n of nums) values.push(parseFloat(n));
  }
  return values;
}

/** Spacing values that don't sit on the `grid` (default 4px). Pure. */
export function offGridSpacing(values: number[], grid: number = SPACING_GRID): number[] {
  const g = grid > 0 ? grid : SPACING_GRID;
  return values.filter((v) => v > 0 && Math.abs(v % g) > 1e-9);
}

function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

/**
 * Lint generated code for design-consistency issues. Deterministic — same code in, same result out.
 * Returns a 0–100 score, a grade, and concrete violations. Empty/tiny code → a perfect, honest 100.
 */
export function lintDesign(code: string): DesignLintResult {
  const src = typeof code === 'string' ? code : '';
  const colors = extractHexColors(src);
  const fonts = extractFontFamilies(src);
  const spacing = extractSpacingPx(src);
  const offGrid = offGridSpacing(spacing);
  const hasTokens = /var\(\s*--/.test(src);

  const violations: DesignViolation[] = [];
  let penalty = 0;

  if (colors.length > MAX_COLORS) {
    penalty += Math.min(30, (colors.length - MAX_COLORS) * 2);
    violations.push({
      type: 'color-count',
      severity: 'warn',
      message: `${colors.length} distinct colours — consolidate into a small palette (≤ ${MAX_COLORS}) for a consistent look.`,
      fix: DESIGN_FIX['color-count'],
      count: colors.length,
      examples: colors.slice(0, 6),
    });
  }

  if (fonts.length > MAX_FONTS) {
    penalty += Math.min(20, (fonts.length - MAX_FONTS) * 10);
    violations.push({
      type: 'font-count',
      severity: 'warn',
      message: `${fonts.length} font families — limit to ${MAX_FONTS} (a display + a body font) for cleaner typography.`,
      fix: DESIGN_FIX['font-count'],
      count: fonts.length,
      examples: fonts.slice(0, 4),
    });
  }

  if (offGrid.length > MAX_OFFGRID) {
    penalty += Math.min(20, (offGrid.length - MAX_OFFGRID) * 2);
    violations.push({
      type: 'off-grid-spacing',
      severity: 'warn',
      message: `${offGrid.length} spacing values are off the ${SPACING_GRID}px grid — snap to multiples of ${SPACING_GRID}px for rhythm.`,
      fix: DESIGN_FIX['off-grid-spacing'],
      count: offGrid.length,
      examples: [...new Set(offGrid)].slice(0, 6).map((v) => `${v}px`),
    });
  }

  if (colors.length > HARDCODE_COLOR_LIMIT && !hasTokens) {
    penalty += 10;
    violations.push({
      type: 'hardcoded-colors',
      severity: 'info',
      message: `${colors.length} hardcoded colours and no CSS variables — extract design tokens (\`--brand-*\`) so themes stay consistent.`,
      fix: DESIGN_FIX['hardcoded-colors'],
      count: colors.length,
      examples: colors.slice(0, 6),
    });
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return {
    score,
    grade: scoreToGrade(score),
    violations,
    stats: { colors: colors.length, fonts: fonts.length, spacingValues: spacing.length, offGridSpacing: offGrid.length, hasTokens },
  };
}

/**
 * One-line-plus advisory summary for the build readiness report (P-PIPE.C stage 32). Mirrors the other
 * evaluate dimensions (seoSummary/accessibilitySummary): a clean tick when the design is cohesive, else
 * the grade + the concrete issues. Advisory only — it never blocks a build. Pure.
 */
export function designSummary(result: DesignLintResult): string {
  if (!result.violations.length) {
    return `Design consistency: ✓ ${result.grade} (${result.score}/100) — cohesive palette, typography and spacing.`;
  }
  const head = `Design consistency — grade ${result.grade} (${result.score}/100), ${result.violations.length} issue(s):`;
  return [head, ...result.violations.map((v) => `  ⚠ ${v.message}`)].join('\n');
}
