// Cropping and resizing the user's OWN picture, before anything is sent anywhere
// (admin-asked 2026-09-21: "user kisi image ko apne hisab ke size me crop kar sake, image ko size se
// chota bada bhi kiya ja sake, +/0/- button add karna").
//
// 🔑 THE FRAME IS THE SIZE THEY CHOSE. The picker already knows the exact pixels a request will be
// made at — a preset, or their own width and height — so the crop frame IS that shape. What the user
// arranges inside it is literally what the engine receives, which is the only version of "crop" that
// cannot surprise them later.
//
// 🔒 PURE GEOMETRY. No canvas, no DOM, no File — the component does the drawing, this decides where.
// That split is what lets the rule be tested at all: a canvas snapshot proves nothing about whether
// a picture was allowed to slide off its own frame.

/** How the picture is currently arranged inside the frame. Offsets are in FRAME pixels. */
export interface CropView {
  /** 1 = the picture exactly covers the frame. Above 1 it is enlarged and part of it is outside. */
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** One press of + or −. Big enough to see, small enough to aim with. */
export const ZOOM_STEP = 0.2;

/** What the ⟲ button returns to: the whole picture, centred, filling the frame exactly. */
export const IDENTITY_VIEW: CropView = { zoom: 1, offsetX: 0, offsetY: 0 };

export interface Box { w: number; h: number }

/** The scale at which the picture just covers the frame — the zoom-1 baseline. */
export function coverScale(img: Box, frame: Box): number {
  if (!(img.w > 0) || !(img.h > 0) || !(frame.w > 0) || !(frame.h > 0)) return 1;
  return Math.max(frame.w / img.w, frame.h / img.h);
}

/** One press of + (`1`) or − (`-1`), bounded. Pure. */
export function zoomBy(view: CropView, direction: 1 | -1, img?: Box, frame?: Box): CropView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, round2(view.zoom + direction * ZOOM_STEP)));
  const next = { ...view, zoom };
  return img && frame ? clampView(next, img, frame) : next;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Keep the picture covering the frame.
 *
 * ⚠️ THIS IS THE WHOLE SAFETY RULE, and without it the feature quietly produces a picture with a
 * transparent or black band down one side — a result that looks like a bug in our engine rather than
 * a drag that went too far. At zoom 1 there is nothing to slide, so both offsets are pinned to 0.
 *
 * PURE.
 */
export function clampView(view: CropView, img: Box, frame: Box): CropView {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const scale = coverScale(img, frame) * zoom;
  const drawnW = img.w * scale;
  const drawnH = img.h * scale;
  // How far the centre may move before an edge of the picture comes inside the frame.
  const slackX = Math.max(0, (drawnW - frame.w) / 2);
  const slackY = Math.max(0, (drawnH - frame.h) / 2);
  return {
    zoom,
    offsetX: clamp(num(view.offsetX), -slackX, slackX),
    offsetY: clamp(num(view.offsetY), -slackY, slackY),
  };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  const c = Math.min(hi, Math.max(lo, n));
  // Normalise -0 to 0: at zoom 1 the slack is 0, so clamping a leftward drag yields -0, and two
  // views that are the same arrangement would then compare as different.
  return c === 0 ? 0 : c;
}

/** Where to draw the picture inside the frame, in frame coordinates. Pure. */
export function drawRect(
  view: CropView,
  img: Box,
  frame: Box,
): { dx: number; dy: number; dw: number; dh: number } {
  const v = clampView(view, img, frame);
  const scale = coverScale(img, frame) * v.zoom;
  const dw = img.w * scale;
  const dh = img.h * scale;
  return {
    dx: (frame.w - dw) / 2 + v.offsetX,
    dy: (frame.h - dh) / 2 + v.offsetY,
    dw,
    dh,
  };
}

/** True when the view is exactly the reset one — what greys out the ⟲ button honestly. */
export function isIdentityView(view: CropView): boolean {
  return view.zoom === IDENTITY_VIEW.zoom && view.offsetX === 0 && view.offsetY === 0;
}

/**
 * Scale a drag in SCREEN pixels into the frame's own pixels.
 *
 * The frame is drawn at whatever size fits the phone, and the crop happens at the request's real
 * pixel size — a 40px thumb drag across a 320px preview of a 1024px frame must move the picture
 * 128 frame-pixels, not 40, or dragging feels stuck on a large size and skittish on a small one.
 *
 * PURE.
 */
export function dragToFrame(deltaPx: number, previewPx: number, framePx: number): number {
  if (!(previewPx > 0)) return 0;
  return (deltaPx * framePx) / previewPx;
}
