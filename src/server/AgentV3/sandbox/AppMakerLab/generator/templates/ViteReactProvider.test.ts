import { describe, it, expect } from 'vitest';
import { ViteReactProvider } from './ViteReactProvider';
import { hasErrorBoundarySignal } from '../../../../ErrorBoundaryAnalysis';

describe('ViteReactProvider (v3.0 sandbox template) — ships an error boundary by default (C8)', () => {
  const files = new ViteReactProvider().getFiles([]);

  it('includes a real ErrorBoundary component the readiness analysis recognises', () => {
    expect(files['src/ErrorBoundary.tsx']).toBeDefined();
    expect(hasErrorBoundarySignal(files['src/ErrorBoundary.tsx'])).toBe(true); // getDerivedStateFromError + componentDidCatch
  });

  it('wraps <App/> in <ErrorBoundary> in main.tsx (so a component crash never white-screens the app)', () => {
    const main = files['src/main.tsx'];
    expect(main).toContain("import ErrorBoundary from './ErrorBoundary'");
    expect(main).toMatch(/<ErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/ErrorBoundary>/);
    expect(hasErrorBoundarySignal(main)).toBe(true); // the <ErrorBoundary> usage is itself a signal
  });

  it('still ships the essentials (App, vite config, tsconfig, index.html)', () => {
    for (const p of ['src/App.tsx', 'src/main.tsx', 'vite.config.ts', 'tsconfig.json', 'index.html', 'package.json']) {
      expect(files[p], p).toBeDefined();
    }
  });
});
