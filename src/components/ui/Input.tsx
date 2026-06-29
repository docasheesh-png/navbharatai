// P-DESIGN.1 — Input + Select primitives sharing the token-driven field style.

import React from 'react';
import { cn } from '../../lib/utils';
import { inputClasses } from './variants';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(inputClasses(invalid), className)} {...rest} />;
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(inputClasses(invalid), 'cursor-pointer', className)} {...rest}>
      {children}
    </select>
  );
});

export default Input;
