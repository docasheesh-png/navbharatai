// P-UX.2 — Reusable skeleton (shimmer placeholder) primitives.
//
// A global Suspense spinner already covers route-level loading; these fill the per-component gap so
// list/card/tree views show a content-shaped shimmer (perceived-faster load) instead of a blank area
// or a lone spinner. Pure presentational + Tailwind only — no state, no deps, additive everywhere it
// is used. `aria-hidden` so screen readers skip the decorative placeholder.

import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  /** Tailwind rounding class (default rounded-md). */
  rounded?: string;
}

/** A single shimmer block. Size it with Tailwind height/width classes via `className`. */
export function Skeleton({ className = '', style, rounded = 'rounded-md' }: SkeletonProps) {
  return <div aria-hidden="true" className={`animate-pulse bg-white/10 ${rounded} ${className}`} style={style} />;
}

/** A multi-line text shimmer; the last line is shorter to mimic real paragraph text. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** A card-row shimmer: icon block + two text lines. Used for history/template/list items. */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`border border-white/5 bg-white/[0.02] rounded-xl p-4 ${className}`} aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0" rounded="rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

/** A vertical list of card shimmers (e.g. the chat-history list while it loads). */
export function SkeletonList({ count = 5, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** A grid of card shimmers (e.g. template cards while they load). */
export function SkeletonGrid({ count = 6, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-white/5 bg-white/[0.02] rounded-xl p-4 space-y-3">
          <Skeleton className="h-24 w-full" rounded="rounded-lg" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** A file-tree shimmer: rows with an icon + indented label of varying width. */
export function SkeletonTree({ rows = 8, className = '' }: { rows?: number; className?: string }) {
  const widths = ['w-2/3', 'w-1/2', 'w-3/5', 'w-1/3', 'w-3/4', 'w-2/5'];
  return (
    <div className={`space-y-2 px-2 py-1 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2" style={{ paddingLeft: (i % 3) * 12 }}>
          <Skeleton className="h-3.5 w-3.5 shrink-0" rounded="rounded" />
          <Skeleton className={`h-3 ${widths[i % widths.length]}`} />
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
