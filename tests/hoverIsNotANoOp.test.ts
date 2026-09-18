/**
 * 🔒 A HOVER THAT REPEATS THE RESTING BACKGROUND IS NOT A HOVER.
 *
 * The theme migration (#3070) replaced the app's `bg-white/10 hover:bg-white/15` idiom with semantic
 * tokens — and BOTH alphas map to the single `bg-raised`, so `bg-raised hover:bg-raised` was emitted
 * 105 times. Nothing failed: the classes are valid, the ratchet counts literals rather than
 * behaviour, and every contrast check passed because the colour was, by construction, the colour
 * that already passed. 76 of those controls had no other hover feedback of any kind, so a button
 * simply stopped answering the pointer. That is the shape this suite exists to make impossible.
 *
 * The fix is a real second surface per theme (`--surface-raised-hover`, `--surface-well-hover`)
 * rather than a per-site tweak, because the defect was one collapsed mapping and not 105 mistakes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { globSync } from 'glob';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Template literals carrying markup are somebody else's app (a copyable snippet, a starter
 *  project) — the same exclusion `scripts/themeColourBaseline.mjs` makes, for the same reason. */
function maskEmbedded(src: string): string {
  return src.replace(/`[^`]*`/gs, (b) =>
    /className=|class=|<[a-zA-Z][^>]*>/.test(b) ? ' '.repeat(b.length) : b);
}

const ATTR = /(?:className|class)\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\}|\{\s*`([^`]*)`\s*\})/g;
const SURFACES = ['surface', 'card', 'raised', 'well'];

/** Every quoted string: a class list chosen by a ternary inside a template, or handed to a
 *  `buttonClassName` prop, never reaches an attribute this scanner can name — ten dead hovers hid in
 *  exactly those places while the attribute pass was green (2026-09-18). A string carrying both a
 *  resting surface and a hover to it is a class list by construction, whatever it is assigned to. */
const QUOTED = /'([^'\n]*)'|"([^"\n]*)"/g;

function noOpHoversIn(src: string): string[] {
  const masked = maskEmbedded(src);
  // Every candidate class list, judged ONCE: whole attributes (including backtick templates) plus every
  // single- or double-quoted string. A double-quoted attribute appears in both passes with the same
  // content, so the set collapses it to one offender.
  const lists = new Set<string>();
  for (const m of masked.matchAll(ATTR)) lists.add(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
  for (const m of masked.matchAll(QUOTED)) lists.add(m[1] ?? m[2] ?? '');
  const out: string[] = [];
  for (const list of lists) {
    const cls = list.split(/\s+/);
    for (const s of SURFACES) {
      if (cls.includes(`bg-${s}`) && (cls.includes(`hover:bg-${s}`) || cls.includes(`group-hover:bg-${s}`))) {
        out.push(`bg-${s} + hover:bg-${s}`);
      }
    }
  }
  return out;
}

describe('🔒 no control hovers to the background it already has', () => {
  const files = globSync('src/**/*.{ts,tsx}', { cwd: root }).filter((f) => !f.startsWith('src/server/'));

  it('scans a real number of client files — a scanner that finds nothing proves nothing', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('not one client file pairs a resting surface with the same surface on hover', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const hit of noOpHoversIn(read(f))) offenders.push(`${f}: ${hit}`);
    }
    expect(offenders.join('\n'), `${offenders.length} dead hover(s)`).toBe('');
  });

  it('🔒 the scanner BITES — proven by injection', () => {
    expect(noOpHoversIn('<div className="bg-raised hover:bg-raised" />')).toHaveLength(1);
    expect(noOpHoversIn('<div className="bg-well group-hover:bg-well" />')).toHaveLength(1);
    // the real fix reads as no offence
    expect(noOpHoversIn('<div className="bg-raised hover:bg-raised-hover" />')).toEqual([]);
    // a hover onto a DIFFERENT surface was always fine
    expect(noOpHoversIn('<div className="bg-card hover:bg-raised" />')).toEqual([]);
    // and somebody else's snippet is not ours to police
    expect(noOpHoversIn('const snippet = `<div class="bg-raised hover:bg-raised">x</div>`;')).toEqual([]);
  });
});

describe('🔒 the hover surfaces exist on every theme and actually differ from the resting one', () => {
  const css = read('src/index.css');
  const palette = (theme: string) => {
    const block = css.match(new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
    expect(block, `no palette block for ${theme}`).toBeTruthy();
    const out: Record<string, string> = {};
    for (const v of block![1].matchAll(/--([\w-]+):\s*([^;]+);/g)) out[v[1]] = v[2].trim().toLowerCase();
    return out;
  };

  for (const theme of ['light', 'dark', 'contrast']) {
    it(`${theme}: raised-hover and well-hover are declared and are NOT their resting value`, () => {
      const p = palette(theme);
      for (const [rest, hover] of [['surface-raised', 'surface-raised-hover'], ['surface-well', 'surface-well-hover']]) {
        expect(p[rest], `${theme} is missing --${rest}`).toBeTruthy();
        expect(p[hover], `${theme} is missing --${hover}`).toBeTruthy();
        expect(p[hover], `${theme}: --${hover} repeats --${rest}, which is the bug`).not.toBe(p[rest]);
      }
    });
  }

  it('the lift is big enough to SEE — every theme moves the raised surface by at least 7%', () => {
    // A token that differs only in the last hex digit would pass the test above and still be
    // invisible, which is the same "nothing failed" outcome in a new costume.
    const hex = (h: string) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
    const lum = ([r, g, b]: number[]) => { const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(hex(a)), lum(hex(b))]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    for (const theme of ['light', 'dark', 'contrast']) {
      const p = palette(theme);
      expect(ratio(p['surface-raised-hover'], p['surface-raised']), `${theme} hover lift`).toBeGreaterThan(1.07);
    }
  });
});
