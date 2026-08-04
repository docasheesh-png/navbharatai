/**
 * Push-notification device-token registration routes. Mocks DeviceTokenStore (like
 * routesSecretsIdor.test.ts mocks its store) so these tests exercise the ROUTE logic
 * (validation, status codes, payload shape) — captureRoutes strips auth middleware, so
 * requireUserMatch's own behavior is out of scope here and covered by its own tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

process.env.VITEST = 'true';

const SAVED: Array<{ uid: string; token: string; platform: string }> = [];
const REMOVED: Array<{ uid: string; token: string }> = [];
let saveResult = true;

vi.mock('../src/server/lib/DeviceTokenStore', () => ({
  deviceTokenStore: {
    saveToken: async (uid: string, token: string, platform: string) => {
      SAVED.push({ uid, token, platform });
      return saveResult;
    },
    removeToken: async (uid: string, token: string) => {
      REMOVED.push({ uid, token });
      return true;
    },
  },
}));

async function getRoutes() {
  const { registerPushRoutes } = await import('../src/server/routes/push');
  return captureRoutes(registerPushRoutes);
}

describe('push routes', () => {
  beforeEach(() => {
    SAVED.length = 0;
    REMOVED.length = 0;
    saveResult = true;
  });

  it('registers the expected endpoints', async () => {
    const routes = await getRoutes();
    expect(routes.has('POST /api/push/:userId/register-token')).toBe(true);
    expect(routes.has('DELETE /api/push/:userId/register-token')).toBe(true);
  });

  it('POST rejects a missing/blank token with 400 and never calls the store', async () => {
    const routes = await getRoutes();
    const handler = routes.get('POST /api/push/:userId/register-token')!;
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'u1' }, body: { platform: 'android' } }), res);
    expect(res.statusCode).toBe(400);
    expect(SAVED).toHaveLength(0);
  });

  it('POST saves a valid token, defaulting an unrecognized platform to web', async () => {
    const routes = await getRoutes();
    const handler = routes.get('POST /api/push/:userId/register-token')!;
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'u1' }, body: { token: 'tok-123', platform: 'toaster' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(SAVED).toEqual([{ uid: 'u1', token: 'tok-123', platform: 'web' }]);
  });

  it('POST accepts android/ios/web platforms as-is', async () => {
    const routes = await getRoutes();
    const handler = routes.get('POST /api/push/:userId/register-token')!;
    for (const platform of ['android', 'ios', 'web']) {
      const res = mockRes();
      await handler(mockReq({ params: { userId: 'u1' }, body: { token: `tok-${platform}`, platform } }), res);
      expect(res.statusCode).toBe(200);
    }
    expect(SAVED.map((s) => s.platform)).toEqual(['android', 'ios', 'web']);
  });

  it('POST returns 500 (honest failure, never a fake success) when the store save fails', async () => {
    saveResult = false;
    const routes = await getRoutes();
    const handler = routes.get('POST /api/push/:userId/register-token')!;
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'u1' }, body: { token: 'tok-123', platform: 'android' } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body?.success).not.toBe(true);
  });

  it('DELETE rejects a missing token with 400', async () => {
    const routes = await getRoutes();
    const handler = routes.get('DELETE /api/push/:userId/register-token')!;
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'u1' }, body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(REMOVED).toHaveLength(0);
  });

  it('DELETE removes a token for the given user', async () => {
    const routes = await getRoutes();
    const handler = routes.get('DELETE /api/push/:userId/register-token')!;
    const res = mockRes();
    await handler(mockReq({ params: { userId: 'u1' }, body: { token: 'tok-123' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(REMOVED).toEqual([{ uid: 'u1', token: 'tok-123' }]);
  });
});
