/**
 * Firebase auth route tests — registration + honest "not implemented" responses.
 *
 * These routes intentionally return HTML "not available" pages and a 501 for
 * the connect endpoint (real Firebase OAuth not yet implemented). Tests confirm
 * the routes are registered and respond as documented.
 */
import { describe, it, expect } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

async function importFirebaseAuthRoutes() {
  const { registerFirebaseAuthRoutes } = await import('../src/server/routes/firebaseAuth');
  return registerFirebaseAuthRoutes;
}

describe('Firebase auth routes — registration', () => {
  it('registers all four firebase auth endpoints', async () => {
    const register = await importFirebaseAuthRoutes();
    const routes = captureRoutes(register);
    expect(routes.has('GET /api/auth/firebase')).toBe(true);
    expect(routes.has('GET /api/auth/firebase/consent')).toBe(true);
    expect(routes.has('GET /api/auth/firebase/callback')).toBe(true);
    expect(routes.has('POST /api/auth/firebase/connect')).toBe(true);
  });
});

describe('Firebase auth routes — GET endpoints return HTML not-available page', () => {
  it('GET /api/auth/firebase sends HTML response mentioning Firebase', async () => {
    const register = await importFirebaseAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('GET /api/auth/firebase')!;

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);
    expect(typeof res.sent).toBe('string');
    expect((res.sent as string)).toMatch(/Firebase/i);
  });

  it('GET /api/auth/firebase/consent sends HTML response', async () => {
    const register = await importFirebaseAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('GET /api/auth/firebase/consent')!;

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);
    expect(typeof res.sent).toBe('string');
    expect((res.sent as string)).toMatch(/Firebase/i);
  });

  it('GET /api/auth/firebase/callback sends HTML response', async () => {
    const register = await importFirebaseAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('GET /api/auth/firebase/callback')!;

    const req = mockReq();
    const res = mockRes();
    await handler(req, res);
    expect(typeof res.sent).toBe('string');
    expect((res.sent as string)).toMatch(/Firebase/i);
  });
});

describe('Firebase auth routes — POST /api/auth/firebase/connect', () => {
  it('returns 501 not implemented', async () => {
    const register = await importFirebaseAuthRoutes();
    const routes = captureRoutes(register);
    const handler = routes.get('POST /api/auth/firebase/connect')!;

    const req = mockReq({ body: {} });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(501);
    expect(res.body?.error).toBeTruthy();
  });
});
