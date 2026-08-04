import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Regression lock for the app-wide "spinner doesn't spin" bug.
//
// Root cause (verified in Chromium): Tailwind's `@keyframes spin` defines only the
// `to` (100%) frame, so the `from` (0%) is synthesised from the element's underlying
// transform. The K11 GPU-promotion rule used to apply a static `transform: translateZ(0)`
// to `.animate-spin`, which made that synthesised `from` an identity matrix; `to` is
// `rotate(360deg)` — also identity — so the interpolation was identity→identity and the
// spinner never visibly rotated. The fix keeps the `will-change` hint but removes the
// static transform from `.animate-spin`. This test fails if that poisoning combination
// ever returns.

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');

// Iterate flat rule blocks: `selector { declarations }` (no nested braces — enough for the
// flat utility rules we care about; @keyframes blocks contain nested braces and are skipped).
function flatRules(source: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

describe('animate-spin must never carry a static transform (freeze-proof)', () => {
  const rules = flatRules(css);

  it('no rule targets `.animate-spin` while also declaring a static transform', () => {
    const offenders = rules.filter(
      (r) => /(^|,|\s)\.animate-spin(\s|,|$)/.test(r.selector) && /transform\s*:/.test(r.body),
    );
    expect(offenders.map((o) => o.selector)).toEqual([]);
  });

  it('the K11 GPU hint (will-change) is still applied to `.animate-spin`', () => {
    const hinted = rules.some(
      (r) => /(^|,|\s)\.animate-spin(\s|,|$)/.test(r.selector) && /will-change\s*:\s*transform/.test(r.body),
    );
    expect(hinted).toBe(true);
  });
});
