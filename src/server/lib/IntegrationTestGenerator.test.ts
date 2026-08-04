import { describe, it, expect } from 'vitest';
import { generateIntegrationTests } from './IntegrationTestGenerator';

describe('generateIntegrationTests', () => {
  it('emits a reference app + an integration test with real (non-TODO) assertions', () => {
    const out = generateIntegrationTests({ resource: 'product', fields: [{ name: 'title', type: 'string' }] });
    const paths = Object.keys(out.files);
    expect(paths).toContain('tests/support/inMemoryProductApp.ts');
    expect(paths).toContain('tests/product.integration.test.ts');

    const test = out.files['tests/product.integration.test.ts'];
    // Real assertions, not skeleton TODOs.
    expect(test).not.toMatch(/TODO/);
    expect(test).not.toMatch(/it\.todo/);
    expect(test).toContain("import request from 'supertest';");
    expect(test).toContain('expect(created.status).toBe(201);');
    expect(test).toContain("expect(created.body.title).toBe('Alpha');");
    expect(test).toContain("expect(updated.body.title).toBe('Beta');");
    expect(test).toContain('expect(del.status).toBe(204);');
    expect(test).toContain('expect(gone.status).toBe(404);');
  });

  it('reference app implements all five CRUD routes with validation', () => {
    const out = generateIntegrationTests({ resource: 'order' });
    const app = out.files['tests/support/inMemoryOrderApp.ts'];
    expect(app).toContain("app.post('/orders'");
    expect(app).toContain("app.get('/orders'");
    expect(app).toContain("app.get('/orders/:id'");
    expect(app).toContain("app.put('/orders/:id'");
    expect(app).toContain("app.delete('/orders/:id'");
    // Real validation → 400 on bad input, 404 on missing.
    expect(app).toContain('res.status(400)');
    expect(app).toContain('res.status(404)');
    expect(app).toContain('createInMemoryOrderApp');
  });

  it('supports number and boolean field types with type-correct samples + guards', () => {
    const out = generateIntegrationTests({
      resource: 'ticket',
      fields: [
        { name: 'qty', type: 'number' },
        { name: 'active', type: 'boolean' },
      ],
    });
    const test = out.files['tests/ticket.integration.test.ts'];
    expect(test).toContain('qty: 10');
    expect(test).toContain('active: true');
    expect(test).toContain('expect(created.body.qty).toBe(10);');
    expect(test).toContain('expect(updated.body.active).toBe(false);');

    const app = out.files['tests/support/inMemoryTicketApp.ts'];
    // The required (first) field is number → guarded with a numeric typeof check.
    expect(app).toContain("typeof qty !== 'number'");
    expect(app).toContain('qty: number;');
    expect(app).toContain('active: boolean;');
  });

  it('defaults to an item resource with a name field and declares deps', () => {
    const out = generateIntegrationTests();
    expect(Object.keys(out.files)).toContain('tests/item.integration.test.ts');
    expect(out.files['tests/item.integration.test.ts']).toContain("expect(created.body.name).toBe('Alpha');");
    const deps = out.dependencies.map((d) => d.name);
    expect(deps).toContain('supertest');
    expect(deps).toContain('express');
    expect(out.instructions).toMatch(/integration/i);
  });

  it('normalizes a custom basePath and sanitizes the resource name', () => {
    const out = generateIntegrationTests({ resource: 'blog-post!!', basePath: 'api/v1/posts/' });
    // "blog-post!!" -> "blogpost"
    const test = out.files['tests/blogpost.integration.test.ts'];
    expect(test).toBeDefined();
    // trailing slash trimmed, leading slash ensured (the list route has no trailing slash)
    expect(test).toContain("request(app).get('/api/v1/posts')");
    // no accidental double slash in the base route
    expect(test).not.toContain('/api/v1/posts//');
  });

  it('never emits a required field that collides with reserved id/createdAt', () => {
    const out = generateIntegrationTests({
      resource: 'thing',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'createdAt', type: 'string' },
        { name: 'label', type: 'string' },
      ],
    });
    const app = out.files['tests/support/inMemoryThingApp.ts'];
    // id/createdAt are dropped as user fields; label survives.
    expect(app).toContain('label: string;');
    // The interface still has exactly one `id:` and one `createdAt:` line (the reserved ones).
    expect(app.match(/^\s*id: string;$/gm)?.length ?? 0).toBe(1);
    expect(app.match(/^\s*createdAt: string;$/gm)?.length ?? 0).toBe(1);
  });
});
