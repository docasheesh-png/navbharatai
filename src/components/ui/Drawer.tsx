// P-DESIGN.2 — Drawer primitive: a dependency-free, accessible side panel that slides in from the
// left or right over a dimming backdrop. Closes on backdrop click and Escape. Classes come from
// ui/variants.ts. Render conditionally (`{open && <Drawer .../>}`) or pass `open`.

import React, { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { overlayBackdropClasses, drawerPanelClasses, type OverlaySide } from './variants';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: OverlaySide;
  /** Accessible title for the dialog. */
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Drawer({ open, onClose, side = 'right', title, children, className }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className={overlayBackdropClasses()} onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Drawer'} className={cn(drawerPanelClasses(side), className)}>
        {title && <div className="px-4 py-3 border-b border-white/10 text-sm font-bold text-white">{title}</div>}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}

export default Drawer;
