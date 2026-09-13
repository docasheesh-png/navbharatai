/**
 * THE ORPHAN WARNING THAT WAS OUR OWN FAULT (build-report autopsy f04421ef, 2026-09-13).
 *
 * 🔴 WHAT HAPPENED. On a real build, our `evaluate` tool told the builder that its screens were "orphan
 * components — created but never imported/rendered by anything else (the app will NOT show them)". They
 * were imported, and rendered. The builder said so in its own narration — *"The components are absolutely
 * imported — the evaluate tool's orphan warning is a false positive"* — and spent a turn of an
 * already-overrunning build arguing with a tool that was wrong.
 *
 * 🔴 AND IT WAS SELF-INFLICTED. `resolveLocalImport` understood `./relative` and `@/alias` imports and
 * returned null for a BARE root-relative one (`stores/useStore`) as "an npm package". But our OWN scaffold
 * sets these projects up for exactly that style: its `vite.config.ts` carries the comment *"Mirror
 * tsconfig's baseUrl/paths into Vite so a root-relative import such as `import { useStore } from
 * 'stores/useStore'` resolves at BUILD & RUNTIME too"*. We generate the import style, then could not read
 * it back. A tool that lies to the builder is worse than one that says nothing.
 */
import { describe, it, expect } from 'vitest';
import { resolveLocalImport, findOrphanComponents, analyzeArchitecture } from '../src/server/AgentV3/ArchitectureAnalysis';
import type { ProjectGraph } from '../src/server/AgentV3/WorkspaceMemory';

const files = new Set([
  'src/App.tsx',
  'src/main.tsx',
  'src/components/ChatPage.tsx',
  'src/components/LandingPage.tsx',
  'src/stores/useStore.ts',
  'src/server/db.ts',
]);

describe('a bare root-relative import is a LOCAL file', () => {
  it('resolves the style our own scaffold sets up', () => {
    expect(resolveLocalImport('src/App.tsx', 'components/ChatPage', files)).toBe('src/components/ChatPage.tsx');
    expect(resolveLocalImport('src/App.tsx', 'stores/useStore', files)).toBe('src/stores/useStore.ts');
  });

  it('🔒 still treats a real npm package as external — this is what makes widening safe', () => {
    for (const pkg of ['react', 'react-dom/client', 'lucide-react', 'zustand', '@tanstack/react-query', 'node:fs']) {
      expect(resolveLocalImport('src/App.tsx', pkg, files), pkg).toBeNull();
    }
  });

  it('the alias forms are unchanged', () => {
    expect(resolveLocalImport('src/App.tsx', '@/components/ChatPage', files)).toBe('src/components/ChatPage.tsx');
    expect(resolveLocalImport('src/App.tsx', './components/ChatPage', files)).toBe('src/components/ChatPage.tsx');
  });

  it('works for a FULLSTACK layout, where the frontend lives under client/src', () => {
    const fullstack = new Set(['client/src/App.tsx', 'client/src/components/Card.tsx']);
    expect(resolveLocalImport('client/src/App.tsx', 'components/Card', fullstack)).toBe('client/src/components/Card.tsx');
  });
});

describe('🔴 the false orphan warning is gone', () => {
  const graph = {
    files: [...files],
    imports: {
      // The app imports its screens root-relatively — the style the scaffold encourages.
      'src/App.tsx': ['react', 'components/ChatPage', 'components/LandingPage', 'stores/useStore'],
      'src/main.tsx': ['react-dom/client', './App'],
      'src/components/ChatPage.tsx': ['react', 'lucide-react'],
      'src/components/LandingPage.tsx': ['react'],
      'src/stores/useStore.ts': ['zustand'],
      'src/server/db.ts': [],
    },
    symbols: [
      { file: 'src/components/ChatPage.tsx', name: 'ChatPage' },
      { file: 'src/components/LandingPage.tsx', name: 'LandingPage' },
    ],
  } as unknown as ProjectGraph;

  it('reports NO orphans for an app whose screens are genuinely wired', () => {
    // Before the fix this returned both screens — the exact warning the builder had to argue with.
    expect(findOrphanComponents(graph)).toEqual([]);
  });

  it('still catches a GENUINELY unreferenced screen, so the check keeps its value', () => {
    const withOrphan = {
      ...graph,
      files: [...graph.files, 'src/components/SettingsPage.tsx'],
      symbols: [...graph.symbols, { file: 'src/components/SettingsPage.tsx', name: 'SettingsPage' }],
    } as unknown as ProjectGraph;
    expect(findOrphanComponents(withOrphan)).toEqual(['src/components/SettingsPage.tsx (SettingsPage)']);
  });
});

describe('the graph gained the edges it was missing', () => {
  it('counts a root-relative import as a real edge', () => {
    const g = {
      files: ['src/App.tsx', 'src/stores/useStore.ts'],
      imports: { 'src/App.tsx': ['react', 'stores/useStore'], 'src/stores/useStore.ts': [] },
      symbols: [],
    } as unknown as ProjectGraph;
    const report = analyzeArchitecture(g);
    expect(report.edgeCount).toBe(1);
    // 🔒 And an npm package is never reported as a defect: `unresolvedImports` still holds RELATIVE
    // specs only, which is what makes widening the resolver unable to invent a problem.
    expect(report.unresolvedImports).toEqual([]);
  });

  it('a frontend file importing the server root-relatively is now the layering violation it always was', () => {
    const g = {
      files: ['src/components/ChatPage.tsx', 'src/server/db.ts'],
      imports: { 'src/components/ChatPage.tsx': ['server/db'], 'src/server/db.ts': [] },
      symbols: [],
    } as unknown as ProjectGraph;
    expect(analyzeArchitecture(g).layeringViolations).toEqual(['src/components/ChatPage.tsx -> src/server/db.ts']);
  });

  it('an unresolvable bare specifier is still silent — not an unresolved import', () => {
    const g = {
      files: ['src/App.tsx'],
      imports: { 'src/App.tsx': ['react', 'some-npm-thing', '@scope/pkg'] },
      symbols: [],
    } as unknown as ProjectGraph;
    const report = analyzeArchitecture(g);
    expect(report.unresolvedImports).toEqual([]);
    expect(report.edgeCount).toBe(0);
  });
});
