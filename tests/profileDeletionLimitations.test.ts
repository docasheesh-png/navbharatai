import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const state = vi.hoisted(() => ({
  account: 'deleted',
  deleteDerived: vi.fn(),
}));
vi.mock('../src/server/lib/authMiddleware', async (original) => ({
  ...await original<typeof import('../src/server/lib/authMiddleware')>(),
  verifyFirebaseIdentity: async () => ({ uid: 'alice', email: null }),
  deleteAuthAccount: async () => state.account,
}));
vi.mock('../src/server/lib/serverDb', async (original) => ({
  ...await original<typeof import('../src/server/lib/serverDb')>(), getServerDb: () => ({}),
}));
vi.mock('../src/server/lib/DataRetentionManager', async (original) => ({
  ...await original<typeof import('../src/server/lib/DataRetentionManager')>(),
  getRetentionDb: () => ({}),
  deleteUserData: async () => ({ uid: 'alice', collections: [], totalDeleted: 2 }),
}));
vi.mock('../src/server/lib/derivedIdErase', async (original) => ({
  ...await original<typeof import('../src/server/lib/derivedIdErase')>(), deleteUserDerivedIdData: state.deleteDerived,
}));
vi.mock('../src/server/lib/workspaceDataErase', () => ({
  deleteUserWorkspaceData: async () => ({ uid: 'alice', collections: [], totalDeleted: 3 }),
}));
vi.mock('../src/server/lib/snapshotErase', () => ({
  eraseUserSnapshots: async () => ({ workspaces: 0, bucketRemoved: 0, channelsRemoved: 0, failures: [] }),
  liveSnapshotEraseDeps: () => ({}),
}));
vi.mock('../src/server/lib/syncWorkspaceErase', () => ({
  eraseSyncedWorkspace: async () => ({ chunks: 0, manifestDeleted: false, probed: 0 }),
}));
vi.mock('../src/server/lib/publishedListingErase', () => ({
  getListingDb: () => ({}),
  deIdentifyPublishedListings: async () => ({ collections: [], totalDeleted: 0, totalDeIdentified: 0 }),
}));

const { LEGACY_HISTORY_ERASURE_LIMITATION } = await import('../src/server/lib/derivedIdErase');
const { registerProfileRoutes } = await import('../src/server/routes/profile');
const handler = captureRoutes(registerProfileRoutes).get('DELETE /api/profile')!;
beforeEach(() => {
  state.account = 'deleted';
  vi.clearAllMocks();
  state.deleteDerived.mockResolvedValue({
    uid: 'alice', collections: [], totalDeleted: 4, keys: { bots: 0, historySessions: 1 },
    limitations: [LEGACY_HISTORY_ERASURE_LIMITATION],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('account deletion reports legacy history attribution as an unresolved limitation', () => {
  it('confirms the removed account while retaining the known limitation without invented counts', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.accountDeleted).toBe(true);
    expect(res.body.message).toContain('Your account has been deleted.');
    expect(res.body.message).toContain(LEGACY_HISTORY_ERASURE_LIMITATION.message);
    expect(res.body.message).not.toMatch(/all.*data.*deleted|data.*permanently.*erased/i);
    expect(res.body.limitations).toEqual([{
      code: 'legacy-history-ownership-unverified', collection: 'build_history',
      message: LEGACY_HISTORY_ERASURE_LIMITATION.message,
    }]);
    expect(res.body.totalDeleted).toBe(2);
    expect(res.body.derived.totalDeleted).toBe(4);
    expect(JSON.stringify(res.body.limitations)).not.toMatch(/count|totalDeleted|alice/);
  });

  it('does not hide the limitation when sign-in removal fails', async () => {
    state.account = 'failed';
    const res = mockRes();
    await handler(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.body.accountDeleted).toBe(false);
    expect(res.body.message).toContain('sign-in could not be removed');
    expect(res.body.message).toContain('info@navbharatai.com');
    expect(res.body.message).toContain(LEGACY_HISTORY_ERASURE_LIMITATION.message);
    expect(res.body.message).not.toMatch(/all.*data.*deleted|data.*permanently.*erased/i);
  });

  it('still reports the known limitation when a derived eraser fails before returning a report', async () => {
    state.deleteDerived.mockRejectedValueOnce(new Error('temporary storage failure'));
    const res = mockRes();
    await handler(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.body.limitations).toEqual([LEGACY_HISTORY_ERASURE_LIMITATION]);
    expect(res.body.derived.totalDeleted).toBe(0);
    expect(res.body.derived.error).toBe('temporary storage failure');
    expect(res.body.message).not.toMatch(/all.*data.*deleted|data.*permanently.*erased/i);
  });
});
