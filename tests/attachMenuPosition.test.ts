import { describe, expect, it } from 'vitest';
import { attachMenuPosition } from '../src/lib/attachMenuPosition';

describe('attachment menu viewport placement', () => {
  it('fits above the phone composer instead of beneath the fixed footer', () => {
    const p = attachMenuPosition({ top: 700, bottom: 742, left: 12 }, { top: 0, left: 0, width: 393, height: 852 }, 280);
    expect(p.top + 280).toBeLessThan(700);
    expect(p.left + p.width).toBeLessThanOrEqual(385);
  });
  it('constrains height when the keyboard shrinks the visible viewport', () => {
    const p = attachMenuPosition({ top: 330, bottom: 372, left: 10 }, { top: 0, left: 0, width: 393, height: 390 }, 360);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.maxHeight).toBe(314);
  });
  it('handles zoom offsets, landscape and right-edge triggers', () => {
    const p = attachMenuPosition({ top: 320, bottom: 350, left: 800 }, { top: 100, left: 50, width: 700, height: 270 }, 400);
    expect(p.left + p.width).toBeLessThanOrEqual(742);
    expect(p.top).toBeGreaterThanOrEqual(108);
    expect(p.maxHeight).toBe(204);
  });
  it('opens below a trigger near the top', () => {
    const p = attachMenuPosition({ top: 12, bottom: 42, left: 0 }, { top: 0, left: 0, width: 1024, height: 768 }, 250);
    expect(p.top).toBe(50);
    expect(p.width).toBe(300);
  });
});
