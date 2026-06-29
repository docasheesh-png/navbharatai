// P-DESIGN.1 — Card primitive (surface container) with an optional header (icon + title + action).
// Uses the shared card surface token so every card matches.

import React from 'react';
import { cn } from '../../lib/utils';
import { cardClasses } from './variants';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional header title. */
  title?: React.ReactNode;
  /** Optional leading icon shown next to the title. */
  icon?: React.ReactNode;
  /** Optional header action (e.g. a refresh button) shown on the right. */
  action?: React.ReactNode;
  /** Inner padding (default true). */
  padded?: boolean;
}

export function Card({ title, icon, action, padded = true, className, children, ...rest }: CardProps) {
  return (
    <div className={cn(cardClasses(), padded && 'p-5', className)} {...rest}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {icon}
            {title && <h3 className="text-sm font-black text-white uppercase tracking-tight">{title}</h3>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export default Card;
