/**
 * DOES THE APP ACTUALLY LOAD THIS FILE? (autopsy e706e068, School ERP, 2026-09-17)
 *
 * Three strays at the project root — `App.tsx`, `hooks/useStudents.ts`, `types/student.ts` — were
 * never imported by the app (`index.html → src/main.tsx → src/App.tsx`), never bundled, never
 * rendered. The readiness scan found placeholder data in the stray hook and raised it as a
 * build-breaking blocker; the incomplete-code heal spent 22 model calls "completing" it.
 *
 * Every "not applicable" case below is a case where saying "unreachable" could be FALSE — and a
 * false "unreachable" demotes a real placeholder finding, which is the unsafe direction.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeReachability,
  extractLoadSpecifiers,
  htmlEntryScripts,
  isUnreachable,
  splitByReachability,
  unreachableCodeObservation,
} from '../src/server/AgentV3/appReachability';

const SCHOOL_ERP = [
  { path: 'index.html', content: '<!doctype html><div id="root"></div><script type="module" src="/src/main.tsx"></script>' },
  { path: 'src/main.tsx', content: `import React from 'react';\nimport App from './App';\nimport './index.css';` },
  { path: 'src/App.tsx', content: `import { useStudents } from './hooks/useStudents';\nconst Fees = React.lazy(() => import('./pages/Fees'));\nexport * from './types/student';\nexport default function App() { return useStudents; }` },
  { path: 'src/hooks/useStudents.ts', content: `export function useStudents() { return []; }` },
  { path: 'src/pages/Fees.tsx', content: `export default function Fees() { return null; }` },
  { path: 'src/types/student.ts', content: `export interface Student { id: string }` },
  // The three strays the batch repair wrote at the root — nothing imports them.
  { path: 'App.tsx', content: `import { TransportRequest } from './components/TransportRequest';` },
  { path: 'hooks/useStudents.ts', content: `const mockData = [/* TODO placeholder */];\nexport function useStudents() { return mockData; }` },
  { path: 'types/student.ts', content: `export interface Student { id: string }` },
  // Tooling that the HTML never loads and that is not debris.
  { path: 'vite.config.ts', content: `export default {}` },
  { path: 'src/vite-env.d.ts', content: `/// <reference types="vite/client" />` },
  { path: 'e2e/smoke.spec.ts', content: `test('x', () => {})` },
];

describe('the School ERP tree, replayed', () => {
  const v = computeReachability(SCHOOL_ERP, { framework: 'vite-react' });

  it('is applicable and names exactly the three strays as files the app never loads', () => {
    expect(v.applicable).toBe(true);
    expect(v.unreachable).toEqual(['App.tsx', 'hooks/useStudents.ts', 'types/student.ts']);
  });

  it('reaches the real app through every edge kind — static, side-effect-free lazy import, re-export', () => {
    for (const p of ['src/main.tsx', 'src/App.tsx', 'src/hooks/useStudents.ts', 'src/pages/Fees.tsx', 'src/types/student.ts']) {
      expect(isUnreachable(v, p), p).toBe(false);
    }
  });

  it('tooling, type declarations and tests are roots — never "unreachable"', () => {
    for (const p of ['vite.config.ts', 'src/vite-env.d.ts', 'e2e/smoke.spec.ts']) expect(isUnreachable(v, p), p).toBe(false);
  });

  it('splits the fake-code findings: the stray hook is an observation, a real page stays a defect', () => {
    const findings = [
      { file: 'hooks/useStudents.ts', severity: 'high' },
      { file: 'src/pages/Fees.tsx', severity: 'high' },
      { file: undefined, severity: 'high' },
    ];
    const split = splitByReachability(findings, v);
    expect(split.unloaded.map((f) => f.file)).toEqual(['hooks/useStudents.ts']);
    expect(split.loaded.map((f) => f.file)).toEqual(['src/pages/Fees.tsx', undefined]);
    expect(unreachableCodeObservation('1 fake/incomplete code issue(s)')).toMatch(/never loads/);
  });
});

describe('not applicable — every case where "unreachable" could be false', () => {
  const base = SCHOOL_ERP.filter((f) => !/^(App\.tsx|hooks\/|types\/)/.test(f.path));

  it('a file-system-routed framework id', () => {
    expect(computeReachability(base, { framework: 'nextjs' }).applicable).toBe(false);
  });

  it('Next-style special files under app/ or pages/, whatever the framework id says', () => {
    const v = computeReachability([...base, { path: 'app/dashboard/page.tsx', content: 'export default () => null' }], { framework: 'vite-react' });
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/file-system routing/);
  });

  it('a glob import — the loaded set cannot be enumerated statically', () => {
    const withGlob = base.map((f) => f.path === 'src/App.tsx' ? { ...f, content: `${f.content}\nconst pages = import.meta.glob('./pages/*.tsx');` } : f);
    const v = computeReachability(withGlob, { framework: 'vite-react' });
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/import\.meta\.glob/);
  });

  it('no HTML entry that loads a source file', () => {
    const v = computeReachability(base.filter((f) => f.path !== 'index.html'), { framework: 'vite-react' });
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/no HTML entry/);
  });

  it('a snapshot that did not read every listed source file', () => {
    const v = computeReachability(base, { framework: 'vite-react', listedSourcePaths: [...base.map((f) => f.path), 'src/unread.ts'] });
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/not read/);
  });

  it('a conventional entry the walk failed to reach — the graph is wrong, not the app', () => {
    // index.html points at a boot file that does not import src/App.tsx at all.
    const v = computeReachability([
      { path: 'index.html', content: '<script type="module" src="/src/boot.ts"></script>' },
      { path: 'src/boot.ts', content: 'console.log(1)' },
      { path: 'src/App.tsx', content: 'export default () => null' },
    ], { framework: 'vite-react' });
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/src\/App\.tsx/);
  });

  it('a single-file-component framework', () => {
    const v = computeReachability([...base, { path: 'src/Thing.vue', content: '<template/>' }], { framework: 'vite-react' });
    expect(v.applicable).toBe(false);
  });

  it('when not applicable, nothing is ever unreachable and every finding is "loaded"', () => {
    const v = computeReachability(base, { framework: 'nextjs' });
    expect(isUnreachable(v, 'App.tsx')).toBe(false);
    expect(splitByReachability([{ file: 'App.tsx' }], v).unloaded).toEqual([]);
    expect(isUnreachable(null, 'App.tsx')).toBe(false);
  });
});

describe('extractLoadSpecifiers — every form a bundler follows', () => {
  it('finds static, side-effect, re-export, dynamic, require and worker-URL specifiers, stripping Vite queries', () => {
    const specs = extractLoadSpecifiers([
      `import a from './a';`,
      `import './b.css';`,
      `export { c } from './c';`,
      `export * from './d';`,
      `const E = lazy(() => import('./e'));`,
      `const f = require('./f');`,
      `new Worker(new URL('./g.worker.ts', import.meta.url));`,
      `import raw from './h.txt?raw';`,
    ].join('\n'));
    expect(specs).toEqual(['./a', './h.txt', './b.css', './c', './d', './e', './f', './g.worker.ts'].sort((x, y) => specs.indexOf(x) - specs.indexOf(y)));
    expect(specs).toContain('./h.txt');
    expect(specs).not.toContain('./h.txt?raw');
  });
});

describe('htmlEntryScripts', () => {
  const files = new Set(['src/main.tsx', 'client/src/main.tsx', 'client/index.html']);
  it('resolves an absolute /src path and a relative one, and ignores CDN scripts', () => {
    expect(htmlEntryScripts('index.html', '<script type="module" src="/src/main.tsx"></script><script src="https://cdn.x/y.js"></script>', files)).toEqual(['src/main.tsx']);
    expect(htmlEntryScripts('client/index.html', '<script type="module" src="./src/main.tsx"></script>', files)).toEqual(['client/src/main.tsx']);
  });
});

describe('the wiring — parsed from the CODE, comments stripped', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the readiness scan counts only the fake-code findings the app LOADS, and records the rest as an observation', () => {
    const src = strip(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8'));
    const at = src.indexOf('const loadSplit = splitByReachability(authorship.ours, reach);');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf('const complianceHigh', at));
    expect(block).toContain("const authHigh = loadSplit.loaded.filter((i) => i.severity === 'high').length;");
    expect(block).toContain("severity: 'observation'");
    expect(block).toContain('unreachableCodeObservation(');
  });

  it('the incomplete-code heal never completes a stub in a file the app does not load', () => {
    const src = strip(readFileSync('src/server/routes/agentv3.ts', 'utf8'));
    const at = src.indexOf('const stubs = highSeverityAuthenticityIssues(Object.fromEntries(writtenFiles))');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toContain('.filter((s) => !isUnreachable(dispatcher.lastReachability, s.file))');
  });
});
