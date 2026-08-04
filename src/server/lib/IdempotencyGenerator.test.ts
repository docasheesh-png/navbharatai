import { describe, it, expect } from 'vitest';
import { generateIdempotencyIntegration } from './IdempotencyGenerator';

describe('generateIdempotencyIntegration', () => {
  const c = generateIdempotencyIntegration();
  const server = c.files['server/lib/idempotency.ts'];

  it('emits createMemoryStore + idempotency middleware, server-side, no runtime dependency', () => {
    expect(server).toContain('export function createMemoryStore(');
    expect(server).toContain('export function idempotency(');
    expect(server).toContain("import type { Request, Response, NextFunction } from 'express'"); // type-only
    expect(c.files['src/lib/idempotency.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('replays the cached response for a repeated key and 409s a still-in-flight repeat', () => {
    expect(server).toContain("req.get('Idempotency-Key')");
    expect(server).toContain("existing.state === 'done'");
    expect(server).toContain('res.status(existing.response.status).json(existing.response.body)');
    expect(server).toContain('res.status(409)');
  });

  it('caches only NON-5xx (a transient error stays retryable) and scopes the key by route', () => {
    expect(server).toContain('res.statusCode < 500');
    expect(server).toContain('store.delete(cacheKey)'); // 5xx clears the key
    expect(server).toContain("req.method + ' ' + (req.originalUrl || req.url) + ' ' + key");
  });

  it('opts in per request (no header → pass through) and never leaves a stuck pending key', () => {
    expect(server).toContain('if (!key) { next(); return; }');
    expect(server).toContain("res.on('finish'");
    expect(server).toContain("state === 'pending'");
  });

  it('is honest about the per-instance scope and never writes .env.example', () => {
    expect(c.instructions.toLowerCase()).toContain('redis');
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/idempotency.ts']);
  });
});
