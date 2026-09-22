// WHERE A DRAGGABLE FLOATING BUTTON IS ALLOWED TO SIT, AND WHEN A DRAG WAS ACTUALLY A TAP.
//
// Both questions are pure arithmetic, and both are the parts that go wrong in practice: a button
// dragged to the edge of a phone and then rotated ends up off the screen with no way to reach it, and
// a button that treats every pointer-up as a press fires on the end of a drag. Keeping them here means
// they can be tested without a browser, which is the only way the rotation case ever gets exercised.

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Viewport { width: number; height: number }

/** Breathing room from the screen edge so the button is never half under a rounded corner. */
export const EDGE_MARGIN = 12;

/** Below this much movement the pointer never really left where it started. */
export const TAP_SLOP_PX = 8;

/** A long press that did not move is still a press — this only rules out a held-and-forgotten pointer. */
export const TAP_MAX_MS = 1200;

/**
 * Keep a position inside the viewport. PURE.
 *
 * Clamps the LOW edge last on purpose: on a screen narrower than the button plus its margins the two
 * bounds cross, and applying them in the other order would park the button partly off the LEFT edge,
 * which is the one a finger cannot drag it back from.
 */
export function clampPosition(pos: Point, size: Size, view: Viewport, margin = EDGE_MARGIN): Point {
  const w = Number.isFinite(size.width) && size.width > 0 ? size.width : 0;
  const h = Number.isFinite(size.height) && size.height > 0 ? size.height : 0;
  const vw = Number.isFinite(view.width) && view.width > 0 ? view.width : 0;
  const vh = Number.isFinite(view.height) && view.height > 0 ? view.height : 0;
  const x = Number.isFinite(pos.x) ? pos.x : 0;
  const y = Number.isFinite(pos.y) ? pos.y : 0;
  return {
    x: Math.max(margin, Math.min(x, vw - w - margin)),
    y: Math.max(margin, Math.min(y, vh - h - margin)),
  };
}

/** Bottom-right, above the thumb rest. PURE. */
export function defaultPosition(size: Size, view: Viewport, margin = EDGE_MARGIN): Point {
  return clampPosition(
    { x: view.width - size.width - margin, y: view.height - size.height - margin * 6 },
    size,
    view,
    margin,
  );
}

/**
 * Top-right, under the status bar — where the Focus Mode exit button has always sat, so a user who
 * never drags it sees nothing change. PURE. `insetTop` is the safe-area top (a notch), added to the margin.
 */
export function topRightPosition(size: Size, view: Viewport, margin = EDGE_MARGIN, insetTop = 0): Point {
  const inset = Number.isFinite(insetTop) ? Math.max(0, insetTop) : 0;
  return clampPosition({ x: view.width - size.width - margin, y: margin + inset }, size, view, margin);
}

/** Was this pointer gesture a press rather than a drag? PURE. */
export function isTap(dx: number, dy: number, elapsedMs: number): boolean {
  const moved = Math.hypot(Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? dy : 0);
  const ms = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  return moved <= TAP_SLOP_PX && ms <= TAP_MAX_MS;
}

/** Read a stored position back. Returns null for anything that is not a real pair of numbers. PURE. */
export function parsePosition(raw: string | null | undefined): Point | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw) as { x?: unknown; y?: unknown } | null;
    if (!v || typeof v !== 'object') return null;
    const x = Number(v.x);
    const y = Number(v.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

export function serializePosition(pos: Point): string {
  return JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) });
}
