/**
 * BRAND ICONS — GitHub and Figma, owned by this app instead of by the icon library.
 *
 * WHY THIS FILE EXISTS. lucide-react 1.x REMOVED every brand mark: `Github` and `Figma` are gone from
 * the package entirely — not renamed, not moved to a subpath, absent from the runtime bundle AND from
 * all three type-declaration files. Verified against the real 1.34.0 tarball, not inferred.
 *
 * 🔴 AND THE TYPECHECK DOES NOT CATCH IT. lucide-react ships no `types` field and no `exports` map, so
 * `import { Github } from 'lucide-react'` type-resolves loosely and compiles clean while evaluating to
 * `undefined` at runtime — and `<Github />` on an undefined component is a React "Element type is
 * invalid" CRASH, not a missing glyph. The upgrade would have taken down the sign-in screen, Settings,
 * the Git panel and the v5 builder panel, and the whole suite caught it in exactly ONE place
 * (`homeToolGroups.test.ts`, which asserts every tool has an icon). That is why these two are vendored
 * here rather than swapped for lookalikes: an app should not be able to lose its sign-in button to
 * someone else's release.
 *
 * The path data is lucide's own, copied verbatim from lucide-react 0.546.0 (ISC licensed, retained
 * below), so these render pixel-identically to what shipped before — nothing was redrawn from memory.
 * The props mirror a lucide icon (`size`, `className`, plus any SVG prop), so call sites are unchanged.
 *
 * lucide-react v0.546.0 — ISC License, Copyright (c) for portions of Lucide are held by Cole Bemis
 * 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
 * Contributors 2022.
 */

import type { SVGProps } from 'react';

export interface BrandIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Matches lucide's `size` prop: sets both width and height. Ignored when a className sizes it. */
  size?: number | string;
}

/** lucide's default presentation, so a vendored icon sits beside a library one without looking different. */
function svgProps(size: number | string) {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

export function Github({ size = 24, ...rest }: BrandIconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

export function Figma({ size = 24, ...rest }: BrandIconProps) {
  return (
    <svg {...svgProps(size)} {...rest}>
      <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" />
      <path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z" />
      <path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z" />
      <path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" />
      <path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" />
    </svg>
  );
}
