import { describe, it, expect } from 'vitest';
import { analyzeArchitecture, resolveLocalImport, architectureSummary } from './ArchitectureAnalysis';
import { WorkspaceMemory } from './WorkspaceMemory';
import type { ProjectGraph } from './WorkspaceMemory';

function graphOf(files: Record<string, string>): ProjectGraph {
  const mem = new WorkspaceMemory();
  for (const [path, content] of Object.entries(files)) mem.indexFile(path, content);
  return mem.graph();
}

describe('resolveLocalImport', () => {
  const files = new Set(['src/Button.tsx', 'src/utils/index.ts', 'src/App.tsx']);
  it('resolves a relative import with an inferred extension', () => {
    expect(resolveLocalImport('src/App.tsx', './Button', files)).toBe('src/Button.tsx');
  });
  it('resolves a directory import to its index file', () => {
    expect(resolveLocalImport('src/App.tsx', './utils', files)).toBe('src/utils/index.ts');
  });
  it('returns null for external packages and missing files', () => {
    expect(resolveLocalImport('src/App.tsx', 'react', files)).toBeNull();
    expect(resolveLocalImport('src/App.tsx', './Missing', files)).toBeNull();
  });
});

describe('analyzeArchitecture', () => {
  it('flags an unresolved local import (a real build breaker)', () => {
    const g = graphOf({ 'src/App.tsx': "import { X } from './Missing';\nexport function App(){return null;}" });
    const r = analyzeArchitecture(g);
    expect(r.unresolvedImports).toContain('src/App.tsx -> ./Missing');
  });

  it('detects an import cycle between local modules', () => {
    const g = graphOf({
      'src/a.ts': "import { b } from './b';\nexport const a = 1;",
      'src/b.ts': "import { a } from './a';\nexport const b = 2;",
    });
    const r = analyzeArchitecture(g);
    expect(r.cycles.length).toBeGreaterThan(0);
  });

  it('flags a front-end module importing a back-end module', () => {
    const g = graphOf({
      'src/App.tsx': "import { db } from './server/db';\nexport function App(){return null;}",
      'src/server/db.ts': 'export const db = {};',
    });
    const r = analyzeArchitecture(g);
    expect(r.layeringViolations.length).toBeGreaterThan(0);
  });

  it('flags a server-only Node builtin imported by front-end code, but not a polyfilled one', () => {
    const g = graphOf({
      'src/components/Saver.tsx': "import fs from 'fs';\nexport function Saver(){return null;}",
      'src/components/Hasher.tsx': "import path from 'path';\nimport crypto from 'crypto';\nexport function Hasher(){return null;}",
    });
    const r = analyzeArchitecture(g);
    expect(r.nodeBuiltinsInFrontend.some((v) => v.includes('Saver.tsx') && v.includes('fs'))).toBe(true);
    // path/crypto are commonly polyfilled by bundlers — intentionally not flagged.
    expect(r.nodeBuiltinsInFrontend.some((v) => v.includes('Hasher.tsx'))).toBe(false);
    expect(architectureSummary(r)).toContain('break the browser build');
  });

  it('does NOT flag a server-only builtin imported by back-end code', () => {
    const g = graphOf({ 'src/server/store.ts': "import fs from 'fs';\nexport const store = {};" });
    expect(analyzeArchitecture(g).nodeBuiltinsInFrontend).toEqual([]);
  });

  it('reports clean for a well-structured project', () => {
    const g = graphOf({
      'src/App.tsx': "import { Button } from './Button';\nexport function App(){return null;}",
      'src/Button.tsx': "import react from 'react';\nexport function Button(){return null;}",
    });
    const r = analyzeArchitecture(g);
    expect(r.cycles).toEqual([]);
    expect(r.unresolvedImports).toEqual([]);
    expect(r.layeringViolations).toEqual([]);
    expect(architectureSummary(r)).toContain('No structural defects');
  });
});
