// Responsive-preview viewport model (admin 2026-07-17). Pure + dependency-free so the sizing math is
// unit-testable without pulling in the React preview surface (which imports the whole App tree).
//
// The point of these modes is a REAL responsive preview: an <iframe>'s content viewport equals the
// iframe element's own width, so constraining that width to a device size makes the built app's OWN
// `@media (max-width: …)` rules match exactly as they would on that device — not a cosmetic label.

export type PreviewViewport = 'auto' | 'mobile' | 'tablet' | 'desktop';

/** Real device viewport dimensions (CSS px) — standard testing sizes (iPhone / iPad / laptop). */
export const DEVICE_DIMS: Record<Exclude<PreviewViewport, 'auto'>, { w: number; h: number; label: string }> = {
  mobile: { w: 390, h: 844, label: 'Mobile · 390 × 844' },
  tablet: { w: 768, h: 1024, label: 'Tablet · 768 × 1024' },
  desktop: { w: 1280, h: 800, label: 'Desktop · 1280 × 800' },
};

/**
 * Scale a fixed device box to fit the available area, NEVER upscaling past 1:1 (a device smaller than
 * the panel renders at true size; a larger one shrinks to fit). Returns 1 for degenerate inputs so the
 * box is simply shown at full size (and clipped by its scroll container). PURE.
 */
export function computeDeviceScale(availW: number, availH: number, devW: number, devH: number): number {
  if (devW <= 0 || devH <= 0) return 1;
  const s = Math.min(availW / devW, availH / devH, 1);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/**
 * Manual zoom for a device viewport (gap analysis 2026-09-10).
 *
 * 'fit' is the original behaviour: shrink the device box until it fits the panel, never past 1:1. The
 * fixed steps exist because fitting a 1280px desktop into a 500px split makes every measurement a
 * lie — text looks smaller than it is and spacing looks tighter, which is exactly what the user came
 * to check. At 100% the box overflows and scrolls, and what they see is the real thing.
 */
export type PreviewZoom = 'fit' | '1' | '0.75' | '0.5';

export const ZOOM_ORDER: readonly PreviewZoom[] = ['fit', '1', '0.75', '0.5'];

/** The next zoom in the cycle — one button rather than four, since the panel row is already full. */
export function nextZoom(current: PreviewZoom): PreviewZoom {
  const i = ZOOM_ORDER.indexOf(current);
  return ZOOM_ORDER[(i < 0 ? 0 : i + 1) % ZOOM_ORDER.length];
}

/** Short label for the button face. 'fit' says "Fit" rather than a percentage, because it is not one. */
export function zoomLabel(z: PreviewZoom): string {
  return z === 'fit' ? 'Fit' : `${Math.round(Number(z) * 100)}%`;
}

/**
 * The scale actually applied to the device box. PURE.
 *
 * 'fit' defers to computeDeviceScale (which never upscales past 1:1); an explicit step is used as
 * given, INCLUDING when it is larger than the panel — overflowing and scrolling is the point.
 */
export function resolveZoomScale(zoom: PreviewZoom, availW: number, availH: number, devW: number, devH: number): number {
  if (zoom === 'fit') return computeDeviceScale(availW, availH, devW, devH);
  const n = Number(zoom);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
