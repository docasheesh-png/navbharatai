// UI-PRIMITIVE SCAFFOLDER — deterministically CREATE the shadcn/ui primitives an AI-generated app imports
// but never wrote (admin 2026-08-14: "APK builder ko 100x strong banao"). The #1 recurring "cannot
// compile" class: models trained on shadcn codebases write `import { Button } from "@/components/ui/button"`
// (and card / input / dialog / …) without ever generating those files, so the app can't build anywhere.
//
// This heals the WHOLE class before the app reaches GitHub: for every unresolved `@/components/ui/<name>`
// (or `@/lib/utils`), if <name> is a known primitive we write a REAL, WORKING implementation of it.
//
// DELIBERATELY DEPENDENCY-LIGHT: Tailwind + a local `cn` (clsx + tailwind-merge) + class-variance-authority
// only — NO @radix-ui. Radix would pull ~30 packages and its own peer-dep maze; a plain, accessible
// Tailwind implementation compiles with three allowlisted deps and WORKS (rule 2 — real, not a stub). It is
// not pixel-perfect shadcn, but the app builds, renders and functions, which is the whole point.
//
// Pure: no I/O, no clock, no model. Never throws.

/** Derive the app's source root from an importing file so `@/` maps to it (client/src, frontend/src, …). */
function srcRootOf(fromFile: string): string {
  const m = /^(.*?(?:^|\/)src)\//.exec(fromFile);
  return m ? m[1] : 'src';
}

const CN = `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

// Each entry: the file content for @/components/ui/<key>. Real, Tailwind-only, forwardRef where shadcn's
// API is a ref-forwarding element so `<Button ref>` / `<Input ref>` keep working.
const PRIMITIVES: Record<string, string> = {
  button: `import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 bg-indigo-600 text-white hover:bg-indigo-700',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground border-gray-300 hover:bg-gray-100',
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        ghost: 'hover:bg-gray-100 hover:text-gray-900',
        link: 'text-indigo-600 underline-offset-4 hover:underline',
      },
      size: { default: 'h-10 px-4 py-2', sm: 'h-9 rounded-md px-3', lg: 'h-11 rounded-md px-8', icon: 'h-10 w-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
`,
  input: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn('flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
`,
  textarea: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn('flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
`,
  label: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', className)} {...props} />
  ),
);
Label.displayName = 'Label';

export { Label };
`,
  card: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('rounded-lg border border-gray-200 bg-white text-gray-950 shadow-sm', className)} {...props} />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm text-gray-500', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
`,
  badge: `import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-indigo-600 text-white',
        secondary: 'border-transparent bg-gray-100 text-gray-900',
        destructive: 'border-transparent bg-red-600 text-white',
        outline: 'text-gray-950 border-gray-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
`,
  separator: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Separator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }>(
  ({ className, orientation = 'horizontal', ...props }, ref) => (
    <div ref={ref} role="separator" className={cn('shrink-0 bg-gray-200', orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]', className)} {...props} />
  ),
);
Separator.displayName = 'Separator';

export { Separator };
`,
  skeleton: `import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200', className)} {...props} />;
}

export { Skeleton };
`,
  alert: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' }>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div ref={ref} role="alert" className={cn('relative w-full rounded-lg border p-4', variant === 'destructive' ? 'border-red-500/50 text-red-700' : 'border-gray-200 text-gray-950', className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
`,
  avatar: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Avatar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100', className)} {...props} />
));
Avatar.displayName = 'Avatar';

const AvatarImage = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(({ className, alt = '', ...props }, ref) => (
  <img ref={ref} alt={alt} className={cn('aspect-square h-full w-full object-cover', className)} {...props} />
));
AvatarImage.displayName = 'AvatarImage';

const AvatarFallback = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex h-full w-full items-center justify-center rounded-full bg-gray-200 text-sm', className)} {...props} />
));
AvatarFallback.displayName = 'AvatarFallback';

export { Avatar, AvatarImage, AvatarFallback };
`,
  switch: `import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn('peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50', checked ? 'bg-indigo-600' : 'bg-gray-300', className)}
      {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      <span className={cn('pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform', checked ? 'translate-x-5' : 'translate-x-0')} />
    </button>
  ),
);
Switch.displayName = 'Switch';

export { Switch };
`,
  checkbox: `import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onCheckedChange, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      className={cn('h-4 w-4 rounded border border-gray-300 text-indigo-600 focus:ring-indigo-500', className)}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
`,
  progress: `import * as React from 'react';
import { cn } from '@/lib/utils';

const Progress = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value?: number }>(
  ({ className, value = 0, ...props }, ref) => (
    <div ref={ref} className={cn('relative h-4 w-full overflow-hidden rounded-full bg-gray-200', className)} {...props}>
      <div className="h-full bg-indigo-600 transition-all" style={{ width: \`\${Math.min(100, Math.max(0, value))}%\` }} />
    </div>
  ),
);
Progress.displayName = 'Progress';

export { Progress };
`,
};

/** Every scaffoldable specifier (for detection): `@/lib/utils` + `@/components/ui/<name>`. */
export function isScaffoldablePrimitive(spec: string): boolean {
  if (spec === '@/lib/utils' || /(?:^|\/)lib\/utils$/.test(spec)) return true;
  const m = /(?:^|\/)components\/ui\/([a-z-]+)$/.exec(spec);
  return !!m && Object.prototype.hasOwnProperty.call(PRIMITIVES, m[1]);
}

export interface ScaffoldResult {
  /** New files to add to the app (path -> content). Empty when nothing matched. */
  files: Record<string, string>;
  /** Human-readable, vendor-free note for the user about what was created. */
  created: string[];
}

/**
 * For each unresolved `@/components/ui/<known>` or `@/lib/utils` import, generate the missing file at the
 * importing app's real source root (client/src, frontend/src, or src). Only creates a file that does NOT
 * already exist. Pure; never throws. The caller re-verifies compile after applying these.
 */
export function scaffoldMissingUiPrimitives(
  files: Record<string, string>,
  unresolved: ReadonlyArray<{ path: string; spec: string }>,
): ScaffoldResult {
  const out: Record<string, string> = {};
  const created = new Set<string>();
  const has = (p: string) => Object.prototype.hasOwnProperty.call(files, p) || Object.prototype.hasOwnProperty.call(out, p);

  for (const { path: fromFile, spec } of unresolved) {
    if (!isScaffoldablePrimitive(spec)) continue;
    const root = srcRootOf(fromFile);

    // The cn helper is required by every primitive — create it whenever any primitive (or utils itself)
    // is needed and it is missing.
    const utilsPath = `${root}/lib/utils.ts`;
    if (!has(utilsPath) && !has(`${root}/lib/utils.tsx`)) { out[utilsPath] = CN; created.add('a shared class helper'); }

    const m = /(?:^|\/)components\/ui\/([a-z-]+)$/.exec(spec);
    if (m) {
      const name = m[1];
      const body = PRIMITIVES[name];
      if (body) {
        const target = `${root}/components/ui/${name}.tsx`;
        if (!has(target)) { out[target] = body; created.add(name); }
      }
    }
  }

  return { files: out, created: [...created] };
}
