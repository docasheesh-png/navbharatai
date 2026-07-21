import { describe, it, expect } from 'vitest';
import { clampComposerHeight, COMPOSER_MAX_LINES } from './composerHeight';

// Representative computed metrics: 20px line-height, 8px total vertical padding (py-1 ≈ 4px × 2).
const LINE = 20;
const PAD = 8;
const oneLine = LINE + PAD;                       // 28
const sixLines = LINE * COMPOSER_MAX_LINES + PAD;  // 128

describe('clampComposerHeight — rest at 1 line, grow to ~6, then scroll', () => {
  it('rests at exactly one line when the content is one line', () => {
    expect(clampComposerHeight(oneLine, LINE, PAD)).toBe(oneLine);
  });

  it('never shrinks below one line even if scrollHeight reports less', () => {
    expect(clampComposerHeight(0, LINE, PAD)).toBe(oneLine);
    expect(clampComposerHeight(10, LINE, PAD)).toBe(oneLine);
  });

  it('GROWS with the content between one and six lines (the reported bug: it must actually grow)', () => {
    const threeLines = LINE * 3 + PAD; // 68
    expect(clampComposerHeight(threeLines, LINE, PAD)).toBe(threeLines);
    // and growth is monotonic
    expect(clampComposerHeight(LINE * 4 + PAD, LINE, PAD)).toBeGreaterThan(clampComposerHeight(LINE * 2 + PAD, LINE, PAD));
  });

  it('caps at ~6 lines, then the textarea scrolls (does not grow past the cap)', () => {
    expect(clampComposerHeight(sixLines, LINE, PAD)).toBe(sixLines);
    expect(clampComposerHeight(LINE * 20 + PAD, LINE, PAD)).toBe(sixLines); // a huge paste is capped
  });

  it('the old ~2-line cap is gone — 5 lines of content is NOT clamped to 2 (regression guard)', () => {
    const fiveLines = LINE * 5 + PAD; // 108
    const twoLineCap = LINE * 2 + PAD; // 48 (the previous, too-small cap)
    expect(clampComposerHeight(fiveLines, LINE, PAD)).toBe(fiveLines);
    expect(clampComposerHeight(fiveLines, LINE, PAD)).toBeGreaterThan(twoLineCap);
  });

  it('is safe against degenerate computed metrics (0/NaN line-height and padding)', () => {
    expect(clampComposerHeight(200, 0, 0)).toBe(20 * COMPOSER_MAX_LINES); // falls back to 20px line-height
    expect(clampComposerHeight(NaN, LINE, PAD)).toBe(oneLine);
    expect(Number.isFinite(clampComposerHeight(50, LINE, PAD))).toBe(true);
  });
});
