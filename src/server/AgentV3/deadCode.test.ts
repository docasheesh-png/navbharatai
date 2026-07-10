import { describe, it, expect } from 'vitest';
import { findUnwiredFiles, unwiredFilesSummary } from './deadCode';
import type { ProjectGraph } from './WorkspaceMemory';

// GA-18-adjacent: find built-but-unwired modules. Pure — reuses the A1 import edges.

const base = (imports: Record<string, string[]>, files: string[]): ProjectGraph => ({
  files, symbols: [], components: [], routes: [], imports, dependencies: [],
});

describe('findUnwiredFiles', () => {
  it('flags a component that nothing imports', () => {
    const g = base(
      { 'src/main.tsx': ['./App'], 'src/App.tsx': ['./components/Used'] },
      ['src/main.tsx', 'src/App.tsx', 'src/components/Used.tsx', 'src/components/Orphan.tsx'],
    );
    expect(findUnwiredFiles(g)).toEqual(['src/components/Orphan.tsx']);
  });

  it('does NOT flag entry points, tests, configs, type decls, stories, routes or setup files', () => {
    const g = base(
      { 'src/App.tsx': [] },
      [
        'src/main.tsx',            // entry
        'src/App.tsx',             // imported by nothing but is an entry-ish name
        'src/App.test.tsx',        // test
        'vite.config.ts',          // config
        'src/vite-env.d.ts',       // decl
        'src/Button.stories.tsx',  // story
        'src/pages/Home.tsx',      // file-based route
        'app/dashboard/page.tsx',  // next route
        'src/setupTests.ts',       // setup
      ],
    );
    expect(findUnwiredFiles(g)).toEqual([]);
  });

  it('flags an unused hook/util but not one that is imported', () => {
    const g = base(
      { 'src/App.tsx': ['./hooks/useUsed'] },
      ['src/App.tsx', 'src/hooks/useUsed.ts', 'src/hooks/useOrphan.ts', 'src/utils/deadHelper.ts'],
    );
    expect(findUnwiredFiles(g)).toEqual(['src/hooks/useOrphan.ts', 'src/utils/deadHelper.ts']);
  });

  it('returns [] when everything is wired', () => {
    const g = base(
      { 'src/main.tsx': ['./App'], 'src/App.tsx': ['./Widget'] },
      ['src/main.tsx', 'src/App.tsx', 'src/Widget.tsx'],
    );
    expect(findUnwiredFiles(g)).toEqual([]);
  });
});

describe('unwiredFilesSummary', () => {
  it('is honest when clean, and lists candidates with a verify caveat', () => {
    expect(unwiredFilesSummary([])).toContain('no unwired modules');
    const s = unwiredFilesSummary(['src/a.ts']);
    expect(s).toContain('src/a.ts');
    expect(s).toContain('verify');
  });
});
