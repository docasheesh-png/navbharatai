// Roadmap "BUILD NOW #14" — real integration-test + working-mock generator.
//
// The existing generate_tests (TestSkeletonGenerator.ts) emits SKELETONS with `// TODO: assert real
// behaviour` markers — honest, but not finished tests. This closes that gap for the most common backend
// shape: a REST resource. It emits a full create → read → update → delete → 404 lifecycle integration test
// with REAL assertions on real response bodies (no TODO placeholders), PLUS a working in-memory reference
// app the test runs against — so the generated suite is GREEN out of the box, then the developer points it
// at their own Express app by swapping one import. "Working mocks, not stubs": the reference app is real
// CRUD over an in-memory store with genuine validation, not a vi.fn() that pretends. Pure builder → the
// caller writes the files. No API key needed.

export interface IntegrationTestField {
  name: string;
  type?: 'string' | 'number' | 'boolean';
}

export interface IntegrationTestConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const ident = (s: string): string => clean(s).replace(/[^A-Za-z0-9_$]/g, '') || 'value';
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

type FieldType = 'string' | 'number' | 'boolean';
const normalizeType = (t: unknown): FieldType =>
  t === 'number' || t === 'boolean' ? t : 'string';

/** A JS literal sample value for a field type; variant 'a' = create value, 'b' = update value. */
function sampleLiteral(type: FieldType, variant: 'a' | 'b'): string {
  if (type === 'number') return variant === 'a' ? '10' : '20';
  if (type === 'boolean') return variant === 'a' ? 'true' : 'false';
  return variant === 'a' ? "'Alpha'" : "'Beta'";
}

/** The runtime typeof-guard expression the reference app uses to validate the required field. */
function typeGuard(type: FieldType, ref: string): string {
  if (type === 'number') return `typeof ${ref} !== 'number' || Number.isNaN(${ref})`;
  if (type === 'boolean') return `typeof ${ref} !== 'boolean'`;
  return `typeof ${ref} !== 'string' || !${ref}.trim()`;
}

function tsType(type: FieldType): string {
  return type;
}

interface Resolved {
  resource: string; // singular ident, e.g. "product"
  route: string; // base route, e.g. "/products"
  fields: Array<{ name: string; type: FieldType }>;
}

function resolve(input: { resource?: string; basePath?: string; fields?: IntegrationTestField[] }): Resolved {
  const resource = ident(clean(input.resource) || 'item').toLowerCase();
  const defaultRoute = '/' + resource + (resource.endsWith('s') ? '' : 's');
  let route = clean(input.basePath) || defaultRoute;
  if (!route.startsWith('/')) route = '/' + route;
  route = route.replace(/\/+$/, '') || defaultRoute;
  let fields = (input.fields || [])
    .map((f) => ({ name: ident(f.name), type: normalizeType(f.type) }))
    .filter((f) => f.name && f.name !== 'value');
  // De-duplicate by name (first wins) and never collide with the reserved id/createdAt.
  const seen = new Set<string>(['id', 'createdAt']);
  fields = fields.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
  if (fields.length === 0) fields = [{ name: 'name', type: 'string' }];
  return { resource, route, fields };
}

/** The real, working in-memory CRUD app the integration test targets. */
function referenceApp(r: Resolved): string {
  const Name = cap(r.resource);
  const required = r.fields[0];
  const fieldTypeLines = r.fields.map((f) => `  ${f.name}: ${tsType(f.type)};`).join('\n');
  const echoLines = r.fields.map((f) => `      ${f.name}: body.${f.name},`).join('\n');
  const updateLines = r.fields
    .map(
      (f) =>
        `    if (body.${f.name} !== undefined) row.${f.name} = body.${f.name} as ${tsType(f.type)};`,
    )
    .join('\n');
  const requiredMsg = `${required.name} is required`;

  return `import express, { type Express, type Request, type Response } from 'express';

// A REAL, working in-memory ${r.resource} CRUD app used as the integration-test target. It is NOT a stub:
// every route implements genuine create / read / update / delete over an in-memory store with real
// validation, so the generated integration test runs GREEN out of the box. To test YOUR real backend
// instead, swap the import in ${r.resource}.integration.test.ts for your own Express app and delete this file.

export interface ${Name} {
  id: string;
${fieldTypeLines}
  createdAt: string;
}

export function createInMemory${Name}App(): Express {
  const app = express();
  app.use(express.json());

  const store = new Map<string, ${Name}>();
  let seq = 0;

  // Create
  app.post('${r.route}', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ${required.name} = body.${required.name};
    if (${typeGuard(required.type, required.name)}) {
      return res.status(400).json({ error: '${requiredMsg}' });
    }
    const row: ${Name} = {
      id: String(++seq),
${echoLines}
      createdAt: new Date().toISOString(),
    } as ${Name};
    store.set(row.id, row);
    return res.status(201).json(row);
  });

  // List
  app.get('${r.route}', (_req: Request, res: Response) => {
    return res.status(200).json([...store.values()]);
  });

  // Read one
  app.get('${r.route}/:id', (req: Request, res: Response) => {
    const row = store.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.status(200).json(row);
  });

  // Update
  app.put('${r.route}/:id', (req: Request, res: Response) => {
    const row = store.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    const body = (req.body ?? {}) as Record<string, unknown>;
${updateLines}
    store.set(row.id, row);
    return res.status(200).json(row);
  });

  // Delete
  app.delete('${r.route}/:id', (req: Request, res: Response) => {
    if (!store.has(req.params.id)) return res.status(404).json({ error: 'not found' });
    store.delete(req.params.id);
    return res.status(204).end();
  });

  return app;
}
`;
}

/** The full-lifecycle integration test with REAL assertions (no TODO placeholders). */
function integrationTest(r: Resolved): string {
  const Name = cap(r.resource);
  const createBody = '{ ' + r.fields.map((f) => `${f.name}: ${sampleLiteral(f.type, 'a')}`).join(', ') + ' }';
  const updateBody = '{ ' + r.fields.map((f) => `${f.name}: ${sampleLiteral(f.type, 'b')}`).join(', ') + ' }';
  const createAsserts = r.fields
    .map((f) => `    expect(created.body.${f.name}).toBe(${sampleLiteral(f.type, 'a')});`)
    .join('\n');
  const updateAsserts = r.fields
    .map((f) => `    expect(updated.body.${f.name}).toBe(${sampleLiteral(f.type, 'b')});`)
    .join('\n');

  return `import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createInMemory${Name}App } from './support/inMemory${Name}App';

// Full-lifecycle integration test for the ${r.resource} resource: create -> list -> read -> update ->
// delete -> 404. These are REAL assertions on real response bodies (not placeholder stubs). The suite runs
// green against the in-memory reference app; point \`app\` at your own Express app to test the real backend.

describe('${r.resource} API (integration)', () => {
  let app: ReturnType<typeof createInMemory${Name}App>;

  beforeEach(() => {
    app = createInMemory${Name}App();
  });

  it('rejects an invalid create with 400 and an error message', async () => {
    const res = await request(app).post('${r.route}').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('runs the full create -> read -> update -> delete lifecycle', async () => {
    // Create
    const created = await request(app).post('${r.route}').send(${createBody});
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
${createAsserts}
    const id = created.body.id as string;

    // List contains the created row
    const list = await request(app).get('${r.route}');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((row: { id: string }) => row.id === id)).toBe(true);

    // Read one
    const one = await request(app).get('${r.route}/' + id);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(id);

    // Update
    const updated = await request(app).put('${r.route}/' + id).send(${updateBody});
    expect(updated.status).toBe(200);
${updateAsserts}

    // Delete
    const del = await request(app).delete('${r.route}/' + id);
    expect(del.status).toBe(204);

    // Gone -> 404
    const gone = await request(app).get('${r.route}/' + id);
    expect(gone.status).toBe(404);
  });

  it('returns 404 for a missing ${r.resource}', async () => {
    const res = await request(app).get('${r.route}/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
`;
}

const INSTRUCTIONS_BASE =
  'Real integration-test suite generated. Unlike generate_tests (which emits TODO skeletons), this ships a ' +
  'FULL create/read/update/delete lifecycle test with real assertions on real response bodies, plus a working ' +
  'in-memory reference app it runs against — so `npx vitest run` is GREEN immediately. To test YOUR backend, ' +
  'swap the createInMemory*App import in the *.integration.test.ts for your own Express app and delete the ' +
  'support file. Needs supertest (+ express for the reference app), both dev-only. No API key.';

export function generateIntegrationTests(input: {
  resource?: string;
  basePath?: string;
  fields?: IntegrationTestField[];
} = {}): IntegrationTestConfig {
  const r = resolve(input);
  const Name = cap(r.resource);
  return {
    files: {
      [`tests/support/inMemory${Name}App.ts`]: referenceApp(r),
      [`tests/${r.resource}.integration.test.ts`]: integrationTest(r),
    },
    dependencies: [
      { name: 'supertest', version: '^7.0.0' },
      { name: 'express', version: '^4.21.0' },
    ],
    instructions: `${INSTRUCTIONS_BASE} Resource: ${r.resource} at ${r.route}.`,
  };
}
