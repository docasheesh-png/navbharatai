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
