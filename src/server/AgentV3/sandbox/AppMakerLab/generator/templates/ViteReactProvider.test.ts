import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
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

// Kanban build autopsy (2026-07-13): the build wrote src/stores/useBoardStore.ts and src/types/index.ts,
// yet the generated code imported them baseUrl-"src" style (`from 'stores/useBoardStore'`, `from 'types/index'`)
// — and the scaffold tsconfig had NO baseUrl, so tsc reported TS2307 "Cannot find module" → TYPECHECK_FAILED,
// even though the file existed. This proves, via the REAL TypeScript resolver against the scaffold's own
// tsconfig, that such imports now resolve — the fix holds where it broke, not just in a config-string check.
describe('ViteReactProvider scaffold — resolves baseUrl-"src" imports (Kanban autopsy regression)', () => {
  const files = new ViteReactProvider().getFiles([]);
  const ROOT = '/proj';
  const tsconfigJson = JSON.parse(files['tsconfig.json']);
  const { options } = ts.convertCompilerOptionsFromJson(tsconfigJson.compilerOptions, ROOT);

  // Virtual project = the two modules the Kanban build actually wrote under src/, plus one component.
  const existing = new Set<string>([
    `${ROOT}/src/stores/useBoardStore.ts`,
    `${ROOT}/src/types/index.ts`,
    `${ROOT}/src/components/ui/Button.tsx`,
    `${ROOT}/src/components/Dashboard.tsx`,
  ]);
  const host: ts.ModuleResolutionHost = {
    fileExists: (f) => existing.has(f.replace(/\\/g, '/')),
    readFile: () => '',
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const resolve = (spec: string): string | undefined =>
    ts.resolveModuleName(spec, `${ROOT}/src/components/Dashboard.tsx`, options, host).resolvedModule?.resolvedFileName;

  it('resolves a bare baseUrl import to its file under src/ (the exact TYPECHECK_FAILED cause)', () => {
    expect(resolve('stores/useBoardStore')).toBe(`${ROOT}/src/stores/useBoardStore.ts`);
    expect(resolve('types/index')).toBe(`${ROOT}/src/types/index.ts`);
  });

  it('resolves the @/ alias to src/', () => {
    expect(resolve('@/components/ui/Button')).toBe(`${ROOT}/src/components/ui/Button.tsx`);
  });

  it('does NOT hijack a real npm package (no src/react → falls through to node resolution, unresolved here)', () => {
    expect(resolve('react')).toBeUndefined(); // no src/react and no node_modules in the virtual FS
  });

  it('Vite mirrors the tsconfig paths so resolution holds at build/runtime, not only in tsc', () => {
    expect(files['vite.config.ts']).toContain("import tsconfigPaths from 'vite-tsconfig-paths'");
    expect(files['vite.config.ts']).toMatch(/plugins:\s*\[react\(\),\s*tsconfigPaths\(\)\]/);
    expect(JSON.parse(files['package.json']).devDependencies['vite-tsconfig-paths']).toBeTruthy();
  });
});
