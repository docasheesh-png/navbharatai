// P-DESIGN.1 — Tooltip primitive: a lightweight, dependency-free hover/focus tooltip. CSS-only
// reveal (group-hover / focus-within) so there is no portal or timer to leak; accessible via the
// wrapped control's own focus. Keep labels short.

import React from 'react';
import { cn } from '../../lib/utils';

export interface TooltipProps {
  /** The tooltip text. */
  label: React.ReactNode;
  children: React.ReactNode;
  /** Placement (default top). */
  side?: 'top' | 'bottom';
  className?: string;
}

export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  return (
    <span className={cn('relative inline-flex group', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 whitespace-nowrap rounded-md',
          'bg-zinc-800 text-white text-[11px] px-2 py-1 shadow-lg border border-white/10',
          'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export default Tooltip;
