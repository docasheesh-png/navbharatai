import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import ts from 'typescript';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import * as registry from '../src/server/AgentV3/runningBuildRegistry';
import * as sharedStore from '../src/server/AgentV3/sharedConversationStore';

/**
 * A ROUTE DOES NOT LOAD THE BUILD ENGINE TO READ ONE NUMBER (Q-867, 2026-10-12).
 *
 * `routes/admin.ts` needed `runningBuildCount()` for the admin load board and imported it from
 * `routes/agentv3.ts` — the build engine's route, ~1.9 MB, with its whole import graph behind it.
 * Measured under vitest: `await import('routes/admin')` took 22.0 s; the login handler it was loaded
 * for then answered 503 in 9 ms. `routesAdmin › returns 503 when ADMIN_PASSWORD env var is not set`
 * sat on its 20 s timeout and passed or failed with machine load — a module LOAD reported as a login
 * failure. Three more routes (`supabaseIntegration`, `developerApi`, `nbaiDomains`, each ~20–22 s to
 * import) reached into the same file for `getConversationStore()`.
 *
 * THIS CLASS WAS FIXED ONCE BEFORE, FOR ONE CALLER. On 2026-08-06 `routes/zipUpload` paid 6.5 s per
 * import for `buildActuator` from the same file; the fix moved that one function out
 * (`routes/actuatorFactory.ts`) and `tests/importCostGuard.test.ts` guarded the two zip files by name.
 * Nothing stopped the next route reaching for the next small thing the same way — four did. So this
 * census guards EVERY module, not a list of known offenders: a NEW importer fails here on the day it
 * is written.
 *
 * The census reads import statements with TypeScript's own pre-processor (`ts.preProcessFile`), so
 * every form counts — static, type-only, `export … from`, `import()` with a string or template, and
 * `require()` — and a comment or a string that merely mentions the path does not.
 */

const ROOT = join(__dirname, '..');
const ENGINE_ROUTE = join(ROOT, 'src/server/routes/agentv3');
const REGISTRY = join(ROOT, 'src/server/AgentV3/runningBuildRegistry');
const STORE_HOME = 'src/server/AgentV3/sharedConversationStore.ts';

/**
 * The ONLY production modules that may import the build route, each with its reason. Tests that test
 * the engine load it on purpose and are out of scope (`*.test.*` files are not scanned).
 */
const MAY_IMPORT_THE_ENGINE: Record<string, string> = {
  'server.ts': 'mounts the build route (registerAgentV3Routes) and drains its running builds on shutdown',
};

const rel = (abs: string) => relative(ROOT, abs).split('\\').join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Every production module the server or client can load: all of `src/`, `scripts/`, and `server.ts`. */
function productionModules(): string[] {
  return [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts')), join(ROOT, 'server.ts')];
}

/** Resolve an import specifier to an absolute path WITHOUT extension, or null for a package import. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = resolve(ROOT, spec.slice(2));   // tsconfig/vite alias '@' → repo root
  else return null;
  return base.replace(/\.(ts|tsx|js|mjs|cjs)$/, '');
}

/** Every specifier in `source` (as written) that resolves to `target`. PURE apart from path maths. */
function importsOf(source: string, fromFile: string, target: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles
    .map((f) => f.fileName)
    .filter((spec) => resolveSpecifier(fromFile, spec) === target);
}

describe('🔒 the census sees every import form, and nothing that is not one', () => {
  // A census that cannot see an import passes for the wrong reason — so the detector is proven first.
  const inRoutes = join(ROOT, 'src/server/routes/someRoute.ts');
  const inLib = join(ROOT, 'src/server/lib/someLib.ts');

  it.each([
    ["import { runningBuildCount } from './agentv3';", inRoutes],
    ["import type { RunningBuild } from './agentv3';", inRoutes],
    ["export { getConversationStore } from './agentv3';", inRoutes],
    ["import * as engine from './agentv3.ts';", inRoutes],
    ["async function f() { await import('./agentv3'); }", inRoutes],
    ['async function f() { await import(`./agentv3`); }', inRoutes],
    ["const engine = require('./agentv3');", inRoutes],
    ["import { getConversationStore } from '../routes/agentv3';", inLib],
    ["import { getConversationStore } from '@/src/server/routes/agentv3';", inLib],
  ])('counts %s', (source, from) => {
    expect(importsOf(source, from, ENGINE_ROUTE)).toHaveLength(1);
  });

  it.each([
    ["// import { runningBuildCount } from './agentv3';", inRoutes],
    ["/* await import('./agentv3') */", inRoutes],
    ["const note = \"import { x } from './agentv3'\";", inRoutes],
    ["import { makeResilientTurnRunner } from './agentv3Resilient';", inRoutes],
    ["import { AgentV3Panel } from './agentv3';", join(ROOT, 'src/components/Shell.tsx')],   // a different './agentv3'
    ["import { runningBuildCount } from '../AgentV3/runningBuildRegistry';", inRoutes],
  ])('does not count %s', (source, from) => {
    expect(importsOf(source, from, ENGINE_ROUTE)).toHaveLength(0);
  });
});

describe('🔒 no module loads the build engine route except the one that mounts it', () => {
  const files = productionModules();
  const importers = new Map<string, string[]>();
  for (const f of files) {
    if (rel(f) === 'src/server/routes/agentv3.ts') continue;
    const found = importsOf(readFileSync(f, 'utf8'), f, ENGINE_ROUTE);
    if (found.length) importers.set(rel(f), found);
  }

  it('the scan covers the real tree (a census of nothing would pass)', () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files.map(rel)).toContain('src/server/routes/admin.ts');
    expect(files.map(rel)).toContain('server.ts');
  });

  it('every importer of routes/agentv3 is on the allowlist, with its reason', () => {
    const unlisted = [...importers.keys()].filter((f) => !(f in MAY_IMPORT_THE_ENGINE));
    // A route that needs one small thing from the engine gets that thing a small module of its own
    // (see runningBuildRegistry.ts, sharedConversationStore.ts, actuatorFactory.ts) — it does not
    // import ~1.9 MB of build engine, paid on every import and every cold test file that loads it.
    expect(unlisted).toEqual([]);
  });

  it('every allowlisted importer really imports it (a stale entry is removed, not kept)', () => {
    for (const f of Object.keys(MAY_IMPORT_THE_ENGINE)) expect(importers.has(f)).toBe(true);
  });

  it('the four routes of Q-867 read their one fact from the small modules', () => {
    const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
    expect(read('src/server/routes/admin.ts')).toContain("import { runningBuildCount } from '../AgentV3/runningBuildRegistry';");
    for (const route of ['supabaseIntegration', 'developerApi', 'nbaiDomains']) {
      expect(read(`src/server/routes/${route}.ts`)).toContain("import { getConversationStore } from '../AgentV3/sharedConversationStore';");
    }
  });
});

describe('🔒 ONE registry and ONE store — moved, never copied', () => {
  const engine = readFileSync(`${ENGINE_ROUTE}.ts`, 'utf8');

  it('the small modules stay small: the registry imports nothing, the store only its own classes', () => {
    const specs = (p: string) => ts.preProcessFile(readFileSync(join(ROOT, p), 'utf8'), true, true).importedFiles.map((f) => f.fileName);
    expect(specs('src/server/AgentV3/runningBuildRegistry.ts')).toEqual([]);
    expect(specs(STORE_HOME).sort()).toEqual(['../lib/persistenceHealth', './ConversationStore', './FirestoreConversationStore']);
  });

  it('the build route imports the registry Map and the store accessor, and declares neither', () => {
    expect(engine).toMatch(/import \{ runningBuilds, runningBuildCount, __setRunningBuildForTest, type RunningBuild, type BuildSubscriber \} from '\.\.\/AgentV3\/runningBuildRegistry';/);
    expect(engine).toContain("import { getConversationStore } from '../AgentV3/sharedConversationStore';");
    // A second Map would leave the admin tile counting a registry no build ever enters (0 forever); a
    // second store would hide a fact written through one from a reader of the other.
    expect(engine).not.toMatch(/\b(const|let)\s+runningBuilds\s*=/);
    expect(engine).not.toMatch(/\blet\s+sharedConversationStore\b/);
    expect(engine).not.toMatch(/function\s+(runningBuildCount|getConversationStore|__setRunningBuildForTest)\s*\(/);
  });

  it('every existing importer keeps working — the names are still exported from the build route', () => {
    expect(engine).toContain('export { getConversationStore };');
    expect(engine).toContain('export { runningBuildCount, __setRunningBuildForTest };');
    expect(engine).toContain('export type { RunningBuild };');
  });

  it('only the build route WRITES the registry: no other module imports the Map itself', () => {
    const writers: string[] = [];
    for (const f of productionModules()) {
      const src = readFileSync(f, 'utf8');
      if (!importsOf(src, f, REGISTRY).length) continue;
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, false);
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        if (resolveSpecifier(f, st.moduleSpecifier.text) !== REGISTRY) continue;
        const named = st.importClause?.namedBindings;
        const names = named && ts.isNamedImports(named) ? named.elements.map((e) => (e.propertyName ?? e.name).text) : ['*'];
        if (names.includes('runningBuilds') || names.includes('*')) writers.push(rel(f));
      }
    }
    expect(writers).toEqual(['src/server/routes/agentv3.ts']);
  });

  it('the conversation store is constructed in exactly one module', () => {
    const constructs: string[] = [];
    for (const f of productionModules()) {
      const src = readFileSync(f, 'utf8');
      if (!/(Firestore|InMemory)ConversationStore\s*\(/.test(src)) continue;
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, false);
      const visit = (n: ts.Node): void => {
        if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)
          && /^(Firestore|InMemory)ConversationStore$/.test(n.expression.text)) constructs.push(rel(f));
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    // Three construction sites (Firestore, its in-memory fallback, the in-memory default), one module.
    expect([...new Set(constructs)]).toEqual([STORE_HOME]);
  });
});

describe('🔒 behaviour is identical — the route and the small modules share one live state', () => {
  // This block loads the build route itself, which is the slow import the census keeps everyone else
  // away from — hence the long hook timeout. It proves at runtime what the source checks above assert.
  let engine: typeof import('../src/server/routes/agentv3');
  const prevEnabled = process.env.AGENTV3_ENABLED;
  const prevAllow = process.env.AGENTV3_ALLOWLIST;

  beforeAll(async () => {
    process.env.VITEST = 'true';
    process.env.AGENTV3_ENABLED = 'true';
    process.env.AGENTV3_ALLOWLIST = '';
    engine = await import('../src/server/routes/agentv3');
  }, 180_000);

  afterAll(() => {
    if (prevEnabled === undefined) delete process.env.AGENTV3_ENABLED; else process.env.AGENTV3_ENABLED = prevEnabled;
    if (prevAllow === undefined) delete process.env.AGENTV3_ALLOWLIST; else process.env.AGENTV3_ALLOWLIST = prevAllow;
  });

  it('the build route hands out the very same store object the small module does', () => {
    expect(engine.getConversationStore).toBe(sharedStore.getConversationStore);
    expect(engine.getConversationStore()).toBe(sharedStore.getConversationStore());
  });

  it('a build registered in the registry module is the one the route\'s Stop finds — and the count sees it go', async () => {
    const before = registry.runningBuildCount();
    const build = { abort: new AbortController(), buffer: [], subscribers: new Set(), ended: false, startedTs: Date.now() } as registry.RunningBuild;
    registry.__setRunningBuildForTest('q867-owner', build);
    expect(registry.runningBuildCount()).toBe(before + 1);
    expect(engine.runningBuildCount()).toBe(before + 1);   // the admin tile and the route read one Map

    const stop = captureRoutes(engine.registerAgentV3Routes).get('POST /api/agentv3/stop')!;
    const res = mockRes();
    await stop(mockReq({ body: { userId: 'q867-owner' }, headers: { 'x-test-verified-uid': 'q867-owner' } }), res);
    expect(res.body?.stopped).toBe(true);
    expect(build.abort.signal.aborted).toBe(true);
    expect(registry.runningBuildCount()).toBe(before);
  });
});
