import { describe, it, expect } from 'vitest';
import { generateUiStates } from './UiStatesGenerator';

describe('generateUiStates', () => {
  it('emits the full pack by default (spinner, skeleton, empty, error boundary, hooks, css)', () => {
    const out = generateUiStates();
    expect(Object.keys(out.files).sort()).toEqual([
      'src/components/ui/EmptyState.tsx',
      'src/components/ui/ErrorBoundary.tsx',
      'src/components/ui/Skeleton.tsx',
      'src/components/ui/Spinner.tsx',
      'src/components/ui/ui.css',
      'src/hooks/useAsync.ts',
      'src/hooks/useOptimisticList.ts',
    ]);
    expect(out.dependencies).toEqual([]); // dependency-free
  });

  it('ErrorBoundary is a class component with getDerivedStateFromError (the correct React pattern)', () => {
    const eb = generateUiStates().files['src/components/ui/ErrorBoundary.tsx'];
    expect(eb).toContain('export class ErrorBoundary extends Component');
    expect(eb).toContain('static getDerivedStateFromError');
  });

  it('useAsync exposes loading/error/data/run; useOptimisticList rolls back on failure', () => {
    const files = generateUiStates().files;
    const async = files['src/hooks/useAsync.ts'];
    expect(async).toContain('return { loading, error, data, run };');
    const opt = files['src/hooks/useOptimisticList.ts'];
    expect(opt).toContain('setItems(prev); // roll back');
  });

  it('ships the CSS keyframes the spinner/skeleton need', () => {
    const css = generateUiStates().files['src/components/ui/ui.css'];
    expect(css).toContain('@keyframes nb-spin');
    expect(css).toContain('@keyframes nb-shimmer');
  });

  it('an include filter emits a subset (and always ships ui.css when Spinner is present)', () => {
    const out = generateUiStates(['spinner']);
    expect(Object.keys(out.files).sort()).toEqual([
      'src/components/ui/Spinner.tsx',
      'src/components/ui/ui.css',
    ]);
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error — malformed input must not throw
    expect(() => generateUiStates(123)).not.toThrow();
    expect(() => generateUiStates([])).not.toThrow(); // empty → full pack
  });
});
