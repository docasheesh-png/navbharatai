import { describe, it, expect } from 'vitest';
import { analyzeArchitecture, resolveLocalImport, architectureSummary, findOrphanComponents, generateArchitectureDoc } from './ArchitectureAnalysis';
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
  it('resolves the conventional `@/` and `~/` path aliases to the src-rooted file', () => {
    expect(resolveLocalImport('src/App.tsx', '@/Button', files)).toBe('src/Button.tsx');
    expect(resolveLocalImport('src/App.tsx', '~/utils', files)).toBe('src/utils/index.ts');
    expect(resolveLocalImport('src/App.tsx', '@/Missing', files)).toBeNull(); // alias to a missing file → still null
  });

  it('resolves `@/` to a FULLSTACK app\'s client/src root, not just a top-level src (APK-preflight autopsy 2026-08-14)', () => {
    // A fullstack app keeps its frontend under client/src/, and Vite aliases `@/` -> client/src/. The old
    // resolver only tried `src/` + bare, so EVERY `@/…` import here was falsely "unresolved" and the APK
    // compile pre-flight blocked an app that builds fine (real report: @/components/ui/button + 19 more).
    const fs = new Set([
      'client/src/components/BackButton.tsx',
      'client/src/components/ui/button.tsx',
      'client/src/lib/utils.ts',
      'client/src/App.tsx',
    ]);
    expect(resolveLocalImport('client/src/components/BackButton.tsx', '@/components/ui/button', fs)).toBe('client/src/components/ui/button.tsx');
    expect(resolveLocalImport('client/src/App.tsx', '@/lib/utils', fs)).toBe('client/src/lib/utils.ts');
    // A genuinely missing alias target is still unresolved (no over-reach).
    expect(resolveLocalImport('client/src/App.tsx', '@/components/ui/missing', fs)).toBeNull();
  });

  it('resolves `@/` for other nested source roots (frontend/src, apps/web/src)', () => {
    const fe = new Set(['frontend/src/x.ts', 'apps/web/src/y.ts']);
    expect(resolveLocalImport('frontend/src/pages/Home.tsx', '@/x', fe)).toBe('frontend/src/x.ts');
    expect(resolveLocalImport('apps/web/src/pages/Home.tsx', '@/y', fe)).toBe('apps/web/src/y.ts');
  });

  it('resolves a NodeNext/ESM `.js`-extension import to its `.ts` source (SvelteKit — CollabDesk autopsy)', () => {
    // `import { Card } from './types.js'` in a `"type":"module"` TS project resolves to `./types.ts`.
    const ts = new Set(['src/lib/types.ts', 'src/lib/permissions.ts', 'src/lib/cards.ts', 'src/lib/Comp.tsx']);
    expect(resolveLocalImport('src/lib/cards.ts', './types.js', ts)).toBe('src/lib/types.ts');
    expect(resolveLocalImport('src/lib/cards.ts', './permissions.js', ts)).toBe('src/lib/permissions.ts');
    expect(resolveLocalImport('src/lib/cards.ts', './Comp.jsx', ts)).toBe('src/lib/Comp.tsx');
    // A genuinely missing `.js` target still returns null (no over-reach).
    expect(resolveLocalImport('src/lib/cards.ts', './nope.js', ts)).toBeNull();
  });

  it('still prefers an actual `.js` file when one exists (does not hijack a real JS import)', () => {
    const mixed = new Set(['src/lib/legacy.js', 'src/lib/app.ts']);
    expect(resolveLocalImport('src/lib/app.ts', './legacy.js', mixed)).toBe('src/lib/legacy.js');
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

  it('flags other unpolyfilled server-only builtins (async_hooks, perf_hooks) in front-end code', () => {
    const g = graphOf({
      'src/components/Trace.tsx': "import { AsyncLocalStorage } from 'node:async_hooks';\nexport function Trace(){return null;}",
      'src/components/Perf.tsx': "import { performance } from 'perf_hooks';\nexport function Perf(){return null;}",
    });
    const r = analyzeArchitecture(g);
    expect(r.nodeBuiltinsInFrontend.some((v) => v.includes('Trace.tsx') && v.includes('async_hooks'))).toBe(true);
    expect(r.nodeBuiltinsInFrontend.some((v) => v.includes('Perf.tsx') && v.includes('perf_hooks'))).toBe(true);
  });

  it('does NOT flag a Node builtin in a Next.js server route (route.ts / pages/api) as a browser-build-breaker', () => {
    // Regression: isFrontendFile matched the `app`/`pages` segment, so a server-only route (which is
    // supposed to use fs) was flagged "breaks the browser build" (and — now that it's a readiness
    // blocker — would falsely fail a valid Next.js app).
    const appRoute = graphOf({ 'src/app/api/health/route.ts': "import fs from 'fs';\nexport function GET(){ return fs.readFileSync('x'); }" });
    expect(analyzeArchitecture(appRoute).nodeBuiltinsInFrontend).toEqual([]);
    const pagesApi = graphOf({ 'pages/api/users.ts': "import fs from 'fs';\nexport default function handler(){ fs.readFileSync('x'); }" });
    expect(analyzeArchitecture(pagesApi).nodeBuiltinsInFrontend).toEqual([]);
  });

  it('does NOT flag an alias-imported component (@/…) as an orphan (it IS rendered)', () => {
    // Regression: @/ imports resolved to null, so every alias-imported component was a false orphan.
    const g = graphOf({
      'src/App.tsx': "import { Hero } from '@/components/Hero';\nexport function App(){ return <Hero/>; }",
      'src/components/Hero.tsx': 'export function Hero(){ return null; }',
    });
    expect(findOrphanComponents(g).some((o) => o.includes('Hero.tsx'))).toBe(false);
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
    expect(r.orphanComponents).toEqual([]);
    expect(architectureSummary(r)).toContain('No structural defects');
  });
});

describe('findOrphanComponents (P-REPORT.5 — "components exist but the app still shows Hello World")', () => {
  it('flags a component file that exists but is never imported by anything else', () => {
    // Exactly the real-world defect: Hero/Features/Footer generated as separate files, but App.tsx
    // was never updated to import + render them.
    const g = graphOf({
      'src/App.tsx': "export function App(){ return <h1>Hello World</h1>; }",
      'src/components/Hero.tsx': "export function Hero(){ return null; }",
      'src/components/Features.tsx': "export function Features(){ return null; }",
    });
    const orphans = findOrphanComponents(g);
    expect(orphans.some((o) => o.includes('Hero.tsx') && o.includes('Hero'))).toBe(true);
    expect(orphans.some((o) => o.includes('Features.tsx') && o.includes('Features'))).toBe(true);
  });

  it('does NOT flag a component that IS imported and rendered', () => {
    const g = graphOf({
      'src/App.tsx': "import { Hero } from './components/Hero';\nexport function App(){ return <Hero />; }",
      'src/components/Hero.tsx': "export function Hero(){ return null; }",
    });
    expect(findOrphanComponents(g)).toEqual([]);
  });

  it('never flags the entry points themselves (App/main/index), even though nothing imports them', () => {
    const g = graphOf({
      'src/main.tsx': "import { App } from './App';\nApp();",
      'src/App.tsx': "export function App(){ return null; }",
    });
    // App.tsx IS imported by main.tsx here, but even if it weren't, entry points are roots by design.
    expect(findOrphanComponents(g).some((o) => o.includes('App.tsx'))).toBe(false);
    expect(findOrphanComponents(g).some((o) => o.includes('main.tsx'))).toBe(false);
  });

  it('does NOT flag non-component exports (camelCase hooks/utils are not components)', () => {
    const g = graphOf({
      'src/App.tsx': "export function App(){ return null; }",
      'src/hooks/useTheme.tsx': "export function useTheme(){ return 'dark'; }",
    });
    expect(findOrphanComponents(g)).toEqual([]);
  });

  it('does NOT flag Next.js App Router special files (layout/page/error/…) as orphans (TaskForge autopsy)', () => {
    // Next wires these by FILENAME convention — they are never `import`-ed, but are true entry points.
    // Before the fix, a clean Next.js build false-flagged all of them as phantom "unused components".
    const g = graphOf({
      'src/app/layout.tsx': "export default function RootLayout({ children }){ return children; }",
      'src/app/page.tsx': "export default function HomePage(){ return null; }",
      'src/app/error.tsx': "'use client';\nexport default function Error(){ return null; }",
      'src/app/not-found.tsx': "export default function NotFound(){ return null; }",
      'src/app/loading.tsx': "export default function Loading(){ return null; }",
      'src/app/dashboard/page.tsx': "export default function DashboardPage(){ return null; }",
      'src/app/dashboard/layout.tsx': "export default function DashboardLayout({ children }){ return children; }",
    });
    expect(findOrphanComponents(g)).toEqual([]);
  });

  it('STILL flags a genuine orphan component that happens to live under app/ (not a special file)', () => {
    // A real unused component under app/ must still be caught — the exclusion is filename-scoped, not
    // "anything under app/". Here Sidebar is a normal component nobody imports.
    const g = graphOf({
      'src/app/page.tsx': "export default function HomePage(){ return null; }",
      'src/app/components/Sidebar.tsx': "export function Sidebar(){ return null; }",
    });
    expect(findOrphanComponents(g).some((o) => o.includes('Sidebar.tsx'))).toBe(true);
  });

  it('is included in analyzeArchitecture()\'s report and architectureSummary()\'s text', () => {
    const g = graphOf({
      'src/App.tsx': "export function App(){ return null; }",
      'src/components/Hero.tsx': "export function Hero(){ return null; }",
    });
    const r = analyzeArchitecture(g);
    expect(r.orphanComponents.length).toBe(1);
    expect(architectureSummary(r)).toContain('Orphan component');
    expect(architectureSummary(r)).toContain('Hero.tsx');
  });
});

describe('generateArchitectureDoc (P-PIPE.112 — real ARCHITECTURE.md)', () => {
  it('LEADS with the real module dependency map (resolved import edges), not just counts', () => {
    const g = graphOf({
      'src/App.tsx': "import { Hero } from './components/Hero';\nimport { Footer } from './components/Footer';\nexport function App(){return null;}",
      'src/components/Hero.tsx': 'export function Hero(){return null;}',
      'src/components/Footer.tsx': 'export function Footer(){return null;}',
    });
    const doc = generateArchitectureDoc(g, analyzeArchitecture(g));
    expect(doc).toContain('# Architecture');
    expect(doc).toContain('## Module dependency map');
    // A real resolved edge from App to a component file (the differentiator vs README counts).
    expect(doc).toContain('src/App.tsx');
    expect(doc).toContain('src/components/Hero.tsx');
  });

  it('reports honest structural notes: flags an unresolved import, clean otherwise', () => {
    const bad = graphOf({ 'src/App.tsx': "import { X } from './Missing';\nexport function App(){return null;}" });
    const doc = generateArchitectureDoc(bad, analyzeArchitecture(bad));
    expect(doc).toContain('Unresolved local imports:');
    expect(doc).toMatch(/Unresolved local imports: [1-9]/);

    const clean = graphOf({ 'src/App.tsx': 'export function App(){return null;}' });
    const cleanDoc = generateArchitectureDoc(clean, analyzeArchitecture(clean));
    expect(cleanDoc).toContain('Import cycles: none');
    expect(cleanDoc).toContain('Unresolved local imports: none');
  });

  it('never throws on an empty graph', () => {
    const empty = graphOf({});
    const doc = generateArchitectureDoc(empty, analyzeArchitecture(empty));
    expect(doc).toContain('# Architecture');
    expect(typeof doc).toBe('string');
  });
});

describe('scaffold ErrorBoundary is never a false "orphan component"', () => {
  it('an ErrorBoundary imported by nobody is NOT flagged — it is scaffold boilerplate, restored and re-wired', () => {
    // When the model rewrites main.tsx and drops the import, the boundary is momentarily unimported. It
    // is ours; flagging "created but never used" was a phantom finding in real reports.
    const graph = {
      files: ['src/ErrorBoundary.tsx', 'src/App.tsx', 'src/main.tsx'],
      symbols: [
        { name: 'ErrorBoundary', file: 'src/ErrorBoundary.tsx', kind: 'class' as const },
        { name: 'App', file: 'src/App.tsx', kind: 'function' as const },
      ],
      components: ['ErrorBoundary', 'App'],
      routes: [],
      imports: { 'src/main.tsx': ['./App'] }, // note: ErrorBoundary import dropped
      dependencies: [],
      references: {},
    };
    const orphans = findOrphanComponents(graph as never);
    expect(orphans.join(' ')).not.toContain('ErrorBoundary');
  });
});
