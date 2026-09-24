/**
 * The promo-code "Apply code" button sat off the right edge of a phone (admin 2026-09-24, screenshot).
 *
 * Cause: the code box and the button shared one flex row, and an <input> does not shrink below its
 * built-in minimum width (a flex item's default `min-width: auto`), so on a narrow phone the row was
 * wider than the screen and pushed the button out. The referral panel's "Apply" row — shown only on
 * Android, i.e. only on a phone — had the identical shape. Both are now stacked: box on top, a
 * full-width button under it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** The markup from a placeholder back to its wrapper and forward to its button. */
function row(src: string, placeholder: string): { wrapper: string; input: string; button: string } {
  const at = src.indexOf(`placeholder="${placeholder}"`);
  expect(at, placeholder).toBeGreaterThan(0);
  const before = src.slice(0, at);
  const wrapperAt = before.lastIndexOf('<div className="');
  const wrapper = before.slice(wrapperAt, before.indexOf('>', wrapperAt));
  const input = src.slice(before.lastIndexOf('<input'), src.indexOf('/>', at));
  const buttonAt = src.indexOf('<button', at);
  // Its className, read by attribute — a slice to the first `>` stops inside `() =>`.
  const button = /className="([^"]*)"/.exec(src.slice(buttonAt))?.[1] ?? '';
  return { wrapper, input, button };
}

describe('a code box and its Apply button can never push each other off a phone screen', () => {
  for (const [file, placeholder] of [
    ['src/components/panels/BillingPanel.tsx', 'Enter your promo code'],
    ['src/components/panels/ReferralPanel.tsx', 'Enter referral code'],
  ] as const) {
    it(`${placeholder}: the button is under the box, full width`, () => {
      const r = row(read(file), placeholder);
      expect(r.wrapper).toContain('flex-col');
      expect(r.input).toContain('min-w-0');
      expect(r.button).toContain('w-full');
    });
  }
});
