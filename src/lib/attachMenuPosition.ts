/** Viewport coordinates for a portalled attachment menu, including mobile keyboards/zoom. */
export function attachMenuPosition(
  anchor: { top: number; bottom: number; left: number },
  viewport: { top: number; left: number; width: number; height: number },
  contentHeight: number,
): { left: number; top: number; width: number; maxHeight: number } {
  const gap = 8;
  const leftEdge = viewport.left + gap;
  const topEdge = viewport.top + gap;
  const bottomEdge = viewport.top + viewport.height - gap;
  const width = Math.max(0, Math.min(viewport.width - gap * 2, viewport.width < 640 ? 420 : 300));
  const left = Math.max(leftEdge, Math.min(anchor.left, viewport.left + viewport.width - gap - width));
  const above = Math.max(0, Math.min(bottomEdge, anchor.top - gap) - topEdge);
  const below = Math.max(0, bottomEdge - Math.max(topEdge, anchor.bottom + gap));
  // Prefer above the composer: the footer sits below it. On a short/zoomed viewport
  // use whichever side has room, and scroll rather than letting content get cropped.
  const useAbove = above >= Math.min(contentHeight, 200) || above >= below;
  const maxHeight = useAbove ? above : below;
  const height = Math.min(Math.max(0, contentHeight), maxHeight);
  const top = useAbove ? Math.max(topEdge, Math.min(bottomEdge, anchor.top - gap) - height)
    : Math.min(bottomEdge, Math.max(topEdge, anchor.bottom + gap));
  return { left, top, width, maxHeight };
}
