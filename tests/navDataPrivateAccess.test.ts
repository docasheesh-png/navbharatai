import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { canAccessNavData, mintNavDataToken, NAVDATA_TOKEN_TTL_MS } from '../src/server/lib/navDataAccess';
import { NAVDATA_RUNTIME_SOURCE } from '../src/server/runtime/previewImportMeta';

const state = vi.hoisted(() => ({ app: null as any, read: vi.fn(), write: vi.fn() }));
vi.mock('../src/server/lib/navStoreWeb', async (original) => ({
  ...await original<typeof import('../src/server/lib/navStoreWeb')>(),
  getWebApp: async () => state.app,
  readWebAppBake: async () => null,
  getWebAppFiles: async () => ({ 'index.html': '<body>private app</body>' }),
  bumpWebAppCounter: () => {},
}));
vi.mock('../src/server/runtime/renderPreview', () => ({ renderPreview: () => '<body>private app</body>' }));
vi.mock('../src/server/lib/navStoreWebData', async (original) => ({
  ...await original<typeof import('../src/server/lib/navStoreWebData')>(),
  listDataRows: (...args: any[]) => state.read(...args),
  addDataRow: (...args: any[]) => state.write(...args),
}));
vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseIdentity: async () => null, verifyFirebaseToken: async () => null,
  rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import { registerNavStoreRoutes } from '../src/server/routes/navStore';
import { hashAppPassword } from '../src/server/lib/navStoreWeb';

const routes = captureRoutes(registerNavStoreRoutes);
const open = routes.get('POST /api/nav-store/web/app/:id/open')!;
const get = routes.get('GET /api/nav-store/web/app/:id/data/:collection')!;
const post = routes.get('POST /api/nav-store/web/app/:id/data/:collection')!;
const privateApp = { id: 'private-a', visibility: 'private', passwordHash: 'hash-a', passwordSalt: 'salt-a' };

describe('private data capabilities', () => {
  it('is app-scoped, expires, rejects malformed tokens, and is revoked by password rotation', () => {
    const now = 100_000;
    const token = mintNavDataToken(privateApp, now);
    expect(canAccessNavData(privateApp, token, now)).toBe(true);
    expect(canAccessNavData({ ...privateApp, id: 'private-b' }, token, now)).toBe(false);
    expect(canAccessNavData({ ...privateApp, passwordHash: 'rotated' }, token, now)).toBe(false);
    expect(canAccessNavData(privateApp, token, now + NAVDATA_TOKEN_TTL_MS)).toBe(false);
    for (const bad of [undefined, '', 'NaN.x', token + 'x', {}, 'x'.repeat(10_000)]) {
      expect(canAccessNavData(privateApp, bad, now)).toBe(false);
    }
  });
});

describe('the registered private player and data routes', () => {
  beforeEach(() => {
    const pw = hashAppPassword('correct-password');
    state.app = { ...privateApp, passwordHash: pw.hash, passwordSalt: pw.salt, version: 1, status: 'unlisted', name: 'Private' };
    state.read.mockReset().mockResolvedValue([{ id: 'row-a', data: { message: 'secret' } }]);
    state.write.mockReset().mockResolvedValue({ ok: true, row: { id: 'row-b' } });
  });
  const req = (token?: string) => mockReq({ params: { id: 'private-a', collection: 'messages' }, body: { data: { message: 'hello' } }, headers: token ? { 'x-navdata-token': token } : {} });

  it('knowing the private app id cannot read or write any rows', async () => {
    for (const handler of [get, post]) {
      const res = mockRes(); await handler(req(), res);
      expect(res.statusCode).toBe(401);
      expect(res.body.requiresPassword).toBe(true);
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
    expect(state.read).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled();
  });

  it('issues the capability only after a correct password, without caching a viewer token', async () => {
    const wrong = mockRes();
    await open(mockReq({ params: { id: 'private-a' }, body: { password: 'wrong' } }), wrong);
    expect(wrong.statusCode).toBe(401);
    const res = mockRes();
    await open(mockReq({ params: { id: 'private-a' }, body: { password: 'correct-password' } }), res);
    expect(res.statusCode).toBe(200);
    const token = /__NBAI_NAVDATA_TOKEN="([^"]+)"/.exec(res.body.html)?.[1];
    expect(token).toBeTruthy();
    for (const handler of [get, post]) {
      const answer = mockRes(); await handler(req(token), answer);
      expect(answer.statusCode).toBe(200);
    }
    // Same version, cached compiled player: rotation still mints a NEW capability and rejects the old.
    const pw = hashAppPassword('new-password');
    Object.assign(state.app, { passwordHash: pw.hash, passwordSalt: pw.salt });
    const again = mockRes();
    await open(mockReq({ params: { id: 'private-a' }, body: { password: 'new-password' } }), again);
    expect(again.body.html).not.toContain(token);
    const denied = mockRes(); await get(req(token), denied); expect(denied.statusCode).toBe(401);
  });

  it('public apps stay available signed out, while removed apps never expose data', async () => {
    state.app.visibility = 'public';
    const res = mockRes(); await get(req(), res); expect(res.statusCode).toBe(200);
    state.app.status = 'removed';
    for (const handler of [get, post]) {
      const answer = mockRes(); await handler(req(), answer); expect(answer.statusCode).toBe(404);
    }
  });
});

describe('the actual iframe runtime', () => {
  it('sends the capability on both reads and writes, and reports authorization failures', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Reopen this private app.' }) });
    const window: any = { __NBAI_STORE_APP_ID: 'a', __NBAI_NAVDATA_TOKEN: 'token-a' };
    runInNewContext(NAVDATA_RUNTIME_SOURCE, { window, fetch });
    await expect(window.NavData.list('messages')).rejects.toThrow('Reopen this private app.');
    await expect(window.NavData.add('messages', {})).rejects.toThrow('Reopen this private app.');
    for (const [, options] of fetch.mock.calls) expect(options.headers['X-NavData-Token']).toBe('token-a');
  });
});
