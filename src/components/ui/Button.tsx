// P-DESIGN.1 — Button primitive. Variants/sizes come from the shared variant resolver so every
// button in the app can share one vocabulary. Forwards all native button props.

import React from 'react';
import { cn } from '../../lib/utils';
import { buttonClasses, type ButtonVariant, type ButtonSize } from './variants';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonClasses(variant, size), className)} {...rest} />;
});

export default Button;
