import { describe, it, expect } from 'vitest';
import { niceMax, barLayout, linePoints, donutSegments } from './chartGeometry';

/** P-DESIGN.4 — pure chart geometry: axis bounds, bar layout, line points, donut segments. */

describe('niceMax', () => {
  it('rounds up to a nice 1/2/5 × 10ⁿ bound', () => {
    expect(niceMax(1)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(50);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });
});

describe('barLayout', () => {
  it('places bars within the area, tallest = full height at max', () => {
    const bars = barLayout([1, 2, 4], { width: 300, height: 100, gapRatio: 0, max: 4 });
    expect(bars).toHaveLength(3);
    expect(bars[2].height).toBeCloseTo(100); // 4/4 * 100
    expect(bars[0].height).toBeCloseTo(25); // 1/4 * 100
    // y is measured from the top: taller bar → smaller y
    expect(bars[2].y).toBeCloseTo(0);
    expect(bars[0].y).toBeCloseTo(75);
    // bars span the full width when gapRatio=0
    expect(bars[0].width).toBeCloseTo(100);
  });
  it('is safe on empty / zero-size input', () => {
    expect(barLayout([], { width: 100, height: 100 })).toEqual([]);
    expect(barLayout([1, 2], { width: 0, height: 100 })).toEqual([]);
  });
});

describe('linePoints', () => {
  it('produces one point per value spanning the width', () => {
    const pts = linePoints([0, 5, 10], { width: 200, height: 100, max: 10 });
    const coords = pts.split(' ');
    expect(coords).toHaveLength(3);
    expect(coords[0]).toBe('0,100'); // value 0 → bottom
    expect(coords[2]).toBe('200,0'); // value 10 (max) → top-right
  });
  it('centers a single value and is empty for none', () => {
    expect(linePoints([5], { width: 100, height: 50 })).toBe('50,0');
    expect(linePoints([], { width: 100, height: 50 })).toBe('');
  });
});

describe('donutSegments', () => {
  it('splits proportionally head-to-tail (normalised to 100)', () => {
    const segs = donutSegments([3, 1], 100);
    expect(segs[0].length).toBeCloseTo(75);
    expect(segs[1].length).toBeCloseTo(25);
    expect(segs[0].offset).toBe(0);
    expect(segs[1].offset).toBeCloseTo(-75); // placed after the first
    expect(segs[0].fraction).toBeCloseTo(0.75);
  });
  it('handles all-zero without dividing by zero', () => {
    const segs = donutSegments([0, 0]);
    expect(segs.every((s) => s.length === 0)).toBe(true);
  });
});
