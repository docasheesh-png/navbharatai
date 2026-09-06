/**
 * THE APP'S OWN TAB BAR IS THE THIRD THING A DIALOG HAS TO CLEAR.
 *
 * 🔒 THE BUG (admin, 2026-09-06, screenshot: Publish → "connect your domain"). The global mobile nav
 * is `fixed bottom-0` at z-150, so it paints OVER every dialog with a lower z-index. The shared sheet
 * geometry subtracted the browser toolbar (`dvh`) and the device inset (`env()`) and stopped there —
 * it never subtracted OUR bar. Every full-height dialog therefore laid its last ~40px (web/Android)
 * to ~56px (iOS) underneath it.
 *
 * That is not a crop, which is why "just scroll" did not save the user: the scroll container ends
 * under the bar too. Scrolling to the very bottom of the sheet leaves those rows covered with no
 * scroll left to give, so the buttons are unreachable rather than merely off-screen.
 *
 * These tests exist because the fix has a pairing that a human would otherwise have to REMEMBER:
 * reserve the bar when the dialog is below it, opt out when the dialog is above it. Remembering is
 * exactly what failed for the previous three drifts of this same number (focus mode, Code Studio, the
 * iPhone home indicator), so the pairing is checked mechanically here instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MOBILE_NAV_TOTAL_HEIGHT, MOBILE_NAV_HEIGHT_VAR, publishMobileNavHeight } from '../src/lib/mobileNav';

const SRC = resolve(__dirname, '../src');
const css = readFileSync(join(SRC, 'index.css'), 'utf8');

/** The z-index of the global tab bar (src/App.tsx). A dialog at or above this paints OVER the bar. */
const NAV_Z = 150;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

describe('the shared sheet geometry reserves the app\'s own bottom chrome', () => {
  it('both overlay variants subtract the tab bar', () => {
    // The whole fix. Written as max(), so a device inset that is larger than the bar still wins and
    // the two can never be double-counted.
    expect(css).toContain('padding-bottom: max(1rem, var(--nb-safe-bottom), var(--nb-bottom-nav));');
    expect(css).toContain('padding-bottom: max(var(--nb-safe-bottom), var(--nb-bottom-nav));');
  });

  it('the variable defaults to 0px, so anything not told otherwise behaves exactly as before', () => {
    // Desktop, SSR, tests, and the first paint before React's effect runs all land here. A default of
    // anything but zero would reserve a strip for a bar that is not on screen — the "dead strip"
    // failure lib/mobileNav.ts already records from the Code Studio drift.
    expect(css).toContain('--nb-bottom-nav: 0px;');
  });

  it('the opt-out works by zeroing the variable, not by re-declaring the padding', () => {
    // Order- and specificity-independent on purpose: there is no "which declaration wins" question to
    // get wrong later, and the opt-out cannot be half-applied.
    expect(css).toMatch(/\.nb-sheet-over-nav\s*\{\s*--nb-bottom-nav:\s*0px;\s*\}/);
  });

  it('a partial-height sheet is clamped to the room that is actually left', () => {
    expect(css).toContain('max-height: min(var(--nb-sheet-cap, 100%), 100%);');
  });
});

describe('React publishes the height from the SAME boolean that renders the bar', () => {
  const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');

  it('is driven by showsGlobalMobileNav, so the bar and the reservation cannot disagree', () => {
    // This number has now drifted three times when it was maintained by hand. It has exactly one
    // source, and this is the line that connects it to CSS.
    expect(app).toContain('publishMobileNavHeight(showsGlobalMobileNav)');
  });

  it('publishes the shared height, and 0px when the bar is not rendered', () => {
    const seen: Record<string, string> = {};
    const fake = { style: { setProperty: (k: string, v: string) => { seen[k] = v; } } } as unknown as HTMLElement;

    publishMobileNavHeight(true, fake);
    expect(seen[MOBILE_NAV_HEIGHT_VAR]).toBe(MOBILE_NAV_TOTAL_HEIGHT);

    publishMobileNavHeight(false, fake);
    expect(seen[MOBILE_NAV_HEIGHT_VAR]).toBe('0px');
  });

  it('never throws when there is no DOM to write to', () => {
    expect(() => publishMobileNavHeight(true, null)).not.toThrow();
  });
});

describe('every overlay pairs its z-index with the right reservation (locked)', () => {
  // The invariant, checked mechanically so it is never a judgement call:
  //   z-index BELOW the bar  → the bar covers the dialog → it MUST reserve  (no opt-out class)
  //   z-index AT/ABOVE       → the dialog covers the bar → it MUST NOT      (opt-out class present)
  const overlays: { file: string; line: number; z: number | null; optOut: boolean; text: string }[] = [];
  for (const file of walk(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('nb-sheet-overlay')) return;
      const m = line.match(/z-\[(\d+)\]/) || line.match(/\bz-(\d+)\b/);
      overlays.push({
        file: file.slice(SRC.length + 1),
        line: i + 1,
        z: m ? Number(m[1]) : null,
        optOut: line.includes('nb-sheet-over-nav'),
        text: line.trim(),
      });
    });
  }

  it('found the overlays it is meant to be guarding', () => {
    // A regex that silently matches nothing would make every assertion below vacuously pass.
    expect(overlays.length).toBeGreaterThanOrEqual(10);
  });

  it('a dialog UNDER the bar reserves for it', () => {
    const wrong = overlays.filter((o) => o.z !== null && o.z < NAV_Z && o.optOut);
    expect(wrong.map((o) => `${o.file}:${o.line} (z-${o.z})`)).toEqual([]);
  });

  it('a dialog OVER the bar does not reserve for it', () => {
    // An overlay with no z-index in its className carries one inline (PublishCelebration's
    // CELEBRATION_Z), so it is excluded from this direction rather than assumed to be low.
    const wrong = overlays.filter((o) => o.z !== null && o.z >= NAV_Z && !o.optOut);
    expect(wrong.map((o) => `${o.file}:${o.line} (z-${o.z}) needs nb-sheet-over-nav`)).toEqual([]);
  });
});

describe('the nav height is not hand-typed anywhere any more', () => {
  /** Comments are prose, not behaviour — a note that QUOTES the old literal must not fail CI. */
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('no component spells out the bar\'s height instead of reading it', () => {
    // AgentV3Panel's mobile More sheet was the fourth copy of this literal. tests/ideMobile.test.ts
    // already forbade it in App.tsx; it was free to reappear anywhere else.
    const offenders = walk(SRC)
      .filter((f) => stripComments(readFileSync(f, 'utf8')).includes('calc(3.5rem + env(safe-area-inset-bottom'))
      .map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('…and the stripper does not simply blank every file', () => {
    // Without this, a bug in stripComments would make the assertion above vacuous.
    expect(stripComments(readFileSync(join(SRC, 'App.tsx'), 'utf8'))).toContain('publishMobileNavHeight');
  });
});
