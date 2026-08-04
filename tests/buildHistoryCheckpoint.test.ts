import { describe, it, expect } from 'vitest';
import { registerBuildRoutes } from '../src/server/routes/build';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// Code Versioning (admin 2026-07-24): a MANUAL named checkpoint is saved to the SAME durable,
// cross-device build-history store the automatic per-build checkpoints use. These tests lock the
// route's validation + that it exists (in VITEST the store no-ops, so a valid body returns ok).

const routes = captureRoutes(registerBuildRoutes);
const checkpoint = routes.get('POST /api/build-history/:sessionId/checkpoint')!;
const appsList = routes.get('GET /api/versioning/apps')!;

describe('POST /api/build-history/:sessionId/checkpoint', () => {
  it('is registered', () => {
    expect(typeof checkpoint).toBe('function');
  });

  it('rejects a request with no files map (400)', async () => {
    const res = mockRes();
    await checkpoint(mockReq({ params: { sessionId: 's1' }, body: { name: 'x' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty files object (400 — nothing to checkpoint)', async () => {
    const res = mockRes();
    await checkpoint(mockReq({ params: { sessionId: 's1' }, body: { files: {} } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('accepts a valid files map and reports ok', async () => {
    const res = mockRes();
    await checkpoint(mockReq({ params: { sessionId: 's1' }, body: { name: 'before risky change', files: { 'index.html': '<h1>hi</h1>' } } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('ignores non-string file entries but still saves the readable ones', async () => {
    const res = mockRes();
    await checkpoint(mockReq({ params: { sessionId: 's1' }, body: { files: { 'a.ts': 'ok', 'b.ts': 123 } } }), res);
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/versioning/apps — Time Machine app picker', () => {
  it('is registered', () => {
    expect(typeof appsList).toBe('function');
  });
  it('returns an empty list for an unauthenticated caller (no cross-device apps without a verified user)', async () => {
    const res = mockRes();
    await appsList(mockReq({}), res);
    expect(res.body).toEqual({ apps: [] });
  });
});

describe('server registration', () => {
  it('the checkpoint + apps routes are present in build.ts', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../src/server/routes/build.ts'), 'utf8');
    expect(src).toContain("app.post('/api/build-history/:sessionId/checkpoint'");
    expect(src).toContain("app.get('/api/versioning/apps'");
  });
});
