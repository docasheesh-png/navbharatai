/**
 * Where the ⓘ popover goes, as a pure function (admin 2026-09-18: "popup crop ho raha hai").
 *
 * 🔴 THE CROP, AND WHY IT COULD NOT BE FIXED WITH A WIDTH. The panel used to be
 * `absolute top-full right-0` inside the row, and BOTH admin report lists wrap every row in
 * `border rounded-xl overflow-hidden` — a box exactly one row tall. An absolutely positioned
 * descendant is clipped by any `overflow: hidden` ancestor in its containing-block chain, so a
 * panel laid out ENTIRELY BELOW the row was cut off by construction, every time, on every screen.
 * The all-builds list adds a second clipper on top (`max-h-[28rem] overflow-y-auto`, which makes
 * `overflow-x` compute to `auto` as well), and the row itself can overflow its card on a phone,
 * carrying the button — and therefore the panel anchored to it — past the right edge.
 *
 * So the panel is now PORTALLED to <body> and positioned `fixed` from the button's own rect. That
 * kills the class rather than the instance: it is correct however many scroll or `overflow-hidden`
 * ancestors a future list puts between the row and the page, and it needs no cooperation from them.
 *
 * This module is the placement arithmetic alone, so it can be tested without a browser.
 */

/** 18rem — the same cap the panel has always had; a wider card reads as a dialog, not a hint. */
export const PANEL_MAX_WIDTH = 288;
/** Kept clear of every viewport edge, so the panel never looks cut even when it is fully drawn. */
export const VIEWPORT_GUTTER = 8;
/** The breathing space between the button and its panel. */
export const ANCHOR_GAP = 6;
/** Below this the space is too small to be worth using, so the panel looks for room above instead. */
export const MIN_USEFUL_HEIGHT = 160;
/** A panel is never given less than this, even on a viewport with no good room anywhere. */
export const MIN_PANEL_HEIGHT = 96;

export interface AnchorRect {
  readonly top: number;
  readonly bottom: number;
  readonly right: number;
}

export type PanelPlacement =
  | { left: number; width: number; maxHeight: number; top: number; bottom?: undefined }
  | { left: number; width: number; maxHeight: number; bottom: number; top?: undefined };

/**
 * Place the panel from the anchor's viewport rect.
 *
 * ⚠️ The anchor's rect may be partly or wholly OFF-SCREEN — that is the case this exists for, since
 * a row that overflows its card carries the button out with it. So the horizontal result is clamped
 * to the viewport rather than merely right-aligned: right-alignment alone reproduces the bug.
 */
export function placeReportInfoPanel(anchor: AnchorRect, viewportWidth: number, viewportHeight: number): PanelPlacement {
  const width = Math.max(1, Math.min(PANEL_MAX_WIDTH, viewportWidth - VIEWPORT_GUTTER * 2));
  // Right-aligned to the button when there is room, then pulled back inside both gutters. The
  // Math.max on the upper bound keeps a viewport narrower than the panel from inverting the clamp.
  const rightAligned = anchor.right - width;
  const furthestLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER);
  const left = Math.min(Math.max(rightAligned, VIEWPORT_GUTTER), furthestLeft);

  const roomBelow = viewportHeight - anchor.bottom - ANCHOR_GAP - VIEWPORT_GUTTER;
  const roomAbove = anchor.top - ANCHOR_GAP - VIEWPORT_GUTTER;
  // Flip up only when below is genuinely cramped AND above is roomier — never into a smaller space.
  const flip = roomBelow < MIN_USEFUL_HEIGHT && roomAbove > roomBelow;

  return flip
    ? { left, width, bottom: viewportHeight - anchor.top + ANCHOR_GAP, maxHeight: Math.max(MIN_PANEL_HEIGHT, roomAbove) }
    : { left, width, top: anchor.bottom + ANCHOR_GAP, maxHeight: Math.max(MIN_PANEL_HEIGHT, roomBelow) };
}
