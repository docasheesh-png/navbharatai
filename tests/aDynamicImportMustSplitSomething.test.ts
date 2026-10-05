// A DYNAMIC IMPORT MUST SPLIT SOMETHING (Q-625, forensic audit 2026-10-04).
//
// `import('./x')` exists for one reason: to keep `x` out of the startup download until it is needed.
// That only works when NOTHING in the startup graph imports `x` statically. When something does, `x`
// is downloaded and evaluated at startup anyway, the `import()` moves nothing, and the build says so:
//
//   [INEFFECTIVE_DYNAMIC_IMPORT] src/lib/nativeShell.ts is dynamically imported by src/App.tsx but
//   also statically imported by src/App.tsx, src/main.tsx, … dynamic import will not move module into
//   another chunk.
//
// Five such warnings printed on every build, and the census below found 36 call sites of the class:
// six of local modules (nativeShell, mobileNative, firebase, authedFetch, HistoryView,
// ProfessionalHistoryView) and thirty of `@capacitor/core`, `@capacitor/browser`, `firebase/auth` and
// `firebase/app`, each `await import()`ed while `main.tsx` had already loaded them. (The audit also
// named buildService and agentV3StreamError: those are `import('./x').SomeType` TYPE positions, which
// emit no code — not the class, and not counted here.)
// The cost was not only bundle hygiene: every such `await` is a free yield in the middle of a click
// handler, which is exactly how Apple sign-in once lost its popup (see nativePolish.test.ts).
//
// 🔒 THE RULE THIS FILE ENFORCES. Walk the client graph from the real entry (`index.html` → main.tsx).
// The EAGER set is everything reachable from it through STATIC imports alone — what a user downloads
// before the first paint. A dynamic `import()` of a module in the eager set is a violation: convert it
// to a static import (it costs nothing — it is already loaded), or make every static importer lazy.
//
// ⚠️ WHAT IT DELIBERATELY ALLOWS. A module that is `import()`ed by one screen and statically imported by
// ANOTHER LAZY chunk (PreviewSurface, FilesPanel, TerminalPanel, the legal grievance page) is a WORKING
// split: the bundler puts it in a shared lazy chunk and neither route pays for it at startup. The audit
// listed those three panels too; making their static importers lazy would only add a second loading
// spinner inside the builder, so they are left exactly as they are and this census does not flag them.
//
// Limits, stated so nobody over-trusts it: specifiers are resolved for relative paths and the `@/`
// alias; a bare package is keyed by its exact specifier (`firebase/auth` and `firebase/app` are
// different); node_modules are not walked. A value import used only as a type counts as static (the
// bundler would elide it) — if that ever flags a module, write `import type`, which is right anyway.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '..');

export interface ImportEdge { spec: string; kind: 'static' | 'dynamic' }

/** Every runtime import in one source file. Type-only imports and `import('x').T` types are not edges. */
export function importEdges(fileName: string, text: string): ImportEdge[] {
  const src = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true,
    /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: ImportEdge[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : null;
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!named && named.length > 0 && named.every((e) => e.isTypeOnly)));
      if (!typeOnly) out.push({ spec: n.moduleSpecifier.text, kind: 'static' });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) out.push({ spec: n.moduleSpecifier.text, kind: 'static' });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) out.push({ spec: arg.text, kind: 'dynamic' });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

export interface SourceHost { read(path: string): string; isFile(path: string): boolean }

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

/** A local file path, `pkg:<specifier>` for a bare package, or null when it cannot be resolved. */
function resolveSpec(host: SourceHost, root: string, spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec.startsWith('@/')) base = resolve(root, spec.slice(2));
  else if (spec.startsWith('/')) return null;
  else return `pkg:${spec}`;
  for (const ext of EXTENSIONS) if (host.isFile(base + ext)) return base + ext;
  return null;
}

const isSource = (p: string): boolean => !p.startsWith('pkg:') && /\.[jt]sx?$/.test(p);

export interface Violation { module: string; dynamicImporters: string[] }

/** The census: every module that is `import()`ed although the startup graph already imports it statically. */
export function ineffectiveDynamicImports(host: SourceHost, root: string, entry: string): { violations: Violation[]; reached: number } {
  const edges = new Map<string, { target: string; kind: ImportEdge['kind'] }[]>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (edges.has(file)) continue;
    const list = importEdges(file, host.read(file))
      .map((e) => ({ target: resolveSpec(host, root, e.spec, file), kind: e.kind }))
      .filter((e): e is { target: string; kind: ImportEdge['kind'] } => e.target !== null);
    edges.set(file, list);
    for (const e of list) if (isSource(e.target) && !edges.has(e.target)) queue.push(e.target);
  }
  const eager = new Set<string>();
  const walk = [entry];
  while (walk.length) {
    const file = walk.pop()!;
    if (eager.has(file)) continue;
    eager.add(file);
    for (const e of edges.get(file) ?? []) if (e.kind === 'static' && !eager.has(e.target)) {
      if (isSource(e.target)) walk.push(e.target); else eager.add(e.target);
    }
  }
  const dynamicImporters = new Map<string, Set<string>>();
  for (const [file, list] of edges) for (const e of list) if (e.kind === 'dynamic' && eager.has(e.target)) {
    if (!dynamicImporters.has(e.target)) dynamicImporters.set(e.target, new Set());
    dynamicImporters.get(e.target)!.add(relative(root, file));
  }
  const name = (p: string): string => (p.startsWith('pkg:') ? p.slice(4) : relative(root, p));
  const violations = [...dynamicImporters].map(([m, by]) => ({ module: name(m), dynamicImporters: [...by].sort() }))
    .sort((a, b) => a.module.localeCompare(b.module));
  return { violations, reached: edges.size };
}

const diskHost: SourceHost = {
  read: (p) => readFileSync(p, 'utf8'),
  isFile: (p) => existsSync(p) && statSync(p).isFile(),
};

function fixtureHost(files: Record<string, string>): SourceHost {
  return { read: (p) => files[p] ?? '', isFile: (p) => p in files };
}

describe('the census logic (fixtures)', () => {
  const R = '/app';
  const run = (files: Record<string, string>) => ineffectiveDynamicImports(fixtureHost(files), R, `${R}/src/main.tsx`).violations;

  it('🔴 a module imported statically at startup AND import()ed is a violation (the nativeShell shape)', () => {
    const v = run({
      '/app/src/main.tsx': "import './App';\nimport { a } from './lib/a';",
      '/app/src/App.tsx': "export async function f() { const { a } = await import('./lib/a'); return a; }",
      '/app/src/lib/a.ts': 'export const a = 1;',
    });
    expect(v).toEqual([{ module: 'src/lib/a.ts', dynamicImporters: ['src/App.tsx'] }]);
  });

  it('🔴 the same holds for a bare package (the @capacitor/browser shape)', () => {
    const v = run({
      '/app/src/main.tsx': "import { Browser } from '@capacitor/browser';\nimport './x';",
      '/app/src/x.ts': "void import('@capacitor/browser');",
    });
    expect(v).toEqual([{ module: '@capacitor/browser', dynamicImporters: ['src/x.ts'] }]);
  });

  it('a module import()ed by one screen and statically imported by another LAZY chunk is a working split', () => {
    const v = run({
      '/app/src/main.tsx': "const P = () => import('./Preview');\nconst S = () => import('./Studio');",
      '/app/src/Studio.tsx': "import { Preview } from './Preview';",
      '/app/src/Preview.tsx': 'export const Preview = 1;',
    });
    expect(v).toEqual([]);
  });

  it('eagerness is transitive: a module reached statically through two hops is still at startup', () => {
    const v = run({
      '/app/src/main.tsx': "import './a';\nvoid import('./c');",
      '/app/src/a.ts': "export * from './b';",
      '/app/src/b.ts': "import './c';",
      '/app/src/c.ts': '',
    });
    expect(v.map((x) => x.module)).toEqual(['src/c.ts']);
  });

  it('type-only imports and import() TYPES are not runtime edges', () => {
    const v = run({
      '/app/src/main.tsx': "import type { T } from './t';\nimport { type U } from './u';\nlet x: import('./v').V;\nvoid import('./t'); void import('./u'); void import('./v');",
      '/app/src/t.ts': 'export type T = 1;',
      '/app/src/u.ts': 'export type U = 1;',
      '/app/src/v.ts': 'export type V = 1;',
    });
    expect(v).toEqual([]);
  });

  it('the `@/` alias resolves to the repo root', () => {
    const v = run({
      '/app/src/main.tsx': "import '@/src/a';\nvoid import('./a');",
      '/app/src/a.ts': '',
    });
    expect(v.map((x) => x.module)).toEqual(['src/a.ts']);
  });
});

describe('🔒 the real client graph', () => {
  it('the census starts from the entry index.html really loads', () => {
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).toMatch(/<script type="module" src="\/src\/main\.tsx"><\/script>/);
  });

  it('no module is import()ed while the startup graph already imports it statically', () => {
    const { violations, reached } = ineffectiveDynamicImports(diskHost, ROOT, join(ROOT, 'src/main.tsx'));
    // Proof the walk covered the app, not one file: the client graph is several hundred modules.
    expect(reached).toBeGreaterThan(400);
    const report = violations.map((v) => `${v.module} — import()ed by ${v.dynamicImporters.join(', ')}, but already loaded at startup`);
    expect(report, 'Convert each import() above to a static import, or make every static importer lazy.').toEqual([]);
  });
});
