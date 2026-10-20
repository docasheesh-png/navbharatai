import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../tests/helpers/routeTestUtils';
import { workspaceAssetBucketName } from './workspaceAssetStorage';

const state = vi.hoisted(() => ({
  objects: new Map<string, Map<string, Buffer>>(),
  documents: new Map<string, Record<string, unknown>>(),
  deletes: [] as Array<{ bucket: string; prefix: string }>,
  failDelete: false,
  uid: 'abc' as string | null,
  retentionAvailable: true,
  deleteAccount: vi.fn(),
}));

function bucket(name: string) {
  let objects = state.objects.get(name);
  if (!objects) { objects = new Map(); state.objects.set(name, objects); }
  return {
    file: (path: string) => ({ save: async (bytes: Buffer) => { objects.set(path, Buffer.from(bytes)); } }),
    deleteFiles: async ({ prefix }: { prefix: string }) => {
      state.deletes.push({ bucket: name, prefix });
      const matches = [...objects.keys()].filter((path) => path.startsWith(prefix));
      for (const path of matches) {
        objects.delete(path);
        if (state.failDelete) throw new Error('partial storage failure: internal-bucket-details');
      }
      if (state.failDelete) throw new Error('storage failure: internal-bucket-details');
    },
  };
}

function collection(path: string) {
  return { doc: (id: string) => document(`${path}/${id}`) };
}
function document(path: string) {
  return {
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ exists: state.documents.has(path), data: () => state.documents.get(path) }),
    set: async (value: Record<string, unknown>) => { state.documents.set(path, value); },
  };
}
const database = {
  collection,
  batch: () => {
    const writes: Array<() => Promise<void>> = [];
    return {
      set: (ref: ReturnType<typeof document>, data: Record<string, unknown>) => { writes.push(() => ref.set(data)); },
      commit: async () => { for (const write of writes) await write(); },
    };
  },
};

vi.mock('firebase-admin', async (original) => ({
  ...await original<typeof import('firebase-admin')>(), storage: () => ({ bucket }),
}));
vi.mock('./serverDb', async (original) => ({
  ...await original<typeof import('./serverDb')>(), getServerDb: () => database,
}));
vi.mock('./authMiddleware', async (original) => ({
  ...await original<typeof import('./authMiddleware')>(),
  verifyFirebaseIdentity: async () => state.uid ? { uid: state.uid, email: null } : null,
  deleteAuthAccount: state.deleteAccount,
}));
vi.mock('./DataRetentionManager', async (original) => ({
  ...await original<typeof import('./DataRetentionManager')>(),
  getRetentionDb: () => state.retentionAvailable ? {} : null,
  deleteUserData: async () => ({ collections: [], totalDeleted: 2 }),
}));
vi.mock('./derivedIdErase', async (original) => ({
  ...await original<typeof import('./derivedIdErase')>(),
  deleteUserDerivedIdData: async () => ({ collections: [], totalDeleted: 0 }),
}));
vi.mock('./workspaceDataErase', async (original) => ({
  ...await original<typeof import('./workspaceDataErase')>(),
  deleteUserWorkspaceData: async () => {
    state.documents.clear();
    return { collections: [], totalDeleted: 3 };
  },
}));
vi.mock('./snapshotErase', () => ({
  liveSnapshotEraseDeps: () => ({}),
  eraseUserSnapshots: async () => ({ workspaces: 0, bucketRemoved: 0, channelsRemoved: 0, failures: [] }),
}));
vi.mock('./syncWorkspaceErase', () => ({
  eraseSyncedWorkspace: async () => ({ chunks: 0, manifestDeleted: false, probed: 0 }),
}));
vi.mock('./publishedListingErase', () => ({
  getListingDb: () => ({}),
  deIdentifyPublishedListings: async () => ({ collections: [], totalDeleted: 0, totalDeIdentified: 0 }),
}));

const { saveWorkspaceAssets } = await import('../AgentV3/WorkspaceAssetStore');
const { eraseUserWorkspaceAssetObjects } = await import('./workspaceAssetErase');
const { registerProfileRoutes } = await import('../routes/profile');
const deleteProfile = captureRoutes(registerProfileRoutes).get('DELETE /api/profile')!;
// Large enough to use the real spill branch instead of the Firestore inline-data branch.
const bytes = Buffer.alloc(710 * 1024, 17);
const image = `data:image/png;base64,${bytes.toString('base64')}`;

beforeEach(() => {
  state.objects.clear(); state.documents.clear(); state.deletes.length = 0;
  state.failDelete = false; state.uid = 'abc'; state.retentionAvailable = true;
  state.deleteAccount.mockReset().mockResolvedValue('deleted');
  vi.stubEnv('VITEST', ''); // Exercise the actual production save path against the injected stores.
  vi.stubEnv('WORKSPACE_ASSETS_BUCKET', 'private-assets');
  vi.stubEnv('NAV_STORE_BUCKET', 'private-apks');
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'firebase-private');
});
afterEach(() => vi.unstubAllEnvs());

describe('completed private asset spills leave with their verified owner', () => {
  it('the real upload and registered account erase remove bytes while preserving other owners and namespaces', async () => {
    await saveWorkspaceAssets('agentv3-abc-session1', { 'public/photo.png': image });
    await saveWorkspaceAssets('agentv3-abc-session2', { 'public/other.png': image });
    await saveWorkspaceAssets('agentv3-abcd-session1', { 'public/photo.png': image });
    const objects = state.objects.get('private-assets')!;
    expect([...objects.values()].every((value) => value.equals(bytes))).toBe(true);
    expect(objects.size).toBe(3);
    expect([...state.documents.values()].filter((doc) => doc.storageObject).length).toBe(3);
    await bucket('private-assets').file('published-apps/a-example/index.html').save(Buffer.from('keep published copy'));
    await bucket('private-assets').file('workspace-assets/agentv3-anon-session/file').save(Buffer.from('keep anonymous'));
    await bucket('private-apks').file('store-apks/app.apk').save(Buffer.from('keep APK'));

    const res = mockRes();
    await deleteProfile(mockReq({ body: { confirm: 'DELETE' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.accountDeleted).toBe(true);
    expect(res.body.workspaceAssetObjects).toEqual({ attempted: true, removed: true, failures: [] });
    expect([...objects.keys()].sort()).toEqual([
      `workspace-assets/agentv3-abcd-session1/${Buffer.from('public/photo.png').toString('base64url')}`,
      'workspace-assets/agentv3-anon-session/file',
      'published-apps/a-example/index.html',
    ].sort());
    expect(state.deletes).toEqual([{ bucket: 'private-assets', prefix: 'workspace-assets/agentv3-abc-' }]);
    expect(state.objects.get('private-apks')?.has('store-apks/app.apk')).toBe(true);
    expect(state.documents.size).toBe(0);
    expect(res.body.totalDeleted).toBe(2); // Bucket results never become invented Firestore counts.
    expect(res.body.apps.totalDeleted).toBe(3);
  });

  it('can remove existing spills even after their Firestore pointer metadata was already erased', async () => {
    await saveWorkspaceAssets('agentv3-abc-session1', { 'photo.png': image });
    state.documents.clear();
    const result = await eraseUserWorkspaceAssetObjects('abc');
    expect(result).toEqual({ attempted: true, removed: true, failures: [] });
    expect(state.objects.get('private-assets')?.size).toBe(0);
    // The exact-owner namespace remains independently retryable after metadata is gone.
    expect(await eraseUserWorkspaceAssetObjects('abc')).toEqual(result);
  });

  it('does not report partial bucket removal as successful or leak storage details, and a retry finishes it', async () => {
    await saveWorkspaceAssets('agentv3-abc-session1', { 'a.png': image, 'b.png': image });
    state.failDelete = true;
    const res = mockRes();
    await deleteProfile(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.body.accountDeleted).toBe(true);
    expect(res.body.workspaceAssetObjects).toEqual({
      attempted: true, removed: false, failures: ['Workspace asset storage could not confirm removal.'],
    });
    expect(JSON.stringify(res.body.workspaceAssetObjects)).not.toContain('internal-bucket-details');
    expect(state.objects.get('private-assets')?.size).toBe(1);
    state.failDelete = false;
    expect((await eraseUserWorkspaceAssetObjects('abc')).removed).toBe(true);
    expect(state.objects.get('private-assets')?.size).toBe(0);
  });

  it('reports unconfigured storage as unconfirmed without touching a bucket', async () => {
    for (const key of ['WORKSPACE_ASSETS_BUCKET', 'NAV_STORE_BUCKET', 'FIREBASE_STORAGE_BUCKET']) vi.stubEnv(key, '');
    const result = await eraseUserWorkspaceAssetObjects('abc');
    expect(result.attempted).toBe(false);
    expect(result.removed).toBe(false);
    expect(result.failures).toEqual(['Workspace asset storage is not configured; removal could not be confirmed.']);
    expect(state.deletes).toEqual([]);
  });

  it.each(['abc-d', '', 'has space', '../abc', 'anon'])('refuses unsafe ownership input %j before storage effects', async (uid) => {
    const result = await eraseUserWorkspaceAssetObjects(uid);
    expect(result.refusal).toMatch(/ambiguous-uid|unusable-uid/);
    expect(result.attempted).toBe(false);
    expect(result.removed).toBe(false);
    expect(state.deletes).toEqual([]);
  });

  it.each(['unauthenticated', 'unconfirmed', 'unavailable-retention'])('preserves the route admission boundary: %s', async (scenario) => {
    if (scenario === 'unauthenticated') state.uid = null;
    if (scenario === 'unavailable-retention') state.retentionAvailable = false;
    const res = mockRes();
    await deleteProfile(mockReq({ body: { confirm: scenario === 'unconfirmed' ? 'wrong' : 'DELETE' } }), res);
    expect(res.statusCode).toBe(scenario === 'unauthenticated' ? 401 : scenario === 'unconfirmed' ? 400 : 503);
    expect(state.deletes).toEqual([]);
    expect(state.deleteAccount).not.toHaveBeenCalled();
  });
});

describe('the storage selection is shared with the real spill writer', () => {
  it.each([
    [{ WORKSPACE_ASSETS_BUCKET: 'dedicated', NAV_STORE_BUCKET: 'apk', FIREBASE_STORAGE_BUCKET: 'firebase' }, 'dedicated'],
    [{ WORKSPACE_ASSETS_BUCKET: '', NAV_STORE_BUCKET: 'apk', FIREBASE_STORAGE_BUCKET: 'firebase' }, 'apk'],
    [{ WORKSPACE_ASSETS_BUCKET: '', NAV_STORE_BUCKET: '', FIREBASE_STORAGE_BUCKET: 'firebase' }, 'firebase'],
  ])('honors the established bucket precedence %j', async (env, expected) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    expect(workspaceAssetBucketName()).toBe(expected);
    await saveWorkspaceAssets('agentv3-abc-session1', { 'a.png': image });
    expect(state.objects.get(expected)?.size).toBe(1);
    expect((await eraseUserWorkspaceAssetObjects('abc')).removed).toBe(true);
    expect(state.deletes[0].bucket).toBe(expected);
    expect(state.objects.get(expected)?.size).toBe(0);
  });
});
