// Resizing and cropping a picture AFTER it was made — into any frame, with black where the picture
// does not reach (admin-asked 2026-09-21: "image generate ho jane ke bad image ka size badalne / crop
// karne ka option do … agar user image ko frame se chota kar de, to bahat kala background a jaye").
//
// 🔑 TWO DIFFERENT THINGS, TWO MODES, AND THE USER PICKS WHICH. "Resize" STRETCHES the picture to
// the new frame — a 1024×1024 logo pulled to 1280×720 — because that is what "make it 16:9" means
// for a flat graphic. "Crop" never stretches: the picture keeps its own proportions, is made bigger
// or smaller and moved about, and whatever part of the frame it does not cover is BLACK. Nothing is
// guessed about which the user meant; the toggle says.
//
// ⚠️ THIS IS DELIBERATELY THE OPPOSITE OF `imageCrop.ts`, AND THE TWO MUST NOT BE MERGED. That
// module arranges a picture the user ATTACHED so that it always COVERS the frame (zoom floor 1) —
// a band of black there would look like our engine broke. Here the user is editing a finished
// picture and asked, in those words, for the black band. One rule per job; the floor is the whole
// difference.
//
// 🔒 PURE GEOMETRY. No canvas, no DOM. The component draws; this decides where.

import { coverScale, type Box } from './imageCrop';

export type ResizeMode = 'crop' | 'stretch';

/** How the picture sits inside the frame in Crop mode. Offsets are in FRAME pixels. */
export interface FreeView {
  /** 1 = the picture exactly covers the frame. Below 1 it is smaller than the frame (black shows). */
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** Well below 1 — a picture may sit small in the middle of a black frame; that was the ask. */
export const FREE_MIN_ZOOM = 0.25;
export const FREE_MAX_ZOOM = 4;
export const FREE_ZOOM_STEP = 0.1;

export const FREE_IDENTITY: FreeView = { zoom: 1, offsetX: 0, offsetY: 0 };

/** The colour behind the picture. Black by the admin's own words; one constant, both readers. */
export const RESIZE_BACKGROUND = '#000000';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  const c = Math.min(hi, Math.max(lo, n));
  return c === 0 ? 0 : c; // -0 → 0, so equal arrangements compare equal
}

/** The zoom at which the whole picture just FITS inside the frame (letterboxed) — "show it all". */
export function fitZoom(img: Box, frame: Box): number {
  if (!(img.w > 0) || !(img.h > 0) || !(frame.w > 0) || !(frame.h > 0)) return 1;
  const contain = Math.min(frame.w / img.w, frame.h / img.h);
  // Not rounded: a rounded zoom leaves a 3px sliver of black beside a picture that was meant to
  // fit exactly, and "the whole picture, exactly" is what this button promises.
  return clamp(contain / coverScale(img, frame), FREE_MIN_ZOOM, FREE_MAX_ZOOM);
}

/**
 * Keep the picture INSIDE the frame when it is smaller, and the frame INSIDE the picture when it
 * is bigger — the same slack, `|drawn − frame| / 2`, in both cases. A picture may be small and
 * centred with black all round; it may not be dragged half out of the frame, which is never what a
 * finger meant.
 *
 * PURE.
 */
export function clampFreeView(view: FreeView, img: Box, frame: Box): FreeView {
  const zoom = clamp(num(view.zoom) || 1, FREE_MIN_ZOOM, FREE_MAX_ZOOM);
  const scale = coverScale(img, frame) * zoom;
  const slackX = Math.abs(img.w * scale - frame.w) / 2;
  const slackY = Math.abs(img.h * scale - frame.h) / 2;
  return {
    zoom,
    offsetX: clamp(num(view.offsetX), -slackX, slackX),
    offsetY: clamp(num(view.offsetY), -slackY, slackY),
  };
}

/** One press of + or −, bounded and re-clamped. Pure. */
export function freeZoomBy(view: FreeView, direction: 1 | -1, img: Box, frame: Box): FreeView {
  return clampFreeView({ ...view, zoom: round2(view.zoom + direction * FREE_ZOOM_STEP) }, img, frame);
}

/**
 * Where to draw, in frame coordinates. In Crop mode the picture keeps its proportions; in Stretch
 * mode it is the whole frame, whatever its shape was. Pure.
 */
export function freeDrawRect(
  mode: ResizeMode,
  view: FreeView,
  img: Box,
  frame: Box,
): { dx: number; dy: number; dw: number; dh: number } {
  if (mode === 'stretch') return { dx: 0, dy: 0, dw: frame.w, dh: frame.h };
  const v = clampFreeView(view, img, frame);
  const scale = coverScale(img, frame) * v.zoom;
  const dw = img.w * scale;
  const dh = img.h * scale;
  return { dx: (frame.w - dw) / 2 + v.offsetX, dy: (frame.h - dh) / 2 + v.offsetY, dw, dh };
}

/** True when black will be visible somewhere in the output — said on screen, never a surprise. */
export function showsBackground(mode: ResizeMode, view: FreeView, img: Box, frame: Box): boolean {
  if (mode === 'stretch') return false;
  const r = freeDrawRect(mode, view, img, frame);
  const eps = 0.5;
  return r.dx > eps || r.dy > eps || r.dx + r.dw < frame.w - eps || r.dy + r.dh < frame.h - eps;
}

export function isFreeIdentity(view: FreeView): boolean {
  return view.zoom === 1 && view.offsetX === 0 && view.offsetY === 0;
}
