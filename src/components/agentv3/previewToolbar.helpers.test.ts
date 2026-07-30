import { describe, it, expect } from 'vitest';
import { veIsBold, veFontPx, veRgbToHex } from './PreviewSurface';

describe('Visual Editor toolbar helpers', () => {
  it('veIsBold — bold keyword or numeric weight >= 600', () => {
    expect(veIsBold({ fontWeight: 'bold' })).toBe(true);
    expect(veIsBold({ fontWeight: '700' })).toBe(true);
    expect(veIsBold({ fontWeight: '600' })).toBe(true);
    expect(veIsBold({ fontWeight: '400' })).toBe(false);
    expect(veIsBold({ fontWeight: 'normal' })).toBe(false);
    expect(veIsBold({})).toBe(false);
  });
  it('veFontPx — parses px, defaults to 16', () => {
    expect(veFontPx({ fontSize: '18px' })).toBe(18);
    expect(veFontPx({ fontSize: '13.5px' })).toBe(13.5);
    expect(veFontPx({})).toBe(16);
    expect(veFontPx({ fontSize: 'abc' })).toBe(16);
  });
  it('veRgbToHex — rgb/rgba → #rrggbb, else #000000', () => {
    expect(veRgbToHex('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(veRgbToHex('rgba(0, 128, 255, 0.5)')).toBe('#0080ff');
    expect(veRgbToHex('')).toBe('#000000');
    expect(veRgbToHex('blue')).toBe('#000000');
  });
});
