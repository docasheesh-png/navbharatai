/**
 * A GLOBAL `transform` IS A GLOBAL BUG IN `position: fixed`.
 *
 * 🔴 THE BUG (admin, 2026-09-12). Opening a user's details from the END of the admin user list
 * rendered the dialog somewhere far above the screen — "upscroll karna padta hai". The dialog's own
 * markup was correct (`fixed inset-0`), and so was the shared sheet geometry. The cause was two
 * lines of global CSS, nowhere near either:
 *
 *     .animate-spin, .animate-pulse, .animate-bounce, [class*="transition-"] { will-change: transform }
 *     .animate-pulse, .animate-bounce, [class*="transition-"] { transform: translateZ(0) }
 *
 * `[class*="transition-"]` matches any element whose class attribute merely CONTAINS the substring,
 * so it caught every `transition-all` / `transition-colors` in the app — including App.tsx's main
 * view container, which is the page's scroll container. Both `transform` and `will-change: transform`
 * make an element a containing block for `position: fixed` descendants, so every overlay inside it
 * became relative to the SCROLLED CONTENT box instead of the viewport: scrolled 1,200px down,
 * the dialog opened 1,200px off-screen.
 *
 * WHY IT SURVIVED: in the chat/studio/preview views that container is `overflow-hidden` at viewport
 * height, where both positioning bases coincide. Only a scrolling view, scrolled down, reveals it.
 *
 * These tests are mechanical because the failure is invisible in code review — the broken dialog and
 * the rule that breaks it are in different files, and the rule reads like a harmless perf hint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

/** Strip comments so prose describing the old bug never satisfies (or trips) an assertion. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { ... }` rule in the stylesheet, comments already removed. */
function rules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/** `prop: value` pairs of a declaration block, property lower-cased, `!important` dropped. */
function declarations(body: string): { prop: string; value: string }[] {
  return body
    .split(';')
    .map((d) => d.split(':'))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      prop: parts[0].trim().toLowerCase(),
      value: parts.slice(1).join(':').replace(/!important/gi, '').trim().toLowerCase(),
    }));
}

/** Does this declaration block make the element a containing block for fixed descendants? */
function createsContainingBlock(body: string): boolean {
  return declarations(body).some(({ prop, value }) => {
    if (!value || value === 'none') return false;
    if (prop === 'transform' || prop === 'filter' || prop === 'backdrop-filter') return true;
    if (prop === 'perspective') return true;
    // `will-change` promotes ahead of time and takes the containing block with it.
    if (prop === 'will-change') return /\b(transform|filter|perspective)\b/.test(value);
    return false;
  });
}

describe('global CSS never steals the viewport from position: fixed', () => {
  it('no rule applies a containing-block property by class SUBSTRING', () => {
    const offenders = rules()
      .filter((r) => /\[class\s*[*^$~|]?=/.test(r.selector))
      .filter((r) => createsContainingBlock(r.body))
      .map((r) => r.selector);

    // An attribute-substring selector cannot be reasoned about locally: whoever writes
    // `transition-colors` on a scroll container three files away has no way to know it opts that
    // container into breaking every dialog beneath it.
    expect(offenders).toEqual([]);
  });

  it('the specific selector that caused the bug is gone', () => {
    expect(code).not.toMatch(/\[class\*=["']transition-["']\]/);
  });

  it('GPU promotion is still applied to the elements that genuinely animate', () => {
    // The fix removes over-promotion, not the optimisation. `.animate-spin` keeps the will-change
    // hint and must keep being EXCLUDED from the static translateZ(0) — that exclusion is what makes
    // the app's spinners actually spin (see the comment in index.css).
    const willChange = rules().find((r) => /will-change\s*:\s*transform/.test(r.body));
    expect(willChange?.selector).toContain('.animate-spin');

    const promoted = rules().find(
      (r) => /transform\s*:\s*translateZ\(0\)/.test(r.body) && r.selector.includes('.animate-'),
    );
    expect(promoted?.selector).toContain('.animate-pulse');
    expect(promoted?.selector).not.toContain('.animate-spin');
  });

  it('the helper recognises each way an element becomes a containing block', () => {
    expect(createsContainingBlock('transform: translateZ(0);')).toBe(true);
    expect(createsContainingBlock('will-change: transform;')).toBe(true);
    expect(createsContainingBlock('filter: blur(2px);')).toBe(true);
    expect(createsContainingBlock('backdrop-filter: blur(2px);')).toBe(true);
    expect(createsContainingBlock('perspective: 400px;')).toBe(true);
    // ...and that the documented escape hatches are not mistaken for one.
    expect(createsContainingBlock('transform: none;')).toBe(false);
    expect(createsContainingBlock('will-change: auto;')).toBe(false);
    expect(createsContainingBlock('transform-origin: center;')).toBe(false);
    expect(createsContainingBlock('transition-duration: 0.01ms;')).toBe(false);
  });
});
