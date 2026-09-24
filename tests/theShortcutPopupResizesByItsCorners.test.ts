/**
 * THE SHORTCUTS POPUP RESIZES BY ITS CORNERS AND BY A PINCH (admin 2026-09-24). The three fixed sizes
 * are gone; one continuous scale, one rule for both gestures, bounded by the viewport so a phone can
 * never push the close button off its own screen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  scaleFromGesture, cornerGestureStart, pinchGestureStart, clampScale, maxScaleFor,
  readPopupScale, writePopupScale, MIN_SCALE, MAX_SCALE, POPUP_SCALE_KEY, CORNERS,
} from '../src/components/ide/popupResize';

const natural = { width: 400, height: 300 };
const phone = { width: 390, height: 844 };
const desktop = { width: 1440, height: 900 };

describe('one rule for both gestures', () => {
  it('a corner dragged to twice its distance from the centre doubles the scale', () => {
    const start = cornerGestureStart(1, { x: 200, y: 150 }, { x: 0, y: 0 });
    expect(scaleFromGesture(start, 2 * start.length, natural, desktop)).toBeCloseTo(2, 5);
  });
  it('a pinch that halves the finger gap halves the scale', () => {
    const start = pinchGestureStart(1, { x: 0, y: 0 }, { x: 200, y: 0 });
    expect(scaleFromGesture(start, 100, natural, desktop)).toBeCloseTo(0.5, 5);
  });
  it('the two gestures agree: the same ratio gives the same scale', () => {
    const c = cornerGestureStart(1.2, { x: 100, y: 100 }, { x: 0, y: 0 });
    const p = pinchGestureStart(1.2, { x: 0, y: 0 }, { x: 141.42, y: 0 });
    expect(scaleFromGesture(c, c.length * 1.5, natural, desktop))
      .toBeCloseTo(scaleFromGesture(p, p.length * 1.5, natural, desktop), 5);
  });
  it('a zero-length start (two fingers on one point) keeps the scale — never Infinity', () => {
    expect(scaleFromGesture({ scale: 1.3, length: 0 }, 50, natural, desktop)).toBeCloseTo(1.3, 5);
  });
});

describe('bounded by the viewport', () => {
  it('on a phone the popup cannot grow past the screen width (minus the margin)', () => {
    const ceiling = maxScaleFor(natural, phone);
    expect(ceiling).toBeCloseTo((390 - 16) / 400, 5);
    const start = cornerGestureStart(1, { x: 200, y: 150 }, { x: 0, y: 0 });
    expect(scaleFromGesture(start, start.length * 10, natural, phone)).toBeCloseTo(ceiling, 5);
  });
  it('never below MIN_SCALE, never above MAX_SCALE even on a huge screen', () => {
    expect(clampScale(0.01, natural, desktop)).toBe(MIN_SCALE);
    expect(clampScale(99, natural, { width: 100000, height: 100000 })).toBe(MAX_SCALE);
  });
  it('a viewport narrower than the minimum still allows the minimum (it is better to overflow slightly than to vanish)', () => {
    expect(clampScale(0.7, natural, { width: 100, height: 100 })).toBe(MIN_SCALE);
  });
  it('NaN, Infinity and a degenerate box read as scale 1', () => {
    expect(clampScale(NaN, natural, desktop)).toBe(1);
    expect(clampScale(Infinity, natural, desktop)).toBe(1);
    expect(maxScaleFor({ width: 0, height: 0 }, desktop)).toBe(MAX_SCALE);
  });
});

describe('the remembered scale', () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
  it('round-trips, rounded to a thousandth', () => {
    const s = store();
    writePopupScale(s, 1.23456);
    expect(s.m.get(POPUP_SCALE_KEY)).toBe('1.235');
    expect(readPopupScale(s)).toBe(1.235);
  });
  it('an unreadable, missing or out-of-range value opens at 1 — never off-screen', () => {
    const s = store();
    expect(readPopupScale(s)).toBe(1);
    s.setItem(POPUP_SCALE_KEY, 'huge');
    expect(readPopupScale(s)).toBe(1);
    s.setItem(POPUP_SCALE_KEY, '40');
    expect(readPopupScale(s)).toBe(1);
    expect(readPopupScale(null)).toBe(1);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readPopupScale(broken)).toBe(1);
    expect(() => writePopupScale(broken, 1)).not.toThrow();
  });
});

describe('the component — source guards', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/ide/VirtualKeyboard.tsx'), 'utf8');
  it('the three fixed sizes are gone; a Resize toggle shows four corner handles', () => {
    expect(src).not.toContain('[0.5, 1, 2].map');
    expect(src).toContain('CORNERS.map');
    expect(src).toContain('aria-label="Resize"');
    expect(CORNERS).toEqual(['nw', 'ne', 'sw', 'se']);
  });
  it('the popup is dragged from its HEADER only, so a corner drag and a move can never fight', () => {
    expect(src).toContain('dragListener={false}');
    expect(src).toContain('dragControls.start(');
  });
  it('the ENTER button cannot leave the popup: it is a fixed square beside a shrinkable selector', () => {
    const row = src.slice(src.indexOf('Enter Button'), src.indexOf('Enter Button') + 900);
    expect(row).toContain('shrink-0');
    expect(row).toContain('w-14');
    expect(row).not.toContain('px-8');
    expect(src).toContain('className="relative flex-1 min-w-0"');
  });
  it('a pinch is only captured while resizing, so the shortcut list still scrolls normally', () => {
    expect(src).toMatch(/touchAction:\s*resizing\s*\?\s*'none'\s*:\s*'auto'/);
  });
});
