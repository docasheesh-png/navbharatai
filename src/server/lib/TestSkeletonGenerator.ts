// P-CGE.4 — Test Generation Suite (skeletons).
//
// Pure, dependency-free generators that emit runnable Vitest test SKELETONS from declarative
// input: unit tests for functions, integration tests for routes (supertest), and vi.fn mocks.
//
// HONESTY: these are starter scaffolds, not finished tests. Each generated `it(...)` contains a
// smoke assertion plus an explicit `// TODO: assert real behaviour` marker — the generator never
// emits a fake passing assertion that pretends to verify logic it doesn't. The output is real,
// valid, runnable boilerplate that a developer (or a follow-up AI pass) completes.

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
    const args = (f.params || []).map((p) => `/* ${ident(p)} */ undefined`).join(', ');
    const awaitKw = f.async ? 'await ' : '';
    const asyncKw = f.async ? 'async ' : '';
    lines.push(
      `describe('${name}', () => {`,
      `  it('works for a basic case', ${asyncKw}() => {`,
      `    const result = ${awaitKw}${name}(${args});`,
      '    expect(result).toBeDefined();',
      '    // TODO: assert real behaviour',
      '  });',
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
      const status = typeof r.expectStatus === 'number' ? r.expectStatus : 200;
      lines.push(
        `  it('${method.toUpperCase()} ${path}', async () => {`,
        `    const res = await request(app).${method}('${path}');`,
        `    expect(res.status).toBe(${status});`,
        '    // TODO: assert the response body',
        '  });',
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
