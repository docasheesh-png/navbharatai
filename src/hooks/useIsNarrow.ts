import { useEffect, useState } from 'react';

// Several builder tools are laid out as two or three fixed-width panels side by side — 220px + 300px
// in the Component Library, 220px + 280px in the Multi-Page Builder. On a 360px phone that leaves
// nothing for the content between them. Tailwind classes fix that where the markup uses classes, but
// these tools are written with inline styles, and an inline style cannot carry a media query.
//
// So they need to know the width in JavaScript. This is that one shared answer, rather than a
// resize listener re-invented per tool.

/** The width below which a side-by-side panel layout stops being usable. Matches Tailwind's `md`. */
export const NARROW_BREAKPOINT = 768;

/**
 * True while the viewport is too narrow for side-by-side panels.
 *
 * Uses matchMedia rather than a resize handler so it fires once per crossing instead of on every
 * pixel, and it is guarded for environments with no window (tests, SSR) where it reports false.
 */
export function useIsNarrow(breakpoint: number = NARROW_BREAKPOINT): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mq.matches);
    // addListener is the deprecated form, kept for older WebViews the Android app may run in.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [breakpoint]);

  return narrow;
}
