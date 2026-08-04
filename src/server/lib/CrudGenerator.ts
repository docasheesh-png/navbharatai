// T1.2 (roadmap 2026-07-19) — CRUD resource generator.
//
// The backend "request-quality" surface was the audit's biggest ❌ cluster: generated apps had no
// validation, pagination, filtering, sorting, or a real error contract — the LLM hand-wrote each
// endpoint. This recipe generates a COMPLETE, correct REST resource for one entity, on Prisma (pairs
// with the T1.1 deep-schema generator's soft-delete `deletedAt` + `createdAt`/`updatedAt`):
//   • a zod validation schema (create + partial update),
//   • an Express router: paginated + filterable + sortable LIST, get-by-id, validated create/update,
//     and soft-delete (sets deletedAt, never a hard destroy),
//   • a shared Prisma client + a central error handler (zod → 400, else status/500) with asyncHandler.
// PURE builder → the caller writes the files. Real, complete code — no TODO stubs (the real-features
// rule). Optional `protected` requires an authenticated `req.user` on every mutation (pairs with
// generate_auth); default is an open resource so the endpoint works standalone.

import { fieldKind, type MigrationEntity, type MigrationField } from '../AppMakerLab/generator/MigrationGenerator';

export interface CrudResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

function pascal(s: string): string {
  return String(s || 'Model')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Model';
}

function camelLower(pascalName: string): string {
  return pascalName.charAt(0).toLowerCase() + pascalName.slice(1);
}

function snakePlural(s: string): string {
  const snake = String(s || 'table')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '') || 'table';
  return /s$/.test(snake) ? snake : `${snake}s`;
}

/** Auto-managed columns the client must never set on create/update. */
function isManaged(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return n === 'id' || n === 'createdat' || n === 'created_at' || n === 'created'
    || n === 'updatedat' || n === 'updated_at' || n === 'updated'
    || n === 'deletedat' || n === 'deleted_at' || n === 'deleted';
}

/** zod expression for a field, from its inferred kind (email gets .email()). */
function zodExpr(field: MigrationField): string {
  const name = String(field.name || '').toLowerCase();
  if (/^email$/.test(name)) return 'z.string().email()';
  switch (fieldKind(field)) {
    case 'int': return 'z.number().int()';
    case 'float': return 'z.number()';
    case 'boolean': return 'z.boolean()';
    case 'datetime': return 'z.coerce.date()';
    case 'id':
    case 'string':
    default: return 'z.string()';
  }
}

/**
 * Generate a full CRUD REST resource for one entity. Pure — returns the files to write. `protected`
 * guards mutations with an authenticated req.user (default false = open resource). Never throws.
 */
export function generateCrudResource(entity: MigrationEntity, opts: { protected?: boolean } = {}): CrudResult {
  const safeName = entity && entity.name ? entity.name : 'Item';
  const Model = pascal(safeName);           // Prisma model, e.g. Post
  const model = camelLower(Model);          // Prisma client accessor, e.g. prisma.post
  const route = snakePlural(safeName);      // URL segment + file base, e.g. posts
  const fields = (entity?.fields || []).filter((f) => f && f.name);
  const writable = fields.filter((f) => !isManaged(f.name));
  const filterable = writable.map((f) => String(f.name));
  const sortable = Array.from(new Set([...filterable, 'createdAt', 'updatedAt']));
  const guarded = opts.protected === true;

  const schemaLines = writable.length
    ? writable.map((f) => `  ${JSON.stringify(String(f.name))}: ${zodExpr(f)},`).join('\n')
    : '  // no writable fields — the resource is managed entirely by the server';

  const schemaFile = `import { z } from 'zod';

// Create payload — auto-managed columns (id, timestamps, deletedAt) are never accepted from the client.
export const create${Model}Schema = z.object({
${schemaLines}
});

// Update payload — every field optional (partial update / PATCH).
export const update${Model}Schema = create${Model}Schema.partial();

export type Create${Model}Input = z.infer<typeof create${Model}Schema>;
export type Update${Model}Input = z.infer<typeof update${Model}Schema>;
`;

  const prismaFile = `import { PrismaClient } from '@prisma/client';

// A single shared client for the whole app — creating one per request exhausts the connection pool.
export const prisma = new PrismaClient();
`;

  const errorFile = `import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';

// Wrap an async route so a thrown/rejected error reaches the error handler instead of hanging the request.
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

// Central error contract: zod validation → 400 with details; anything with a numeric .status → that
// status; otherwise 500. Keep this the LAST app.use(...) so every route funnels through it.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.issues });
    return;
  }
  const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  res.status(status).json({ error: status === 500 ? 'Internal Server Error' : message });
}
`;

  const authGuard = guarded
    ? `import type { Request, Response, NextFunction } from 'express';

// Mutations require an authenticated user. Pair with generate_auth, which populates req.user from the
// Bearer token; here we only enforce that it exists (401 otherwise).
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!(req as Request & { user?: unknown }).user) { res.status(401).json({ error: 'Authentication required' }); return; }
  next();
}
`
    : '';

  const guardImport = guarded ? `import { requireAuth } from '../middleware/requireAuth';\n` : '';
  const guardArg = guarded ? 'requireAuth, ' : '';

  const routerFile = `import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/errorHandler';
${guardImport}import { create${Model}Schema, update${Model}Schema } from '../validation/${route}.schema';

const router = Router();

// Only these fields may be filtered/sorted on — an allow-list stops arbitrary/unsafe query keys.
const FILTERABLE = new Set(${JSON.stringify(filterable)});
const SORTABLE = new Set(${JSON.stringify(sortable)});

// LIST — pagination (?page,?limit≤100), exact-match filtering (?field=value on allow-listed fields),
// and sorting (?sort=field:asc|desc). Soft-deleted rows (deletedAt) are excluded.
router.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const where: Record<string, unknown> = { deletedAt: null };
  for (const key of FILTERABLE) { if (typeof req.query[key] !== 'undefined') where[key] = req.query[key]; }
  let orderBy: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' };
  if (typeof req.query.sort === 'string') {
    const [f, dir] = req.query.sort.split(':');
    if (SORTABLE.has(f)) orderBy = { [f]: dir === 'asc' ? 'asc' : 'desc' };
  }
  const [data, total] = await Promise.all([
    prisma.${model}.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
    prisma.${model}.count({ where }),
  ]);
  res.json({ data, page, limit, total, totalPages: Math.ceil(total / limit) });
}));

// GET one (excludes soft-deleted).
router.get('/:id', asyncHandler(async (req, res) => {
  const item = await prisma.${model}.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!item) { res.status(404).json({ error: '${Model} not found' }); return; }
  res.json(item);
}));

// CREATE (validated).
router.post('/', ${guardArg}asyncHandler(async (req, res) => {
  const data = create${Model}Schema.parse(req.body);
  const created = await prisma.${model}.create({ data });
  res.status(201).json(created);
}));

// UPDATE (validated, partial).
router.patch('/:id', ${guardArg}asyncHandler(async (req, res) => {
  const data = update${Model}Schema.parse(req.body);
  const existing = await prisma.${model}.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) { res.status(404).json({ error: '${Model} not found' }); return; }
  const updated = await prisma.${model}.update({ where: { id: req.params.id }, data });
  res.json(updated);
}));

// DELETE — SOFT delete (sets deletedAt), so the row is recoverable and audit history survives.
router.delete('/:id', ${guardArg}asyncHandler(async (req, res) => {
  const existing = await prisma.${model}.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!existing) { res.status(404).json({ error: '${Model} not found' }); return; }
  await prisma.${model}.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.status(204).end();
}));

export default router;
`;

  const files: Record<string, string> = {
    [`server/validation/${route}.schema.ts`]: schemaFile,
    [`server/lib/prisma.ts`]: prismaFile,
    [`server/middleware/errorHandler.ts`]: errorFile,
    [`server/routes/${route}.routes.ts`]: routerFile,
  };
  if (guarded) files[`server/middleware/requireAuth.ts`] = authGuard;

  const instructions =
    `Wired a full CRUD resource for "${Model}" on Prisma. Mount it and the error handler in your server:\n` +
    `  import ${model}Router from './server/routes/${route}.routes';\n` +
    `  import { errorHandler } from './server/middleware/errorHandler';\n` +
    `  app.use('/api/${route}', ${model}Router);\n` +
    `  app.use(errorHandler); // keep LAST so every route funnels through it\n` +
    `Endpoints: GET /api/${route} (?page,?limit,?sort=field:asc|desc,?<field>=value), GET /:id, POST, PATCH /:id, ` +
    `DELETE /:id (soft-delete). Run \`npx prisma generate\` after the schema exists.` +
    (guarded ? ' Mutations require an authenticated req.user (pair with generate_auth).' : '');

  return {
    files,
    dependencies: [
      { name: 'zod', version: '^3' },
      { name: '@prisma/client', version: '^5' },
      { name: 'prisma', version: '^5' },
    ],
    instructions,
  };
}
