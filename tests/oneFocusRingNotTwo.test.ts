/**
 * ONE FOCUS RING, NOT TWO (admin 2026-09-24, phone screenshot of Wellness / Counsellor AI in full
 * screen: "input box me aise 2 box jaise dikh rahe hai! isko fix karo").
 *
 * The composer's rounded box turns indigo on `focus-within` — that is its focus indicator. Inside it,
 * the textarea drew a SECOND ring: the global `:focus-visible` outline from `src/index.css`. The
 * textarea carries `outline-none`, but that rule was UNLAYERED, and in the cascade an unlayered rule
 * beats every rule in a layer whatever its specificity — Tailwind v4's utilities live in
 * `@layer utilities`, so `outline-none` / `focus:outline-none` lost on all ~300 elements that use them.
 * A text field counts as focus-visible on every tap, so every composer showed two boxes.
 *
 * Verified in Chromium against the built stylesheet before and after: a focused
 * `<textarea class="outline-none">` computed `outline: solid 2px` before, `none` after, while a plain
 * button reached by Tab still gets the indigo ring.
 *
 * This reads the source because the defect is the rule's POSITION in the cascade — no unit test of a
 * component can see which layer a global selector sits in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = readFileSync(join(__dirname, '..', 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every top-level rule with the `@layer`/`@media` chain it sits inside. */
function rules(css: string): Array<{ selector: string; body: string; ancestors: string[] }> {
  const out: Array<{ selector: string; body: string; ancestors: string[] }> = [];
  const stack: Array<{ prelude: string; bodyStart: number }> = [];
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      stack.push({ prelude: prelude.trim(), bodyStart: i + 1 });
      prelude = '';
    } else if (c === '}') {
      const open = stack.pop();
      if (open && !open.prelude.startsWith('@')) {
        out.push({
          selector: open.prelude.replace(/\s+/g, ' '),
          body: css.slice(open.bodyStart, i),
          ancestors: stack.map((s) => s.prelude),
        });
      }
      prelude = '';
    } else if (c === ';') {
      prelude = '';
    } else {
      prelude += c;
    }
  }
  return out;
}

const inLayer = (ancestors: string[]) => ancestors.some((a) => a.startsWith('@layer'));

describe('the global focus ring yields to an element that opts out', () => {
  const all = rules(CSS);

  it('the :focus-visible ring still exists — keyboard users keep a visible focus', () => {
    const ring = all.find((r) => r.selector === ':focus-visible');
    expect(ring).toBeDefined();
    expect(ring!.body).toMatch(/outline:\s*2px solid/);
  });

  it('it sits in a cascade layer, so `outline-none` (a layered utility) can override it', () => {
    const ring = all.find((r) => r.selector === ':focus-visible')!;
    expect(inLayer(ring.ancestors)).toBe(true);
  });

  it('no UNLAYERED focus rule in index.css sets outline or radius — the sibling of the same defect', () => {
    const offenders = all
      .filter((r) => /:focus/.test(r.selector) && !inLayer(r.ancestors))
      .filter((r) => /\b(outline|border-radius)\s*:/.test(r.body))
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });
});

describe('the composer relies on this: the textarea opts out, the box is the indicator', () => {
  const SHELL = readFileSync(join(__dirname, '..', 'src', 'components', 'chat', 'ComposerShell.tsx'), 'utf8');

  it('the textarea carries outline-none and the box carries focus-within', () => {
    expect(SHELL).toMatch(/COMPOSER_TEXTAREA_CLASS =\s*\n?\s*'[^']*\boutline-none\b/);
    expect(SHELL).toMatch(/COMPOSER_BOX_CLASS =\s*\n?\s*'[^']*\bfocus-within:border-indigo-500\b/);
  });
});
