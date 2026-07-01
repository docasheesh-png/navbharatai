import { describe, it, expect } from 'vitest';
import {
  clampFontScale,
  resolveReduceMotion,
  nextRovingIndex,
  computeTrapTarget,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FOCUSABLE_SELECTOR,
} from './a11y';

/** P-DESIGN.3 — pure accessibility logic (font-scale, motion resolution, roving, focus-trap). */

describe('clampFontScale', () => {
  it('clamps below the minimum and above the maximum', () => {
    expect(clampFontScale(0.1)).toBe(FONT_SCALE_MIN);
    expect(clampFontScale(9)).toBe(FONT_SCALE_MAX);
  });
  it('passes a mid value through, rounded to 2 dp', () => {
    expect(clampFontScale(1.234)).toBe(1.23);
    expect(clampFontScale(1)).toBe(1);
  });
  it('falls back to 1 for non-finite input (NaN and Infinity)', () => {
    expect(clampFontScale(NaN)).toBe(1);
    expect(clampFontScale(Infinity)).toBe(1); // guarded as non-finite → safe default, never a runaway zoom
    expect(clampFontScale(-Infinity)).toBe(1);
  });
});

describe('resolveReduceMotion', () => {
  it('animated never reduces; reduced always reduces', () => {
    expect(resolveReduceMotion('animated', true)).toBe(false);
    expect(resolveReduceMotion('animated', false)).toBe(false);
    expect(resolveReduceMotion('reduced', false)).toBe(true);
    expect(resolveReduceMotion('reduced', true)).toBe(true);
  });
  it('system follows the OS preference', () => {
    expect(resolveReduceMotion('system', true)).toBe(true);
    expect(resolveReduceMotion('system', false)).toBe(false);
  });
});

describe('nextRovingIndex', () => {
  it('moves down with wrap in vertical orientation', () => {
    expect(nextRovingIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextRovingIndex(2, 3, 'ArrowDown')).toBe(0); // wrap
  });
  it('moves up with wrap in vertical orientation', () => {
    expect(nextRovingIndex(0, 3, 'ArrowUp')).toBe(2); // wrap
    expect(nextRovingIndex(2, 3, 'ArrowUp')).toBe(1);
  });
  it('Home/End jump to the ends', () => {
    expect(nextRovingIndex(1, 4, 'Home')).toBe(0);
    expect(nextRovingIndex(1, 4, 'End')).toBe(3);
  });
  it('ignores horizontal keys in a vertical list and vice-versa', () => {
    expect(nextRovingIndex(1, 3, 'ArrowRight', 'vertical')).toBe(1);
    expect(nextRovingIndex(1, 3, 'ArrowDown', 'horizontal')).toBe(1);
  });
  it('both orientation accepts arrows on either axis', () => {
    expect(nextRovingIndex(0, 3, 'ArrowRight', 'both')).toBe(1);
    expect(nextRovingIndex(0, 3, 'ArrowDown', 'both')).toBe(1);
    expect(nextRovingIndex(0, 3, 'ArrowUp', 'both')).toBe(2);
  });
  it('returns -1 for an empty list', () => {
    expect(nextRovingIndex(0, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('computeTrapTarget', () => {
  it('returns null when there is nothing to trap', () => {
    expect(computeTrapTarget(0, -1, false)).toBeNull();
  });
  it('always keeps a single focusable focused', () => {
    expect(computeTrapTarget(1, -1, false)).toBe(0);
    expect(computeTrapTarget(1, 0, true)).toBe(0);
  });
  it('pulls escaped focus to the correct edge', () => {
    expect(computeTrapTarget(3, -1, false)).toBe(0); // Tab from outside → first
    expect(computeTrapTarget(3, -1, true)).toBe(2); // Shift+Tab from outside → last
  });
  it('wraps at the boundaries', () => {
    expect(computeTrapTarget(3, 2, false)).toBe(0); // Tab off the last → first
    expect(computeTrapTarget(3, 0, true)).toBe(2); // Shift+Tab off the first → last
  });
  it('lets the browser handle the middle of the list', () => {
    expect(computeTrapTarget(3, 1, false)).toBeNull();
    expect(computeTrapTarget(3, 1, true)).toBeNull();
  });
});

describe('FOCUSABLE_SELECTOR', () => {
  it('covers the standard interactive elements and excludes hidden/-1 tabindex', () => {
    expect(FOCUSABLE_SELECTOR).toContain('a[href]');
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])');
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
    expect(FOCUSABLE_SELECTOR).toContain('input:not([disabled]):not([type="hidden"])');
  });
});
