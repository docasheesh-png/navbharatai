// P-DESIGN.2 — Popover primitive: a dependency-free, accessible click-triggered floating panel.
// Closes on outside-click and Escape; the trigger toggles it. No portal/timer to leak. Anchored
// relative to its trigger (wrap in a positioned container). Classes come from ui/variants.ts.

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { popoverPanelClasses } from './variants';

export interface PopoverProps {
  /** The clickable trigger element. */
  trigger: React.ReactNode;
  children: React.ReactNode;
  /** Align the panel to the trigger's left (default) or right edge. */
  align?: 'left' | 'right';
  className?: string;
}

export function Popover({ trigger, children, align = 'left', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex">
      <span onClick={() => setOpen((v) => !v)} aria-haspopup="true" aria-expanded={open}>
        {trigger}
      </span>
      {open && (
        <div role="menu" className={cn(popoverPanelClasses(), align === 'right' ? 'right-0' : 'left-0', className)}>
          {children}
        </div>
      )}
    </span>
  );
}

export default Popover;
