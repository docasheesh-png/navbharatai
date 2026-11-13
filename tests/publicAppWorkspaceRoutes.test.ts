import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { isPublicAppWorkspaceId } from '../src/server/lib/publicAppWorkspace';
import { ownedByVerifiedUid, workspaceIdFor } from '../src/server/lib/workspaceIdentity';
const effects = vi.hoisted(() => ({
  merge: vi.fn(async () => ({ status: 'saved' })),
  load: vi.fn(async () => ({})),
  setting: vi.fn(async () => true),
  getSetting: vi.fn(async () => ({ disabled: false })),
  forget: vi.fn(),
}));
vi.mock('../src/server/lib/authMiddleware', async (original) => ({
  ...await original<typeof import('../src/server/lib/authMiddleware')>(),
  verifyFirebaseIdentity: async () => ({ uid: 'owner', email: null, emailVerified: false }),
  verifyFirebaseToken: async () => 'owner',
}));
vi.mock('../src/server/AgentV3/WorkspaceFileStore', async (original) => ({
  ...await original<typeof import('../src/server/AgentV3/WorkspaceFileStore')>(),
  mergeWorkspaceFiles: effects.merge, loadWorkspaceFilesByPath: effects.load,
}));
vi.mock('../src/server/lib/AppAiSettingsStore', () => ({ setAppAiDisabled: effects.setting, getAppAiSettings: effects.getSetting }));
vi.mock('../src/server/lib/appAiOwnKey', async (original) => ({
  ...await original<typeof import('../src/server/lib/appAiOwnKey')>(), forgetOwnKey: effects.forget,
}));
import { registerBrandApplyRoutes } from '../src/server/routes/brandApply';
import { registerAppAiOwnerRoutes } from '../src/server/routes/appAiOwner';
import { registerZipUploadRoutes } from '../src/server/routes/zipUpload';

const invalid = ['::green', '::attempt', '::greenmeta', '/files/secret', '\\secret', '\0', '\n', '%3A%3Agreen', '\ud800'].map(s => `agentv3-owner-session${s}`);
beforeEach(() => vi.clearAllMocks());
describe('public app resource boundary', () => {
  it.each(invalid)('rejects internal/path-shaped target %j even though the old prefix matches', async workspaceId => {
    expect(ownedByVerifiedUid('owner', workspaceId)).toBe(true);
    expect(isPublicAppWorkspaceId(workspaceId)).toBe(false);
    for (const [register, method, route] of [
      [registerBrandApplyRoutes, 'POST', '/api/agentv3/brand/apply'],
      [registerAppAiOwnerRoutes, 'POST', '/api/app-ai/settings'],
      [registerAppAiOwnerRoutes, 'GET', '/api/app-ai/settings'],
      [registerAppAiOwnerRoutes, 'GET', '/api/app-ai/spend'],
      [registerAppAiOwnerRoutes, 'POST', '/api/app-ai/preview-ask'],
      [registerAppAiOwnerRoutes, 'POST', '/api/app-ai/preview-image'],
      [registerAppAiOwnerRoutes, 'POST', '/api/app-ai/preview-image-ready'],
      [registerZipUploadRoutes, 'POST', '/api/zip-upload/commit'],
    ] as const) {
      const handler = captureRoutes(register).get(`${method} ${route}`)!;
      const response = mockRes();
      await handler(mockReq({ body: { workspaceId, enabled: true, uploadId: 'not-read' }, query: { workspaceId } }), response);
      expect(response.statusCode, route).toBe(403);
    }
    expect(effects.merge).not.toHaveBeenCalled();
    expect(effects.load).not.toHaveBeenCalled();
    expect(effects.setting).not.toHaveBeenCalled();
    expect(effects.getSetting).not.toHaveBeenCalled();
    expect(effects.forget).not.toHaveBeenCalled();
  });
  it.each(['a', 'sess_ABC123', '1731499999999', 'a2cf1991-904e-4bc3-ad38-aaa090251234'])('preserves issued legacy session %s', session => {
    expect(isPublicAppWorkspaceId(workspaceIdFor('google-owner_1', session))).toBe(true);
  });
  it('normal settings still save while a foreign normal workspace is denied', async () => {
    const handler = captureRoutes(registerAppAiOwnerRoutes).get('POST /api/app-ai/settings')!;
    const good = mockRes();
    await handler(mockReq({ body: { workspaceId: 'agentv3-owner-session', enabled: true } }), good);
    expect(good.statusCode).toBe(200);
    expect(effects.setting).toHaveBeenCalledWith('agentv3-owner-session', false);
    effects.setting.mockClear();
    const bad = mockRes();
    await handler(mockReq({ body: { workspaceId: 'agentv3-other-session', enabled: true } }), bad);
    expect(bad.statusCode).toBe(403);
    expect(effects.setting).not.toHaveBeenCalled();
  });
  it('does not pretend to solve the separate legacy UID collision', () => {
    const same = workspaceIdFor('owner', 'long-session')!;
    expect(same).toBe(workspaceIdFor('owner-long', 'session'));
    expect(isPublicAppWorkspaceId(same)).toBe(true);
    expect(ownedByVerifiedUid('owner', same)).toBe(true);
    expect(ownedByVerifiedUid('owner-long', same)).toBe(true);
  });
});
