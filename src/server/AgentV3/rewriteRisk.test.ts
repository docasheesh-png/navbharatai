import { describe, it, expect } from 'vitest';
import { assessFullRewrite } from './rewriteRisk';

describe('assessFullRewrite', () => {
  const big = (n: number) => 'x'.repeat(n);

  it('flags a substantial file rewritten to under half its size as likely content loss', () => {
    const risk = assessFullRewrite(big(2000), big(600)); // 70% smaller
    expect(risk.level).toBe('shrink');
    expect(risk.message).toContain('LIKELY CONTENT LOSS');
    expect(risk.message).toContain('70% SMALLER');
    expect(risk.message).toContain('2000 → 600 bytes');
  });

  it('does NOT flag a shrink that stays at/above half the original size', () => {
    // 1000 → 600 is only 40% smaller (600 ≥ 500 = half) → normal rewrite.
    const risk = assessFullRewrite(big(1000), big(600));
    expect(risk.level).toBe('rewrite');
    expect(risk.message).toContain('FULL-REWRITE WARNING');
  });

  it('never flags a shrink for a small file (below the size floor), even if it shrinks a lot', () => {
    // 300 → 10 is 97% smaller but the original is under MIN_SIZE_TO_JUDGE (400) → configs/stubs are fine.
    const risk = assessFullRewrite(big(300), big(10));
    expect(risk.level).toBe('rewrite');
  });

  it('treats a file at exactly the size floor as judgeable', () => {
    // oldLen 400 (== floor), new 100 (< 200 = half) → shrink.
    const risk = assessFullRewrite(big(400), big(100));
    expect(risk.level).toBe('shrink');
  });

  it('does not flag a rewrite that GROWS the file', () => {
    const risk = assessFullRewrite(big(1000), big(3000));
    expect(risk.level).toBe('rewrite');
  });

  it('handles an empty previous file (a create-like overwrite) without dividing by zero', () => {
    const risk = assessFullRewrite('', big(500));
    expect(risk.level).toBe('rewrite');
    expect(risk.message).toContain('FULL-REWRITE WARNING');
  });

  it('always steers toward edit_file in the guidance text', () => {
    expect(assessFullRewrite(big(2000), big(100)).message).toContain('edit_file');
    expect(assessFullRewrite(big(500), big(480)).message).toContain('edit_file');
  });
});
