import { describe, it, expect } from 'vitest';
import {
  hasErrorBoundarySignal,
  analyzeErrorBoundary,
  errorBoundarySummary,
} from './ErrorBoundaryAnalysis';

describe('hasErrorBoundarySignal', () => {
  it('detects class-component error boundaries', () => {
    expect(hasErrorBoundarySignal('class B extends React.Component { componentDidCatch(e){} }')).toBe(true);
    expect(hasErrorBoundarySignal('static getDerivedStateFromError(e){ return {} }')).toBe(true);
  });
  it('detects the react-error-boundary library and JSX usage', () => {
    expect(hasErrorBoundarySignal("import { ErrorBoundary } from 'react-error-boundary'")).toBe(true);
    expect(hasErrorBoundarySignal('<ErrorBoundary fallback={<E/>}>')).toBe(true);
  });
  it('does not false-positive on ordinary code', () => {
    expect(hasErrorBoundarySignal('function App(){ return <div/> }')).toBe(false);
  });
});

describe('analyzeErrorBoundary', () => {
  it('is not assessable for a trivial (<2 component) app', () => {
    const r = analyzeErrorBoundary(1, false);
    expect(r.assessed).toBe(false);
    expect(r.findings).toHaveLength(0);
  });

  it('flags a real React app with no error boundary (medium)', () => {
    const r = analyzeErrorBoundary(5, false);
    expect(r.assessed).toBe(true);
    expect(r.findings.some((f) => f.level === 'medium')).toBe(true);
  });

  it('passes when the app has an error boundary', () => {
    const r = analyzeErrorBoundary(5, true);
    expect(r.assessed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });
});

describe('errorBoundarySummary', () => {
  it('renders the not-assessable line', () => {
    expect(errorBoundarySummary(analyzeErrorBoundary(1, false))).toContain('not a multi-component');
  });
  it('renders a pass line', () => {
    expect(errorBoundarySummary(analyzeErrorBoundary(3, true))).toContain('✓');
  });
  it('lists the missing boundary', () => {
    expect(errorBoundarySummary(analyzeErrorBoundary(3, false))).toContain('⚠');
  });
});
