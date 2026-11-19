// 🔴 failedbr #2466 (a360bc2c, 2026-11-19): "Accessibility 76/100 — 3 form field(s) with no label", two of them the
// design-system primitives src/components/ui/select.tsx and ui/textarea.tsx, whose `{...props}` forwards the label the
// calling screen gives. Both analyzers read one definition (`forwardsCallerProps`). Reversion: drop it from either
// analyzer and its block fails.
import { describe, it, expect } from 'vitest';
import { inputsMissingLabel } from '../src/server/AppMakerLab/intelligence/A11yLinter';
import { scanAccessibility } from '../src/server/AgentV3/AccessibilityAnalysis';
import { forwardsCallerProps } from '../src/server/AgentV3/jsxTags';

const TEXTAREA_PRIMITIVE = `import * as React from 'react';
import { cn } from '@/lib/utils';
const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn('flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm', className)}
        ref={ref}
        {...props}
      />
    );
  },
);
export { Textarea };
`;

describe("a primitive that forwards its caller's props is labelled by its caller", () => {
  it('the shared reader', () => {
    expect(forwardsCallerProps('<textarea className="x" {...props} />')).toBe(true);
    expect(forwardsCallerProps('<select {...rest}>')).toBe(true);
    expect(forwardsCallerProps("<input {...register('email')} />")).toBe(false);
    expect(forwardsCallerProps('<input {...field} />')).toBe(false);
  });

  it('the report linter (A11yLinter) no longer counts the #2466 textarea primitive', () => {
    expect(inputsMissingLabel(TEXTAREA_PRIMITIVE)).toEqual([1, 0]);
  });

  it('the build analyzer (AccessibilityAnalysis) agrees — multi-line and one-line primitives', () => {
    const issues = scanAccessibility('src/components/ui/textarea.tsx', TEXTAREA_PRIMITIVE);
    expect(issues.filter((i) => i.kind === 'control-unlabeled')).toEqual([]);
    const oneLine = `const Select = ({ className, ...props }) => <select className={cn('h-10', className)} {...props} />;`;
    expect(scanAccessibility('src/components/ui/select.tsx', oneLine).filter((i) => i.kind === 'control-unlabeled')).toEqual([]);
  });

  it('a field that really has no label is still flagged by both', () => {
    const real = `export function F(){ return <form><input type="text" {...register('email')} /><textarea placeholder="Lyrics" /></form>; }`;
    expect(inputsMissingLabel(real)).toEqual([2, 2]);
    const issues = scanAccessibility('src/F.tsx', real);
    expect(issues.filter((i) => i.kind === 'control-unlabeled').length).toBe(2);
  });
});
