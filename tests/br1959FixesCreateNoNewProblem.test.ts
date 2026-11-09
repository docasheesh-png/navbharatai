// Autopsy BR1959 — SIDE-EFFECT REVIEW (owner rule 2026-11-09: no fix may create another problem).
// Each BR1959 fix has its own target test. These hold the NEIGHBOURING behaviour each fix could have
// disturbed: the build lanes it does not target, apps that never had the defect, the existing guards, and
// phone and desktop layouts. Where the review found a real risk, the fix was narrowed (F1 manifest
// attribution, F2 project-ambient globals, F5 confidence charge), and the narrowing is pinned here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fastLaneDependencyPlan, fastLaneDependencyInstallCommand } from '../src/server/AgentV3/fastLaneDependencies';
import { addMissingProjectImports, fixSelfShadowedImports } from '../src/server/AgentV3/ImportExportReconcile';
import { scanAuthenticity, authenticityConfidenceCount, authenticitySummary } from '../src/server/AgentV3/AuthenticityAnalysis';
import { computeBuildConfidence } from '../src/server/AgentV3/BuildConfidence';
import { routeFromRouter } from '../src/server/AgentV3/journeyDerivation';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';

const ROUTE = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');
const DISPATCHER = readFileSync(new URL('../src/server/AgentV3/ToolDispatcher.ts', import.meta.url), 'utf8');

describe('F1 — the fast-lane dependency reconcile disturbs nothing it does not fix', () => {
  const PKG = JSON.stringify({ name: 'app', dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', 'react-router-dom': '^6.22.0' }, devDependencies: { typescript: '^5.4.0', vite: '^5.2.0' } });
  const APP = "import React from 'react';\nimport { BrowserRouter } from 'react-router-dom';\nimport Home from './pages/Home';\nimport { cn } from '@/lib/utils';\nimport fs from 'node:fs';\nexport default () => null;\n";

  it('an app that already declares every import: no write, no install, on any verify round (idempotent)', () => {
    for (const plan of [fastLaneDependencyPlan({ 'src/App.tsx': APP }, PKG), fastLaneDependencyPlan({ 'package.json': PKG, 'src/App.tsx': APP }, null)]) {
      expect(plan.packageJson).toBeNull();
      expect(plan.pinned).toEqual([]);
      expect(plan.unpinned).toEqual([]);
      expect(fastLaneDependencyInstallCommand(plan)).toBeNull();
    }
  });

  it('relative imports, `@/` path aliases and node builtins are never installed', () => {
    const plan = fastLaneDependencyPlan({ 'src/App.tsx': APP }, JSON.stringify({ dependencies: { react: '^18.3.1' } }));
    expect(plan.unpinned).not.toContain('@/lib');
    expect([...plan.unpinned, ...plan.pinned.map((p) => p.package)].some((n) => n.startsWith('.') || n.startsWith('@/') || n.startsWith('node:') || n === 'fs')).toBe(false);
  });

  it('a pinned addition never removes or changes a declared dependency, script or field', () => {
    const before = { name: 'app', private: true, scripts: { dev: 'vite', build: 'tsc && vite build' }, dependencies: { react: '^18.3.1', zustand: '4.5.0' }, devDependencies: { vite: '^5.2.0' } };
    const plan = fastLaneDependencyPlan({ 'src/App.tsx': APP }, JSON.stringify(before));
    const after = JSON.parse(plan.packageJson ?? JSON.stringify(before));
    for (const [k, v] of Object.entries(before.dependencies)) expect(after.dependencies[k]).toBe(v);
    expect(after.devDependencies).toEqual(before.devDependencies);
    expect(after.scripts).toEqual(before.scripts);
    expect(after.private).toBe(true);
  });

  it('narrowed: a scaffold manifest read from DISK is never credited to the build as a file it wrote', () => {
    expect(ROUTE).toContain("if (plan.manifest === 'written' && laneManifest !== null) writtenFiles.set('package.json', laneManifest);");
  });

  it('existing lane guards are untouched: import/edit/module turns never reach it; writes go through the fenced platform writer', () => {
    expect(ROUTE).toMatch(/const fastLaneWouldRun = [^\n]*intent === 'new_build'[^\n]*!projectModuleRef && !isImportTurn;/);
    const body = ROUTE.slice(ROUTE.indexOf('const fastReconcileDependencies = async'), ROUTE.indexOf('const fastPreview = async'));
    expect(body).toContain('await fastWrite(pkgWrite)');   // the lane's write fence (refused after hand-off / Stop)
    expect(body).not.toMatch(/actuator\.writeFile|writePlatform\(/); // no second, unfenced writer
    expect(body).toContain('catch { /* best-effort');       // a failure leaves the compile check to report as before
  });
});

describe('F2 — the type-import arm never rebinds a reference that already compiled', () => {
  const TYPES = { 'src/types.ts': 'export interface Student { id: string }\n' };
  const USE = { 'src/utils/api.ts': 'export const list = async (): Promise<Student[]> => [];\n' };

  it('narrowed: a name the project declares in `declare global` is imported only on the compiler\'s TS2304 proof', async () => {
    const files = { ...TYPES, ...USE, 'src/env.ts': 'export {};\ndeclare global { interface Student { id: string; legacy: true } }\n' };
    expect((await addMissingProjectImports(files)).added.filter((a) => a.name === 'Student')).toEqual([]);
    const proven = await addMissingProjectImports(files, { unresolvedNames: ['Student'] });
    expect(proven.added.map((a) => a.name)).toContain('Student');
  });

  it('narrowed: a name declared in a script-style .d.ts (no import/export) is left alone without proof', async () => {
    const files = { ...TYPES, ...USE, 'src/globals.d.ts': 'interface Student { id: string }\n' };
    expect((await addMissingProjectImports(files)).added.filter((a) => a.name === 'Student')).toEqual([]);
  });

  it('a value use is never turned into a type import, and an already-imported type is not imported twice', async () => {
    const already = { ...TYPES, 'src/utils/api.ts': "import type { Student } from '../types';\nexport const list = async (): Promise<Student[]> => [];\n" };
    expect((await addMissingProjectImports(already)).added).toEqual([]);
    const valueOnly = { 'src/types.ts': 'export interface Student { id: string }\n', 'src/a.ts': 'export const n = typeof Student;\n' };
    expect((await addMissingProjectImports(valueOnly)).added.filter((a) => a.statement.startsWith('import type'))).toEqual([]);
  });
});

describe('F3 — the self-shadow fix touches only a recursion that can never stop', () => {
  const API = { 'src/utils/api.ts': 'export const fetchItems = async (): Promise<string[]> => [];\n' };
  it('a nested same-named function that does not call itself is untouched', async () => {
    const hook = "import { fetchItems } from '../utils/api';\nexport function useItems() {\n  const fetchItems = async () => { return ['local']; };\n  return { fetchItems };\n}\n";
    expect((await fixSelfShadowedImports({ ...API, 'src/hooks/useItems.ts': hook })).fixes).toEqual([]);
  });
  it('a file that USES the import is untouched, even with a shadowing local elsewhere', async () => {
    const hook = "import { fetchItems } from '../utils/api';\nexport const top = () => fetchItems();\nexport function useItems() {\n  const fetchItems = async (): Promise<any> => { return await fetchItems(); };\n  return { fetchItems };\n}\n";
    expect((await fixSelfShadowedImports({ ...API, 'src/hooks/useItems.ts': hook })).fixes).toEqual([]);
  });
  it('an import from a package (not a project module) is untouched', async () => {
    const hook = "import { useQuery } from '@tanstack/react-query';\nexport function useThing() {\n  const useQuery = () => useQuery();\n  return useQuery;\n}\n";
    expect((await fixSelfShadowedImports({ 'src/hooks/useThing.ts': hook })).fixes).toEqual([]);
  });
});

describe('F5 — reporting every log-only handler does not swing the agent\'s confidence score', () => {
  const many = (n: number) => ['export function Page() {', ...Array.from({ length: n }, (_, i) => [`  const h${i} = () => {`, `    console.log('h${i}');`, '  };']).flat(), '  return null;', '}', ''].join('\n');
  it('narrowed: eight placeholder handlers in one file charge the score exactly what one did before', () => {
    const eight = scanAuthenticity('src/App.tsx', many(8));
    expect(eight.filter((i) => i.kind === 'empty-handler')).toHaveLength(8);    // all listed (the fix)
    expect(authenticityConfidenceCount(eight)).toBe(authenticityConfidenceCount(scanAuthenticity('src/App.tsx', many(1))));
    expect(authenticitySummary(eight)).toContain('8 issue(s)');
    expect(DISPATCHER).toContain('authenticity: authenticityConfidenceCount(issues)');
  });
  it('two files are still charged once each; other kinds are still charged per finding', () => {
    const issues = [...scanAuthenticity('src/A.tsx', many(3)), ...scanAuthenticity('src/B.tsx', many(2))];
    expect(authenticityConfidenceCount(issues)).toBe(2);
    const other = [{ file: 'a', line: 1, kind: 'todo', severity: 'medium' }, { file: 'a', line: 2, kind: 'todo', severity: 'medium' }] as any;
    expect(authenticityConfidenceCount(other)).toBe(2);
  });
  it('empty-handler is medium: it never enters the high-severity stub heal (no new paid repair)', () => {
    expect(scanAuthenticity('src/App.tsx', many(4)).every((i) => i.kind !== 'empty-handler' || i.severity === 'medium')).toBe(true);
  });
  it('an effect with a dependency list, or a handler that does real work, is not reported', () => {
    const src = "export function P() {\n  useEffect(() => {\n    console.log('mounted');\n  }, []);\n  const save = () => {\n    console.log('saving');\n    api.save();\n  };\n  return <form onSubmit={(e) => {\n    e.preventDefault(); save();\n  }} />;\n}\n";
    expect(scanAuthenticity('src/P.tsx', src).filter((i) => i.kind === 'empty-handler')).toEqual([]);
  });
  it('the score input for a file with one handler is unchanged from before BR1959', () => {
    const one = scanAuthenticity('src/App.tsx', many(1));
    expect(authenticityConfidenceCount(one)).toBe(one.length);
    expect(typeof computeBuildConfidence).toBe('function');
  });
});

describe('F6 — reading through a route guard maps nothing that was not the page', () => {
  const files = (route: string) => ({ 'src/App.tsx': `import Page from './pages/Page';\nimport Layout from './Layout';\nexport default () => (<Routes>${route}</Routes>);\n`, 'src/pages/Page.tsx': 'export default () => null;\n' });
  it('a Suspense with a JSX fallback is still not read through (behaviour unchanged)', () => {
    expect(routeFromRouter('src/pages/Page.tsx', files('<Route path="/p" element={<Suspense fallback={<Spinner />}><Page /></Suspense>} />'))).not.toBe('/p');
  });
  it('a self-closing layout element is never the page of its route', () => {
    expect(routeFromRouter('src/pages/Page.tsx', files('<Route path="/p" element={<Layout />} />'))).not.toBe('/p');
  });
  it('a page rendered as a CHILD of something rendered first is not claimed', () => {
    expect(routeFromRouter('src/pages/Page.tsx', files('<Route path="/p" element={<Banner /><Page />} />'))).not.toBe('/p');
  });
  it('an unwrapped page still maps exactly as before', () => {
    expect(routeFromRouter('src/pages/Page.tsx', files('<Route path="/p" element={<Page />} />'))).toBe('/p');
  });
  it('a guarded page whose guard redirects stays UNREACHABLE, never FAILED: the runner only fails after a submit', () => {
    const src = readFileSync(new URL('../src/server/AgentV3/journeyDerivation.ts', import.meta.url), 'utf8');
    const runner = src.slice(src.indexOf("verdict: 'unreachable', step: 'load'"));
    const firstFailed = runner.indexOf("out.verdict = 'failed'");
    expect(firstFailed).toBeGreaterThan(runner.indexOf("out.step = 'submit'"));
  });
});

describe('F4 — the kit change moves nothing in a header that already fit', () => {
  // Measured (local evidence, headless Chrome, iframes at 390/768/1280 px): the shop header, a simple header
  // and a search-in-actions header render pixel-identically before and after; only an action row wider than
  // the screen changes (783/405 px of sideways scroll → 0). These pin that the neighbours' rules are untouched.
  const rule = (sel: string) => { const at = DESIGN_KIT_CSS.indexOf(`\n${sel} {`); return DESIGN_KIT_CSS.slice(at + 1, DESIGN_KIT_CSS.indexOf('}', at) + 1); };
  it('the header, brand, search and chip rules are exactly what they were', () => {
    expect(rule('.nb-header')).toBe('.nb-header { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 16px; background: color-mix(in srgb, var(--card) 90%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }');
    expect(rule('.nb-search')).toBe('.nb-search { flex: 1 1 220px; min-width: 0; border-radius: 999px; padding-left: 16px; background: color-mix(in srgb, var(--fg) 5%, var(--card)); }');
    expect(rule('.nb-chip')).toBe('.nb-chip { flex: none; min-height: 36px; padding: 4px 16px; border: 1px solid var(--border); border-radius: 999px; background: var(--card); color: var(--fg); font-weight: 600; white-space: nowrap; }');
  });
  it('the two changed rules only ADD shrink/wrap permissions; every earlier declaration is kept', () => {
    expect(rule('.nb-header-actions')).toBe('.nb-header-actions { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; min-width: 0; max-width: 100%; }');
    expect(rule('.nb-chips')).toBe('.nb-chips { display: flex; gap: 8px; overflow-x: auto; min-width: 0; max-width: 100%; padding: 4px 0; scrollbar-width: none; }');
  });
});
