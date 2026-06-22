/**
 * Auth + GitHub route validation tests — Phase 5.3.
 *
 * Auth routes: OTP cooldown logic (pure in-memory, no Firestore).
 * GitHub routes: 401 when Authorization header is missing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

// ── Auth routes ───────────────────────────────────────────────────────────────

async function importAuthRoutes() {
  const { registerAuthRoutes } = await import('../src/server/routes/auth');
  return registerAuthRoutes;
}

describe('Auth routes — /api/auth/send-otp', () => {
  it('returns 400 when phone is missing', async () => {
    const register = await importAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/auth/send-otp');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.success).toBe(false);
    expect(res.body?.message).toMatch(/phone number is required/i);
  });

  it('returns 200 success on first valid request with unique IP', async () => {
    const register = await importAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/auth/send-otp');

    // Use a unique IP to avoid cross-test pollution from module-level Map state
    const uniqueIp = `192.168.${Date.now() % 256}.${(Date.now() >> 8) % 256}`;
    const uniquePhone = `+91${Date.now()}a`;
    const req = mockReq({
      body: { phone: uniquePhone },
      headers: { 'x-forwarded-for': uniqueIp },
    });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
  });

  it('returns 429 when same phone+IP requests again within cooldown window', async () => {
    const register = await importAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/auth/send-otp');

    // Use unique IP+phone pair isolated from other tests
    const phone = `+91987${Date.now()}b`;
    const ip = `172.16.${Date.now() % 256}.2`;

    // First request — should succeed
    const req1 = mockReq({ body: { phone }, headers: { 'x-forwarded-for': ip } });
    const res1 = mockRes();
    await handler!(req1, res1);
    expect(res1.statusCode).toBe(200);

    // Immediate second request with same phone — 30s cooldown fires on phone
    const req2 = mockReq({ body: { phone }, headers: { 'x-forwarded-for': ip } });
    const res2 = mockRes();
    await handler!(req2, res2);
    expect(res2.statusCode).toBe(429);
    expect(res2.body?.success).toBe(false);
    expect(res2.body?.message).toMatch(/wait/i);
  });
});

// ── GitHub routes ─────────────────────────────────────────────────────────────

async function importGithubRoutes() {
  const { registerGithubRoutes } = await import('../src/server/routes/github');
  return registerGithubRoutes;
}

describe('GitHub routes — /api/github/* auth check', () => {
  it('GET /api/github/fetch returns 401 when Authorization header is missing', async () => {
    const register = await importGithubRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/github/fetch');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { owner: 'acme', repo: 'test' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/github/file returns 401 when Authorization header is missing', async () => {
    const register = await importGithubRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/github/file');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { owner: 'acme', repo: 'test', path: 'README.md' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/github/branches returns 401 when Authorization header is missing', async () => {
    const register = await importGithubRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/github/branches');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { owner: 'acme', repo: 'test' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(401);
  });
});
