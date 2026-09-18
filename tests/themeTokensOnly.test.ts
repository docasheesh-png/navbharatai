import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { census, readBaseline, literalsIn, clientFiles, codeOnly, BASELINE_PATH } from '../scripts/themeColourBaseline.mjs';

/**
 * 🔴 THE THEME SYSTEM IS REPLACED, AND THIS IS THE HALF THAT LASTS (admin 2026-09-18: "pura theme
 * system badlo, plan ke hisab se shuru karo").
 *
 * The audit that preceded it — 72 screens × 5 themes, 420 screenshots, every text node measured —
 * found 236 invisible and 1,557 near-invisible text nodes, and a cause rather than a list of bugs:
 * the app names colours as hardcoded GitHub-dark literals (14,620 usages) and `theme-compat.css`
 * re-maps an ALLOWLIST of them to variables. That file had been patched three times (2026-08-08,
 * 08-16, 09-13), each time for "a category that was missed", and the audit found the next 1,347.
 * An allowlist cannot be complete against an open-ended set of class names — so the fix is not a
 * fourth patch, it is making the literal impossible to add.
 *
 * Three locks here, each proven to bite:
 *   1. THE RATCHET — every client file's count of literal colours must equal its recorded baseline.
 *      Above it: a new literal (use a token). Below it: an improvement not yet locked in (run the
 *      script with --write). A file not in the baseline has a baseline of zero.
 *   2. THE PALETTE — every theme's text × surface pairs clear WCAG AA. Comfort used to fail 11 of 30.
 *   3. THE PIPELINE — the tokens exist in index.css and the first migrated file really is at zero.
 */
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('🔒 the ratchet — a literal colour can only ever leave a file, never enter one', () => {
  const actual = census(root) as Record<string, number>;
  const baseline = readBaseline(root) as Record<string, number>;

  it('scans a real number of client files — a scanner that finds nothing proves nothing', () => {
    const files = clientFiles(root);
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain('src/components/AdminDashboard.tsx');
    expect(Object.keys(baseline).length).toBeGreaterThan(50);
  });

  it('no file is ABOVE its baseline — no new hardcoded colour anywhere in the client', () => {
    const above: string[] = [];
    for (const [f, n] of Object.entries(actual)) {
      const b = baseline[f] ?? 0;
      if (n > b) {
        const hits = literalsIn(read(f));
        above.push(`${f}: ${n} literal colours, baseline ${b}\n    e.g. ${hits.slice(-3).map((h: { line: number; token: string }) => `line ${h.line}: ${h.token}`).join(' · ')}`);
      }
    }
    expect(
      above.join('\n  '),
      'A hardcoded colour was added. Use the semantic tokens from index.css instead — bg-surface / bg-card / bg-raised, text-ink / text-body / text-muted / text-faint, border-line, text-accent-text, text-success / text-warn / text-danger / text-info, text-on-accent. They resolve per theme; a literal cannot.',
    ).toBe('');
  });

  it('no file is BELOW its baseline either — an improvement is locked in the moment it lands', () => {
    const below: string[] = [];
    for (const [f, b] of Object.entries(baseline)) {
      const n = actual[f] ?? 0;
      if (n < b) below.push(`${f}: now ${n}, baseline ${b}`);
    }
    expect(
      below.join('\n  '),
      `Fewer literal colours than the baseline — good. Lock it in so it cannot creep back: node scripts/themeColourBaseline.mjs --write, then commit ${BASELINE_PATH}.`,
    ).toBe('');
  });

  it('🔒 the scanner BITES — proven by injection', () => {
    const hit = (src: string) => literalsIn(src).map((h: { token: string }) => h.token);
    expect(hit('<div className="text-white bg-[#0d1117] border-white/10">')).toEqual(['text-white', 'bg-[#0d1117]', 'border-white/10']);
    expect(hit('cn("hover:text-white md:bg-zinc-900 text-gray-400/60")')).toEqual(['hover:text-white', 'md:bg-zinc-900', 'text-gray-400/60']);
    expect(hit('className="text-amber-300/80 text-indigo-500 text-red-200"')).toHaveLength(3);
    expect(hit("style={{ color: '#e6edf3', background: 'rgba(255,255,255,0.1)' }}")).toHaveLength(2);
    // …and it does NOT fire on the things that are allowed:
    expect(hit('className="bg-surface text-ink border-line text-muted text-on-accent text-ink/40"')).toEqual([]);
    expect(hit('className="bg-indigo-600 bg-emerald-500/10 border-red-500/20 text-transparent"')).toEqual([]); // solid brand fills: same in every theme
    expect(hit('// text-white in a comment is not a usage\n/* bg-[#0d1117] */')).toEqual([]);
  });
});

/* ── WCAG contrast, the same maths the audit used ─────────────────────────────────────────────── */
const hex = (h: string) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const lum = ([r, g, b]: number[]) => { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export const contrast = (a: string, b: string) => { const [x, y] = [lum(hex(a)), lum(hex(b))]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Read one theme's block out of index.css — the palette as shipped, not a copy of it. */
function palette(theme: string): Record<string, string> {
  const css = read('src/index.css');
  const m = css.match(new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  expect(m, `no palette block for ${theme}`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const v of m![1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[v[1]] = v[2].toLowerCase();
  return out;
}
const THEMES = ['light', 'dark', 'contrast'];
/* `surface-raised-hover` is in this list on purpose: a hovered row carries the same faint labels a
   resting one does, so a hover surface the palette does not clear is the audit's own defect with an
   extra step. It is what forced Light's --text-faint from #5b6b82 to #57677e (4.40 → 4.73). */
const SURFACES = ['surface-base', 'surface-card', 'surface-raised', 'surface-raised-hover'];
const TEXTS = ['text-primary', 'text-body', 'text-muted', 'text-faint', 'accent', 'brand-accent-text', 'brand-success-text', 'brand-warn-text', 'brand-danger-text', 'brand-info-text'];

describe('🔒 every theme palette clears WCAG AA (4.5:1) for normal text — Comfort failed 11 of 30 pairs before', () => {
  for (const t of THEMES) {
    it(`${t}: all ${TEXTS.length}×${SURFACES.length} text × surface pairs`, () => {
      const p = palette(t);
      const short: string[] = [];
      for (const tx of TEXTS) for (const su of SURFACES) {
        expect(p[tx], `${t} is missing --${tx}`).toBeTruthy();
        expect(p[su], `${t} is missing --${su}`).toBeTruthy();
        const r = contrast(p[tx], p[su]);
        if (r < 4.5) short.push(`--${tx} on --${su} = ${r.toFixed(2)}`);
      }
      expect(short.join('; '), `${t} has text that fails AA`).toBe('');
    });
  }

  it('🔒 High contrast: the four brand hues are DISTINCT and each clears 7:1 (AAA) on black', () => {
    // The first version painted success, warning, danger and info all #ffff00 — a red "failed" and a
    // green "saved" were the same colour to the one audience that chose this theme to read better.
    const p = palette('contrast');
    const hues = ['brand-success-text', 'brand-warn-text', 'brand-danger-text', 'brand-info-text'].map(k => p[k]);
    expect(new Set(hues).size).toBe(4);
    for (const h of hues) expect(contrast(h, p['surface-base']), `${h} on black`).toBeGreaterThanOrEqual(7);
  });

  it('the maths is right — pinned against the audit\'s own numbers', () => {
    expect(contrast('#484f58', '#161b22')).toBeCloseTo(2.09, 2); // the old dark --text-faint on a card
    expect(contrast('#586e75', '#eee8d5')).toBeCloseTo(4.39, 2); // old Comfort body on a card
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });

  it('each theme declares color-scheme, so native selects, date pickers and scrollbars follow it', () => {
    const css = read('src/index.css');
    for (const t of THEMES) {
      const block = css.match(new RegExp(`html\\[data-theme="${t}"\\]\\s*\\{([^}]*)\\}`))![1];
      expect(block, `${t} has no color-scheme`).toMatch(/color-scheme:\s*(light|dark);/);
    }
  });
});

describe('🔒 the pipeline — tokens exist and the first migrated file is at zero', () => {
  it('index.css exposes every semantic token through @theme inline', () => {
    const css = read('src/index.css');
    const block = css.match(/@theme inline \{([^}]*)\}/)?.[1] ?? '';
    for (const tok of ['surface', 'card', 'raised', 'raised-hover', 'ink', 'body', 'muted', 'faint', 'line', 'accent', 'accent-text', 'success', 'warn', 'danger', 'info', 'on-accent', 'well', 'well-hover', 'scrim']) {
      expect(block, `--color-${tok} missing from @theme inline`).toMatch(new RegExp(`--color-${tok}:`));
    }
    // `inline` is load-bearing: without it Tailwind would bake the var's initial value into the
    // utility instead of referencing it, and the per-theme blocks would never be consulted.
    expect(css).toContain('@theme inline {');
  });

  it('TestingNotice.tsx — the first file on tokens — has no literal colour at all', () => {
    expect(literalsIn(read('src/components/TestingNotice.tsx'))).toEqual([]);
    const src = read('src/components/TestingNotice.tsx');
    expect(src).toContain('bg-card border-line text-ink');
    expect(codeOnly(src)).not.toContain('getThemeClasses'); // the comment may name it; the code may not
  });
});
