import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const css = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const COMPAT = css('src/styles/theme-compat.css');
const INDEX = css('src/index.css');

/**
 * THE BUG THIS LOCKS (admin 2026-09-13, from a screenshot: "yeh button dikh hi nahi rahe hai").
 *
 * `theme-compat.css` flips card backgrounds to white on a light theme but deliberately left brand
 * colours alone. That is right for a white label on a solid indigo button and wrong for indigo text
 * on a card — which is ~1,459 places in this app, including the ₹149 and ₹499 prices the admin
 * photographed as unreadable.
 */
describe('brand text is readable on every theme, not just the dark one', () => {
  const TINTED = [
    'text-indigo-300', 'text-indigo-400', 'text-emerald-400', 'text-emerald-300',
    'text-amber-300', 'text-amber-400', 'text-red-400', 'text-sky-300',
  ];

  it('every light Tailwind brand shade used as text is remapped', () => {
    for (const cls of TINTED) {
      expect(COMPAT, `${cls} is not remapped — it will be invisible on a light theme`).toContain(`.${cls}`);
    }
  });

  it('the remap goes through a variable, never a hardcoded colour', () => {
    // A literal hex here would be one theme's answer imposed on all five.
    expect(COMPAT).toMatch(/\.text-indigo-300[^{]*\{\s*color:\s*var\(--brand-accent-text\)/);
    expect(COMPAT).toMatch(/\.text-emerald-400[^{]*\{\s*color:\s*var\(--brand-success-text\)/);
  });

  const VARS = [
    '--brand-accent-text', '--brand-accent-strong', '--brand-success-text',
    '--brand-success-strong', '--brand-warn-text', '--brand-warn-strong',
    '--brand-danger-text', '--brand-info-text',
  ];

  // A variable defined for only some themes is the classic unreadable-artifact bug: the themes that
  // lack it inherit nothing and the text falls back to the browser default.
  it('every variable is defined for all three themes', () => {
    for (const v of VARS) {
      // Count DEFINITIONS (`--brand-x: #hex`), not mentions. This used to split on the bare name,
      // which also counted a REFERENCE — and on 2026-09-18 the semantic token block in index.css
      // (`--color-success: var(--brand-success-text)`) added exactly one per variable, failing a
      // guard whose claim was untouched. A definition is the name followed by a literal colour.
      const count = (INDEX.match(new RegExp(`${v}:\\s*#[0-9a-fA-F]{6}`, 'g')) ?? []).length;
      expect(count, `${v} is defined ${count} times, expected 3 (one per theme)`).toBe(3);
    }
  });

  it('dark keeps the original Tailwind values, so the change is a no-op there', () => {
    const dark = INDEX.slice(INDEX.indexOf('--accent: #818cf8;'), INDEX.indexOf('--accent: #4f46e5;'));
    expect(dark).toContain('--brand-accent-text: #a5b4fc;');   // text-indigo-300
    expect(dark).toContain('--brand-success-text: #34d399;');  // text-emerald-400
  });

  // 🔴 THE TEST THAT ACTUALLY ANSWERS THE ADMIN'S QUESTION. Every other assertion in this file
  // proves a RULE EXISTS; none of them proves anything is READABLE. Grepping CSS cannot see
  // contrast — and when this was first computed it found SEVEN failures in shades I had chosen by
  // eye, including amber on the very light theme the bug was reported on. So the ratio is measured
  // here, against each theme's own surfaces, and a future colour tweak has to clear the same bar.
  it('every brand colour clears WCAG AA (4.5:1) on its own theme’s card AND raised surface', () => {
    const lum = (hex: string) => {
      const h = hex.replace('#', '');
      const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [la, lb] = [lum(a), lum(b)];
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    const blocks = [...INDEX.matchAll(/data-theme=['"](\w+)['"]\s*\]\s*\{([\s\S]*?)\n\s*\}/g)];
    expect(blocks.length, 'no theme blocks parsed — the selector shape changed').toBeGreaterThanOrEqual(3);

    for (const [, theme, body] of blocks) {
      const read = (k: string) => body.match(new RegExp(`${k}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      const card = read('--surface-card');
      const raised = read('--surface-raised') ?? card;
      if (!card || !raised) continue;
      for (const v of VARS) {
        const colour = read(v);
        expect(colour, `${v} is missing on the ${theme} theme`).toBeTruthy();
        const worst = Math.min(ratio(colour!, card), ratio(colour!, raised));
        expect(worst, `${v} on ${theme} is ${worst.toFixed(2)}:1 — unreadable`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // The lightest Tailwind shades are the worst offenders on a light ground and were missed on the
  // first pass — found by COUNTING every brand text class in use rather than listing the ones I had
  // noticed. ~250 usages. This keeps the inventory honest.
  it('covers the very light 100/200 shades too, not just the ones that were obvious', () => {
    for (const cls of ['text-amber-100', 'text-amber-200', 'text-indigo-200', 'text-emerald-200',
                       'text-red-200', 'text-red-300', 'text-rose-300', 'text-sky-400']) {
      expect(COMPAT, `${cls} is still unmapped`).toContain(`.${cls}`);
    }
  });
});

describe('the guard — a solid brand background keeps its light text', () => {
  // 117 elements carry a solid brand background AND tinted text. Remapping those would swap one
  // invisible combination for another, so a solid background re-declares the variables locally.
  it('solid brand backgrounds reset the variables', () => {
    const guard = COMPAT.slice(COMPAT.indexOf('.bg-indigo-500,'));
    expect(guard).toContain('--brand-accent-text: #a5b4fc;');
    expect(guard).toContain('--brand-success-text: #34d399;');
    for (const bg of ['.bg-indigo-600', '.bg-emerald-600', '.bg-red-600', '.bg-amber-500']) {
      expect(guard).toContain(bg);
    }
  });

  // Tailwind escapes an opacity modifier into a different class name, which is exactly what lets a
  // 5% wash be remapped while a solid button is protected. If that ever stops holding, the guard
  // silently starts protecting card washes too.
  it('protects only SOLID shades, never the faint washes used as card backgrounds', () => {
    const guard = COMPAT.slice(COMPAT.indexOf('.bg-indigo-500,'));
    expect(guard).not.toContain('bg-indigo-500\\/');
    expect(guard).not.toContain('bg-emerald-500\\/');
  });
});

describe('the grey slab behind each plan — fixed at the component, not with a blanket rule', () => {
  const card = readFileSync(join(process.cwd(), 'src/components/panels/HostingPlanCard.tsx'), 'utf8');

  // FIRST ATTEMPT, AND WHY IT WAS WRONG. I remapped `bg-black/20` in the compat layer, which fixed
  // the slab and broke every modal scrim — a dimming overlay must stay dark on a light theme, and
  // `themeAlphaRemap.test.ts` has pinned that since 2026-08-16. The prior decision was right: the
  // slab was never a scrim, it was a RAISED PANEL written with a scrim's class. So the component
  // now says what it means, and the compat layer already knew how to theme that.
  it('uses a surface class the theme layer maps, not a black overlay', () => {
    expect(card).not.toContain('bg-black/20');
    // The theme replacement (PR J, 2026-09-18) took this the last step: the slab no longer relies on
    // `theme-compat.css` remapping a GitHub-dark literal, it names the raised surface token directly.
    // The claim is unchanged and now stronger — it is a real surface, not an overlay.
    expect(card).toContain('bg-raised');
  });
});
