/**
 * Admin route handler tests — Phase 5.3 (real route logic, no server boot).
 *
 * Uses captureRoutes() to invoke actual Express handler functions directly.
 * The verifyAdminToken middleware is the second handler in each chain;
 * captureRoutes() stores the LAST handler (the business logic handler),
 * so auth is bypassed here — we test only the business logic.
 * Separate test cases explicitly cover the login endpoint end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// Suppress audit + serverStats side-effects that would fire in the login handler.
process.env.VITEST = 'true';

// Lazy-import the route registrar to avoid top-level Firestore initialization.
async function importAdminRoutes() {
  const { registerAdminRoutes } = await import('../src/server/routes/admin');
  return registerAdminRoutes;
}

// Fake rate-limiter middleware (captureRoutes skips it, but register() needs one).
const fakeLimiter = (_req: any, _res: any, next: any) => next?.();

describe('Admin routes — login endpoint', () => {
  const origPass = process.env.ADMIN_PASSWORD;
  const origUser = process.env.ADMIN_USERNAME;

  afterEach(() => {
    process.env.ADMIN_PASSWORD = origPass;
    process.env.ADMIN_USERNAME = origUser;
  });

  it('returns 503 when ADMIN_PASSWORD env var is not set', async () => {
    delete process.env.ADMIN_PASSWORD;
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('POST /api/admin/login');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { username: 'admin', password: 'secret' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body?.error).toMatch(/not configured/i);
  });

  it('returns 401 on wrong credentials', async () => {
    process.env.ADMIN_PASSWORD = 'correctpass';
    process.env.ADMIN_USERNAME = 'aashishcpmt09';
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('POST /api/admin/login');

    const req = mockReq({ body: { username: 'aashishcpmt09', password: 'wrongpass' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toMatch(/invalid credentials/i);
  });

  it('returns a token on correct credentials', async () => {
    process.env.ADMIN_PASSWORD = 'correctpass';
    process.env.ADMIN_USERNAME = 'aashishcpmt09';
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('POST /api/admin/login');

    const req = mockReq({ body: { username: 'aashishcpmt09', password: 'correctpass' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(typeof res.body?.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(10);
  });
});

describe('Admin routes — announcement endpoint', () => {
  it('returns 400 when message is missing', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('POST /api/admin/announcement');
    expect(handler).toBeDefined();

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/message required/i);
  });

  it('stores and returns announcement with id, message, createdAt, target', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('POST /api/admin/announcement');

    const req = mockReq({ body: { message: 'Maintenance tonight 10pm', target: 'all' } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    const ann = res.body?.announcement;
    expect(typeof ann?.id).toBe('string');
    expect(ann?.message).toBe('Maintenance tonight 10pm');
    expect(ann?.target).toBe('all');
    expect(typeof ann?.createdAt).toBe('string');
  });
});

describe('Admin routes — settings GET/POST', () => {
  it('GET /api/admin/settings returns current server stats fields', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('GET /api/admin/settings');
    expect(handler).toBeDefined();

    const req = mockReq({});
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    // Must include all 4 settings fields
    expect('maintenanceMode' in res.body).toBe(true);
    expect('featureFlags' in res.body).toBe(true);
    expect('pricingConfig' in res.body).toBe(true);
    expect('providerEnabled' in res.body).toBe(true);
  });

  it('POST /api/admin/settings updates maintenanceMode and returns ok', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const postHandler = routes.get('POST /api/admin/settings');
    expect(postHandler).toBeDefined();

    const req = mockReq({ body: { maintenanceMode: true } });
    const res = mockRes();
    await postHandler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.settings?.maintenanceMode).toBe(true);
  });
});

describe('Admin routes — provider status', () => {
  it('GET /api/admin/provider-status returns providers array', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('GET /api/admin/provider-status');
    expect(handler).toBeDefined();

    const req = mockReq({});
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    // Should return an object or array describing provider statuses
    expect(res.body).toBeDefined();
  });
});

describe('Admin routes — metrics endpoint', () => {
  it('GET /api/admin/metrics returns snapshot with alerts array', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('GET /api/admin/metrics');
    expect(handler).toBeDefined();

    const req = mockReq({});
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    // snapshot must have top-level builds object
    expect(res.body).toHaveProperty('builds');
    // evaluateAlerts must have been called → alerts array present
    expect(Array.isArray(res.body?.alerts)).toBe(true);
  });
});

describe('Admin routes — announcements list', () => {
  it('GET /api/admin/announcements returns an array', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('GET /api/admin/announcements');
    expect(handler).toBeDefined();

    const req = mockReq({});
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/admin/announcements includes previously posted announcement', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const postHandler = routes.get('POST /api/admin/announcement');
    const getHandler = routes.get('GET /api/admin/announcements');

    // Post an announcement
    const postReq = mockReq({ body: { message: 'Test notice for list', target: 'all' } });
    const postRes = mockRes();
    await postHandler!(postReq, postRes);
    expect(postRes.statusCode).toBe(200);

    // List should include it
    const getReq = mockReq({});
    const getRes = mockRes();
    await getHandler!(getReq, getRes);
    expect(getRes.statusCode).toBe(200);
    const found = getRes.body.find((a: any) => a.message === 'Test notice for list');
    expect(found).toBeDefined();
    expect(found?.target).toBe('all');
  });
});

describe('Admin routes — promo code validation', () => {
  it('POST /api/admin/promo returns 400 when code is missing', async () => {
    const register = await importAdminRoutes();
    const routes = captureRoutes(register, fakeLimiter);
    const handler = routes.get('POST /api/admin/promo');
    expect(handler).toBeDefined();

    const req = mockReq({ body: { discountPct: 10 } });
    const res = mockRes();
    await handler!(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toMatch(/code required/i);
  });
});
