// P-DESIGN.1 — Badge primitive (status pill). Variant colours come from the shared resolver.

import React from 'react';
import { cn } from '../../lib/utils';
import { badgeClasses, type BadgeVariant } from './variants';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={cn(badgeClasses(variant), className)} {...rest} />;
}

export default Badge;
