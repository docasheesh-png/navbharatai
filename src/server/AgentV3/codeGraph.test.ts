import { describe, it, expect } from 'vitest';
import {
  buildImportEdges,
  whoImports,
  dependenciesOf,
  impactOf,
  definitionsOf,
  resolveGraphFile,
} from './codeGraph';
import type { ProjectGraph } from './WorkspaceMemory';

// A1: structured import/impact queries over the project graph. Pure — build a small graph and assert
// reverse edges, transitive impact, resolution, and symbol lookup.

// Chain: main.tsx → App.tsx → components/Button.tsx ; and Header.tsx → components/Button.tsx
const graph: ProjectGraph = {
  files: ['src/main.tsx', 'src/App.tsx', 'src/Header.tsx', 'src/components/Button.tsx'],
  symbols: [
    { name: 'Button', kind: 'component', file: 'src/components/Button.tsx' },
    { name: 'App', kind: 'component', file: 'src/App.tsx' },
    { name: 'formatDate', kind: 'function', file: 'src/App.tsx' },
  ],
  components: ['Button', 'App', 'Header'],
  routes: [],
  imports: {
    'src/main.tsx': ['./App', 'react'],
    'src/App.tsx': ['./components/Button', './Header'],
    'src/Header.tsx': ['./components/Button'],
    'src/components/Button.tsx': ['react'],
  },
  dependencies: ['react'],
};

describe('buildImportEdges', () => {
  it('resolves local edges both ways and drops npm/bare specifiers', () => {
    const { forward, reverse } = buildImportEdges(graph);
    expect([...(forward.get('src/App.tsx') ?? [])].sort()).toEqual(['src/Header.tsx', 'src/components/Button.tsx']);
    expect(forward.get('src/components/Button.tsx')).toBeUndefined(); // only imported react
    expect([...(reverse.get('src/components/Button.tsx') ?? [])].sort()).toEqual(['src/App.tsx', 'src/Header.tsx']);
  });
});

describe('whoImports / dependenciesOf', () => {
  it('whoImports lists the direct importers', () => {
    expect(whoImports(graph, 'src/components/Button.tsx')).toEqual(['src/App.tsx', 'src/Header.tsx']);
    expect(whoImports(graph, 'src/main.tsx')).toEqual([]); // nothing imports the entry
  });

  it('dependenciesOf lists direct local deps only', () => {
    expect(dependenciesOf(graph, 'src/main.tsx')).toEqual(['src/App.tsx']);
    expect(dependenciesOf(graph, 'src/components/Button.tsx')).toEqual([]);
  });
});

describe('impactOf', () => {
  it('returns the transitive set of files affected by a change (direct + indirect importers)', () => {
    // Changing Button affects Header + App (direct) and main (via App).
    expect(impactOf(graph, 'src/components/Button.tsx')).toEqual(['src/App.tsx', 'src/Header.tsx', 'src/main.tsx']);
  });

  it('is empty for a top-level entry nothing imports', () => {
    expect(impactOf(graph, 'src/main.tsx')).toEqual([]);
  });

  it('is cycle-safe', () => {
    const cyclic: ProjectGraph = {
      ...graph,
      files: ['a.ts', 'b.ts'],
      symbols: [],
      imports: { 'a.ts': ['./b'], 'b.ts': ['./a'] },
    };
    // Each imports the other; impact of a = {b}, and BFS must terminate.
    expect(impactOf(cyclic, 'a.ts')).toEqual(['b.ts']);
  });
});

describe('resolveGraphFile', () => {
  it('matches exact and unique suffix, rejects ambiguous/unknown', () => {
    expect(resolveGraphFile(graph, 'src/App.tsx')).toBe('src/App.tsx');
    expect(resolveGraphFile(graph, 'App.tsx')).toBe('src/App.tsx'); // unique suffix
    expect(resolveGraphFile(graph, 'Button.tsx')).toBe('src/components/Button.tsx');
    expect(resolveGraphFile(graph, 'nope.tsx')).toBeNull();
  });
});

describe('definitionsOf', () => {
  it('finds where a symbol is defined by exact name', () => {
    expect(definitionsOf(graph, 'Button')).toEqual([{ name: 'Button', kind: 'component', file: 'src/components/Button.tsx' }]);
    expect(definitionsOf(graph, 'Missing')).toEqual([]);
  });
});
