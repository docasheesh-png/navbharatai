/**
 * RESIZING THE SHORTCUTS POPUP BY ITS CORNERS, OR BY A PINCH — the geometry, pure (admin 2026-09-24:
 * "resize button dedo, jis par click karne se is shortcut ke charo kono par kuch dot aa jaye, jisse
 * user finger se aage peeche kar ke zoom in / zoom out kar sake").
 *
 * The three fixed sizes (0.5× / 1× / 2×) are gone. What replaces them is ONE continuous scale, driven
 * by two gestures that share a single rule: the scale changes by the ratio of the pointer's distance
 * from the popup's centre now to that distance when the gesture began. For a corner drag the
 * "pointer" is the finger on the dot; for a pinch it is the gap between two fingers. Same formula, so
 * the two can never disagree about what a movement means — and a corner dot dragged outward keeps
 * that corner under the finger by construction, because the popup scales about its centre.
 *
 * Nothing here touches the DOM. The component measures its box and viewport and hands the numbers in.
 */

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/** The popup may not shrink below half nor grow past three times its natural size. */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;
/** Breathing room kept between the scaled popup and the viewport edge, per side. */
export const VIEWPORT_MARGIN = 8;

/** localStorage key of the last chosen scale — the popup opens as the user left it. */
export const POPUP_SCALE_KEY = 'ide_shortcutsPopupScale';

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The largest scale at which the popup's NATURAL box (its size at scale 1) still fits the viewport
 * with a margin. Guarantees a phone can never enlarge the popup past its own screen and lose the
 * close button off the edge. A degenerate viewport or box yields MAX_SCALE rather than NaN.
 */
export function maxScaleFor(natural: Size, viewport: Size): number {
  const w = viewport.width - 2 * VIEWPORT_MARGIN;
  const h = viewport.height - 2 * VIEWPORT_MARGIN;
  if (!(natural.width > 0) || !(natural.height > 0) || !(w > 0) || !(h > 0)) return MAX_SCALE;
  return Math.min(MAX_SCALE, w / natural.width, h / natural.height);
}

/** Clamp a scale into [MIN_SCALE, the viewport ceiling]. NaN and Infinity become 1. */
export function clampScale(scale: number, natural: Size, viewport: Size): number {
  if (!Number.isFinite(scale)) return 1;
  const ceiling = Math.max(MIN_SCALE, maxScaleFor(natural, viewport));
  return Math.min(ceiling, Math.max(MIN_SCALE, scale));
}

export interface GestureStart {
  /** Scale when the gesture began. */
  scale: number;
  /** Reference length when it began: corner-to-centre distance, or the pinch gap. */
  length: number;
}

/**
 * THE one rule. `length` is the current reference length (corner-to-centre or pinch gap).
 * A zero start length (two fingers on one point, a dot at the exact centre) cannot define a ratio
 * and returns the starting scale — never Infinity.
 */
export function scaleFromGesture(start: GestureStart, length: number, natural: Size, viewport: Size): number {
  if (!(start.length > 0)) return clampScale(start.scale, natural, viewport);
  return clampScale(start.scale * (length / start.length), natural, viewport);
}

/** Corner-to-centre reference length for a corner drag. */
export function cornerGestureStart(scale: number, pointer: Point, centre: Point): GestureStart {
  return { scale, length: distance(pointer, centre) };
}

/** Finger-gap reference length for a pinch. */
export function pinchGestureStart(scale: number, a: Point, b: Point): GestureStart {
  return { scale, length: distance(a, b) };
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The remembered scale, or 1. Anything unreadable or out of range is 1 — never a popup off-screen. */
export function readPopupScale(store: KeyValueStore | null | undefined): number {
  try {
    const n = Number(store?.getItem(POPUP_SCALE_KEY));
    return Number.isFinite(n) && n >= MIN_SCALE && n <= MAX_SCALE ? n : 1;
  } catch {
    return 1;
  }
}

export function writePopupScale(store: KeyValueStore | null | undefined, scale: number): void {
  try {
    if (Number.isFinite(scale)) store?.setItem(POPUP_SCALE_KEY, String(Math.round(scale * 1000) / 1000));
  } catch {
    /* session state stands */
  }
}

/** The four corners a handle can sit on. */
export const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
export type Corner = typeof CORNERS[number];
