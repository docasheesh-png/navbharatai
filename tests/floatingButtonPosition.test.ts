/**
 * Where the floating admin copy button is allowed to sit (admin 2026-09-14).
 *
 * The two cases that actually strand a floating button are both here: a stored position replayed on a
 * SMALLER screen (park it bottom-right on a laptop, open the panel on a phone) and a rotation. Both
 * end with the button partly or wholly off the edge, and on a touch screen there is then no way to
 * drag it back — so the clamp is the feature, not a guard.
 */
import { describe, it, expect } from 'vitest';
import {
  clampPosition, defaultPosition, isTap, parsePosition, serializePosition,
  EDGE_MARGIN, TAP_SLOP_PX, TAP_MAX_MS,
} from '../src/lib/floatingButtonPosition';

const size = { width: 56, height: 56 };

describe('clampPosition', () => {
  it('leaves a position that already fits alone', () => {
    expect(clampPosition({ x: 100, y: 200 }, size, { width: 400, height: 800 })).toEqual({ x: 100, y: 200 });
  });

  it('pulls it back from the right and bottom edges', () => {
    const p = clampPosition({ x: 9999, y: 9999 }, size, { width: 400, height: 800 });
    expect(p.x).toBe(400 - 56 - EDGE_MARGIN);
    expect(p.y).toBe(800 - 56 - EDGE_MARGIN);
  });

  it('pulls it back from the top and left edges', () => {
    expect(clampPosition({ x: -500, y: -500 }, size, { width: 400, height: 800 })).toEqual({ x: EDGE_MARGIN, y: EDGE_MARGIN });
  });

  it('rescues a laptop position replayed on a phone', () => {
    const laptop = clampPosition({ x: 1800, y: 900 }, size, { width: 1920, height: 1080 });
    const phone = clampPosition(laptop, size, { width: 360, height: 640 });
    expect(phone.x + size.width).toBeLessThanOrEqual(360);
    expect(phone.y + size.height).toBeLessThanOrEqual(640);
  });

  it('survives a rotation', () => {
    const portrait = clampPosition({ x: 300, y: 800 }, size, { width: 412, height: 915 });
    const landscape = clampPosition(portrait, size, { width: 915, height: 412 });
    expect(landscape.y + size.height).toBeLessThanOrEqual(412);
  });

  it('keeps the LEFT edge reachable on a screen too narrow for the button plus its margins', () => {
    // The two bounds cross here. The low edge must win, or the button lands half off the left side —
    // the one edge a finger cannot drag it back from.
    const p = clampPosition({ x: 0, y: 0 }, { width: 56, height: 56 }, { width: 60, height: 60 });
    expect(p.x).toBe(EDGE_MARGIN);
    expect(p.y).toBe(EDGE_MARGIN);
  });

  it('never returns NaN for a broken input', () => {
    const p = clampPosition({ x: NaN, y: Infinity }, { width: NaN, height: 0 }, { width: 0, height: NaN });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe('defaultPosition', () => {
  it('starts bottom-right and inside the screen', () => {
    const p = defaultPosition(size, { width: 412, height: 915 });
    expect(p.x + size.width).toBeLessThanOrEqual(412);
    expect(p.y + size.height).toBeLessThanOrEqual(915);
    expect(p.x).toBeGreaterThan(412 / 2);
  });

  it('stays on screen even on a tiny viewport', () => {
    const p = defaultPosition(size, { width: 200, height: 200 });
    expect(p.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(p.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });
});

describe('isTap', () => {
  it('counts a still pointer as a press', () => {
    expect(isTap(0, 0, 120)).toBe(true);
  });

  it('counts a slow but still press as a press — a held finger is still a press', () => {
    expect(isTap(2, 2, TAP_MAX_MS - 1)).toBe(true);
  });

  it('does not fire a copy at the end of a drag', () => {
    expect(isTap(TAP_SLOP_PX + 5, 0, 200)).toBe(false);
    expect(isTap(0, 40, 200)).toBe(false);
  });

  it('measures the diagonal, not each axis on its own', () => {
    // 6 and 6 are each under the slop; together they are 8.49px of real movement.
    expect(isTap(6, 6, 100)).toBe(false);
  });

  it('ignores a pointer held and forgotten', () => {
    expect(isTap(0, 0, TAP_MAX_MS + 1)).toBe(false);
  });

  it('treats broken numbers as no movement rather than throwing', () => {
    expect(isTap(NaN, NaN, NaN)).toBe(true);
  });
});

describe('parsePosition / serializePosition', () => {
  it('round-trips a position', () => {
    expect(parsePosition(serializePosition({ x: 12.6, y: 40.2 }))).toEqual({ x: 13, y: 40 });
  });

  it.each([null, undefined, '', 'not json', '{}', '[]', '{"x":"a","y":1}', 'null'])('rejects %p', (raw) => {
    expect(parsePosition(raw as string | null | undefined)).toBeNull();
  });
});
