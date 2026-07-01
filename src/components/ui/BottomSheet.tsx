// P-DESIGN.2 — BottomSheet primitive: a dependency-free, accessible sheet that slides up from the
// bottom over a dimming backdrop (mobile-friendly). Closes on backdrop click and Escape. Classes
// come from ui/variants.ts.

import React, { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { overlayBackdropClasses, bottomSheetClasses } from './variants';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function BottomSheet({ open, onClose, title, children, className }: BottomSheetProps) {
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
      <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Sheet'} className={cn(bottomSheetClasses(), className)}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
        {title && <div className="px-4 py-3 border-b border-white/10 text-sm font-bold text-white">{title}</div>}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}

export default BottomSheet;
