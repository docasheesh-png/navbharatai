// failedbr #1615 (2026-11-20): with the starter's `baseUrl: "src"`, `import … from 'types'` is `src/types.ts`, yet the
// readiness check said "2 package(s) the app loads are not installed: types, lib". A bare import that a real project
// file matches is local; `react` stays a package.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyWellKnownMissingDeps } from '../src/server/AgentV3/DependencyAutoFix';
import { resolveLocalImport } from '../src/server/AgentV3/ArchitectureAnalysis';

describe('a bare import that is a project file is not a package (failedbr #1615)', () => {
  const files = new Set(['src/types.ts', 'src/lib/storage.ts', 'src/screens/Chapters.tsx', 'package.json']);
  it('the resolver reads the baseUrl form and leaves real packages alone', () => {
    expect(resolveLocalImport('src/screens/Chapters.tsx', 'types', files)).toBe('src/types.ts');
    expect(resolveLocalImport('src/screens/Chapters.tsx', 'lib/storage', files)).toBe('src/lib/storage.ts');
    expect(resolveLocalImport('src/screens/Chapters.tsx', 'react', files)).toBeNull();
  });

  it('the dependency check sends only unresolved bare imports to the package analysis', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const block = src.slice(src.indexOf('private async collectDependencyIssues'), src.indexOf('return analyzeDependencies([...external]'));
    expect(block).toMatch(/if \(resolveLocalImport\(file, spec, files\)\) continue;\s*external\.add\(spec\);/);
  });

  it('the well-known reconciler never declares a project folder as a dependency', () => {
    const out = applyWellKnownMissingDeps({
      'package.json': JSON.stringify({ dependencies: { react: '^18.3.1' } }),
      'src/types.ts': 'export type T = 1;',
      'src/axios.ts': 'export const http = 1;',
      'src/App.tsx': "import type { T } from 'types';\nimport { http } from 'axios';\nexport default function App(){ return null; }\n",
    });
    expect(out.added).toEqual([]);
  });
});
