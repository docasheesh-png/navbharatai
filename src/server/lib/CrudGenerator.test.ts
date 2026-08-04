import { describe, it, expect } from 'vitest';
import { generateCrudResource } from './CrudGenerator';

const entity = { name: 'Post', fields: [
  { name: 'id' },
  { name: 'title', type: 'string' },
  { name: 'views', type: 'int' },
  { name: 'email' },
  { name: 'created_at' },
] };

describe('generateCrudResource', () => {
  it('emits schema, prisma client, error handler and router files', () => {
    const out = generateCrudResource(entity);
    expect(Object.keys(out.files).sort()).toEqual([
      'server/lib/prisma.ts',
      'server/middleware/errorHandler.ts',
      'server/routes/posts.routes.ts',
      'server/validation/posts.schema.ts',
    ]);
  });

  it('the zod schema types writable fields (email→.email(), int→number().int()) and excludes managed columns', () => {
    const schema = generateCrudResource(entity).files['server/validation/posts.schema.ts'];
    expect(schema).toContain('"title": z.string()');
    expect(schema).toContain('"views": z.number().int()');
    expect(schema).toContain('"email": z.string().email()');
    expect(schema).not.toContain('"id"');
    expect(schema).not.toContain('created_at');
    expect(schema).toContain('createPostSchema.partial()'); // update = partial of create
  });

  it('the router paginates, filters, sorts, soft-deletes and 404s — on prisma.post', () => {
    const r = generateCrudResource(entity).files['server/routes/posts.routes.ts'];
    expect(r).toContain('prisma.post.findMany');
    expect(r).toContain('prisma.post.count');
    expect(r).toContain('deletedAt: null');                 // read excludes soft-deleted
    expect(r).toContain('data: { deletedAt: new Date() }'); // delete is SOFT, not a destroy
    expect(r).toContain('totalPages');
    expect(r).toContain('res.status(404)');
    expect(r).toContain('const FILTERABLE = new Set(');
    expect(r).toContain('const SORTABLE = new Set(');
  });

  it('is an OPEN resource by default (no auth guard, no requireAuth in the router)', () => {
    const out = generateCrudResource(entity);
    expect(out.files['server/middleware/requireAuth.ts']).toBeUndefined();
    expect(out.files['server/routes/posts.routes.ts']).not.toContain('requireAuth');
  });

  it('protected:true adds a requireAuth guard file and guards every mutation (POST/PATCH/DELETE)', () => {
    const out = generateCrudResource(entity, { protected: true });
    expect(out.files['server/middleware/requireAuth.ts']).toContain('Authentication required');
    const r = out.files['server/routes/posts.routes.ts'];
    expect(r).toContain('import { requireAuth }');
    expect((r.match(/requireAuth, asyncHandler/g) || []).length).toBe(3);
  });

  it('declares zod + prisma dependencies and never throws on a malformed entity', () => {
    const out = generateCrudResource(entity);
    expect(out.dependencies.map((d) => d.name).sort()).toEqual(['@prisma/client', 'prisma', 'zod']);
    // @ts-expect-error — malformed input must not throw
    expect(() => generateCrudResource({})).not.toThrow();
  });
});
