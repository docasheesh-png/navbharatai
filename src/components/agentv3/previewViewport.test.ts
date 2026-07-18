import { describe, it, expect } from 'vitest';
import { DEVICE_DIMS, computeDeviceScale, type PreviewViewport } from './previewViewport';

describe('DEVICE_DIMS — real device viewport sizes', () => {
  it('exposes mobile / tablet / desktop at standard testing widths', () => {
    expect(DEVICE_DIMS.mobile.w).toBe(390);
    expect(DEVICE_DIMS.tablet.w).toBe(768);
    expect(DEVICE_DIMS.desktop.w).toBe(1280);
    // widths are strictly ordered so each mode is a genuinely different viewport (real breakpoint change)
    expect(DEVICE_DIMS.mobile.w).toBeLessThan(DEVICE_DIMS.tablet.w);
    expect(DEVICE_DIMS.tablet.w).toBeLessThan(DEVICE_DIMS.desktop.w);
  });

  it('every device carries a human label with its dimensions', () => {
    for (const d of Object.values(DEVICE_DIMS)) {
      expect(d.label).toMatch(/\d+\s*×\s*\d+/);
      expect(d.h).toBeGreaterThan(0);
    }
  });
});

describe('computeDeviceScale — fit-to-panel without upscaling', () => {
  it('returns 1 when the device fits inside the available area (never magnifies)', () => {
    // panel bigger than a 390×844 phone → show it at true 1:1
    expect(computeDeviceScale(1200, 1000, 390, 844)).toBe(1);
  });

  it('shrinks by the WIDTH constraint when the panel is too narrow', () => {
    // 300px-wide panel, 390px device → 300/390
    expect(computeDeviceScale(300, 2000, 390, 844)).toBeCloseTo(300 / 390, 5);
  });

  it('shrinks by the HEIGHT constraint when the panel is too short', () => {
    // plenty of width, only 422px tall vs an 844px device → 422/844 = 0.5
    expect(computeDeviceScale(2000, 422, 390, 844)).toBeCloseTo(0.5, 5);
  });

  it('uses the SMALLER of the two constraints (the box must fit both axes)', () => {
    // width would allow 0.9, height only 0.5 → 0.5 wins
    const s = computeDeviceScale(390 * 0.9, 844 * 0.5, 390, 844);
    expect(s).toBeCloseTo(0.5, 5);
  });

  it('a wide desktop viewport in a phone-narrow panel scales down a lot but stays > 0', () => {
    const s = computeDeviceScale(360, 1200, DEVICE_DIMS.desktop.w, DEVICE_DIMS.desktop.h);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeCloseTo(360 / 1280, 5);
  });

  it('returns a safe 1 for degenerate inputs (never NaN / Infinity / 0)', () => {
    // zero available area → 0/390 = 0 → not > 0 → falls back to a safe 1 (box shown full size, scroller clips)
    expect(computeDeviceScale(0, 0, 390, 844)).toBe(1);
    expect(computeDeviceScale(500, 500, 0, 844)).toBe(1);
    expect(computeDeviceScale(500, 500, 390, 0)).toBe(1);
    expect(computeDeviceScale(-100, -100, 390, 844)).toBe(1);
    expect(Number.isFinite(computeDeviceScale(500, 500, 390, 844))).toBe(true);
  });
});

describe('PreviewViewport type wiring', () => {
  it('auto is a valid viewport that is NOT in DEVICE_DIMS (it fills the panel instead)', () => {
    const modes: PreviewViewport[] = ['auto', 'mobile', 'tablet', 'desktop'];
    expect(modes).toContain('auto');
    expect(Object.keys(DEVICE_DIMS)).not.toContain('auto');
    expect(Object.keys(DEVICE_DIMS).sort()).toEqual(['desktop', 'mobile', 'tablet']);
  });
});
