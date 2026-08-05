// P-CGE.4 — Test Generation Suite (skeletons).
//
// Pure, dependency-free generators that emit runnable Vitest test SKELETONS from declarative
// input: unit tests for functions, integration tests for routes (supertest), and vi.fn mocks.
//
// HONESTY, AND THE BUG IT USED TO HAVE (ROADMAP #1 Phase 4.4). These are starter scaffolds, and the
// generator never emits a fake passing assertion. But "not fake" was not enough: it used to CALL each
// function with `undefined` for every argument and assert `expect(result).toBeDefined()`, and it hit
// every route expecting exactly 200. For most real code that FAILS — a function that needs arguments
// throws, a void function returns undefined, a POST without a body answers 400, a guarded route
// answers 401. So the user's brand-new app shipped with a RED test suite for code that was correct,
// which teaches them their own tests cannot be trusted. A suite nobody trusts is worse than no suite.
//
// The rule now: assert only what is TRUE BY CONSTRUCTION, and express the unknown part with vitest's
// own pending mechanism (`it.todo`), which reports as PENDING — never as passed, never as failed.
// What is left is still real: `expect(typeof fn).toBe('function')` genuinely catches a broken import
// or a renamed export, and `expect(res.status).not.toBe(404)` genuinely catches a route that was
// never mounted. Both are the actual bugs a smoke test exists to find.

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const ident = (s: string): string => clean(s).replace(/[^A-Za-z0-9_$]/g, '') || 'value';

export interface FunctionDef {
  name: string;
  /** Parameter names (used to scaffold the call). */
  params?: string[];
  async?: boolean;
}

/** Generate a Vitest unit-test skeleton for a module's functions. */
export function generateUnitTest(input: { modulePath: string; functions: FunctionDef[] }): string {
  const modulePath = clean(input.modulePath) || './module';
  const fns = (input.functions || []).filter((f) => clean(f.name));
  const names = fns.map((f) => ident(f.name));
  const importNames = names.length ? `{ ${[...new Set(names)].join(', ')} }` : '{}';
  const lines: string[] = [
    "import { describe, it, expect } from 'vitest';",
    `import ${importNames} from '${modulePath}';`,
    '',
  ];
  if (fns.length === 0) {
    lines.push(`describe('${modulePath}', () => {`, "  it.todo('add tests');", '});', '');
    return lines.join('\n');
  }
  for (const f of fns) {
    const name = ident(f.name);
    // The export exists and is callable. Small, but genuinely true and genuinely useful: this is the
    // assertion that goes red when someone renames or removes the export, which is the single most
    // common way a module quietly breaks its callers.
    lines.push(
      `describe('${name}', () => {`,
      "  it('is exported and callable', () => {",
      `    expect(typeof ${name}).toBe('function');`,
      '  });',
      '',
      `  // Fill this in with a real case: call ${name} with real arguments and assert what it should`,
      '  // return or do. Until then vitest reports it as pending, so it is never mistaken for passing.',
      `  it.todo('${name} — assert real behaviour with real arguments');`,
      '});',
      '',
    );
  }
  return lines.join('\n');
}

export interface RouteDef {
  method: string;
  path: string;
  expectStatus?: number;
}

/** Generate a supertest-based integration-test skeleton for a set of routes. */
export function generateIntegrationTest(input: { appImport?: string; routes: RouteDef[] }): string {
  const appImport = clean(input.appImport) || "import app from '../app';";
  const routes = (input.routes || []).filter((r) => clean(r.method) && clean(r.path));
  const lines: string[] = [
    "import { describe, it, expect } from 'vitest';",
    "import request from 'supertest';",
    appImport,
    '',
    "describe('API routes', () => {",
  ];
  if (routes.length === 0) {
    lines.push("  it.todo('add route tests');");
  } else {
    for (const r of routes) {
      const method = clean(r.method).toLowerCase();
      const path = clean(r.path);
      const expected = typeof r.expectStatus === 'number' ? r.expectStatus : null;
      // A generated test must not RUN the app's own mutations. Someone running their suite against a
      // dev database would have this create or delete real rows they never asked to touch, and a
      // scaffold is not worth that. Non-GET routes get a pending test to fill in deliberately.
      if (method !== 'get' && method !== 'head') {
        lines.push(`  it.todo('${method.toUpperCase()} ${path} — write this one yourself: it changes data');`);
        continue;
      }
      lines.push(
        `  it('${method.toUpperCase()} ${path} is mounted', async () => {`,
        `    const res = await request(app).${method}('${path}');`,
        expected !== null
          // An explicit expectation came from the caller, so honour it exactly.
          ? `    expect(res.status).toBe(${expected});`
          // Otherwise assert only what is true for ANY mounted route. Demanding 200 would fail a
          // guarded route (401) or one that wants a query (400) — correct code, red test.
          : '    expect(res.status).not.toBe(404);',
        '  });',
        `  it.todo('${method.toUpperCase()} ${path} — assert the response body');`,
      );
    }
  }
  lines.push('});', '');
  return lines.join('\n');
}

/** Generate a vi.fn()-based mock object for an injected dependency. */
export function generateMock(input: { name: string; methods?: string[] }): string {
  const name = ident(input.name) || 'dependency';
  const methods = (input.methods || []).map(ident).filter(Boolean);
  const lines: string[] = ["import { vi } from 'vitest';", '', `export const ${name}Mock = {`];
  if (methods.length === 0) {
    lines.push('  // TODO: add mocked methods');
  } else {
    for (const m of methods) lines.push(`  ${m}: vi.fn(),`);
  }
  lines.push('};', '');
  return lines.join('\n');
}

export interface TestGenInput {
  unit?: { modulePath: string; functions: FunctionDef[] };
  integration?: { appImport?: string; routes: RouteDef[] };
  mock?: { name: string; methods?: string[] };
}

export interface TestGenOutput {
  unit?: string;
  integration?: string;
  mock?: string;
}

/** Generate whatever test scaffolds the input supports. Pure. */
export function generateTests(input: TestGenInput): TestGenOutput {
  const out: TestGenOutput = {};
  if (input.unit && Array.isArray(input.unit.functions)) out.unit = generateUnitTest(input.unit);
  if (input.integration && Array.isArray(input.integration.routes)) out.integration = generateIntegrationTest(input.integration);
  if (input.mock && clean(input.mock.name)) out.mock = generateMock(input.mock);
  return out;
}
