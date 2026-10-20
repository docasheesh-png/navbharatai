import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from '../../../tests/helpers/routeTestUtils';
import * as assetStorage from './workspaceAssetStorage';
import {
  workspaceAssetBucketName,
  workspaceAssetObjectKey,
  workspaceAssetVerifiedOwnerObjectKey,
  workspaceAssetVerifiedOwnerPrefix,
} from './workspaceAssetStorage';

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
    file: (path: string) => ({
      save: async (bytes: Buffer) => { objects.set(path, Buffer.from(bytes)); },
      download: async () => {
        const bytes = objects.get(path);
        if (!bytes) throw new Error('missing object');
        return [Buffer.from(bytes)];
      },
    }),
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
  return {
    doc: (id: string) => document(`${path}/${id}`),
    get: async () => ({
      docs: [...state.documents.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(([, value]) => ({ data: () => value })),
    }),
  };
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

const { saveWorkspaceAssets, loadWorkspaceAssetsWithCompleteness } = await import('../AgentV3/WorkspaceAssetStore');
const { eraseUserWorkspaceAssetObjects } = await import('./workspaceAssetErase');
const { registerProfileRoutes } = await import('../routes/profile');
const deleteProfile = captureRoutes(registerProfileRoutes).get('DELETE /api/profile')!;
// Large enough to use the real spill branch instead of the Firestore inline-data branch.
const bytes = Buffer.alloc(710 * 1024, 17);
const image = `data:image/png;base64,${bytes.toString('base64')}`;
const legacyLimitation = 'Legacy workspace asset ownership cannot be confirmed; legacy objects are retained.';
const verifiedRemovalReport = {
  attempted: true,
  removed: false,
  verifiedOwnerObjectsRemoved: true,
  failures: [],
  limitations: [legacyLimitation],
};
const assetId = (path: string) => Buffer.from(path).toString('base64url');
const verifiedKey = (uid: string, workspace: string, path: string) =>
  workspaceAssetVerifiedOwnerObjectKey(uid, workspace, assetId(path))!;

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
  it('the real upload and registered erase isolate abc from abc-d even when their legacy workspace ids collide', async () => {
    // Both uid=abc/session=d-session1 and uid=abc-d/session=session1 construct this legacy ID.
    const ambiguousWorkspace = 'agentv3-abc-d-session1';
    await saveWorkspaceAssets(ambiguousWorkspace, { 'public/photo.png': image }, 'abc');
    await saveWorkspaceAssets('agentv3-abc-session2', { 'public/other.png': image }, 'abc');
    await saveWorkspaceAssets(ambiguousWorkspace, { 'public/photo.png': image }, 'abc-d');
    await saveWorkspaceAssets('agentv3-abcd-session1', { 'public/photo.png': image }, 'abcd');
    await saveWorkspaceAssets('agentv3-abc-legacy', { 'legacy.png': image });
    await saveWorkspaceAssets('agentv3-abc-d-legacy', { 'legacy.png': image });
    const objects = state.objects.get('private-assets')!;
    expect([...objects.values()].every((value) => value.equals(bytes))).toBe(true);
    expect(objects.size).toBe(6);
    expect([...state.documents.values()].filter((doc) => doc.storageObject).length).toBe(5);
    await bucket('private-assets').file('published-apps/a-example/index.html').save(Buffer.from('keep published copy'));
    await bucket('private-assets').file('workspace-assets/agentv3-anon-session/file').save(Buffer.from('keep anonymous'));
    await bucket('private-apks').file('store-apks/app.apk').save(Buffer.from('keep APK'));

    const res = mockRes();
    await deleteProfile(mockReq({ body: { confirm: 'DELETE' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.accountDeleted).toBe(true);
    expect(objects.has(workspaceAssetObjectKey('agentv3-abc-d-legacy', assetId('legacy.png')))).toBe(true);
    expect(objects.has(verifiedKey('abc-d', ambiguousWorkspace, 'public/photo.png'))).toBe(true);
    expect(objects.has(verifiedKey('abc', ambiguousWorkspace, 'public/photo.png'))).toBe(false);
    expect(res.body.workspaceAssetObjects).toEqual(verifiedRemovalReport);
    expect([...objects.keys()].sort()).toEqual([
      verifiedKey('abc-d', ambiguousWorkspace, 'public/photo.png'),
      verifiedKey('abcd', 'agentv3-abcd-session1', 'public/photo.png'),
      workspaceAssetObjectKey('agentv3-abc-legacy', assetId('legacy.png')),
      workspaceAssetObjectKey('agentv3-abc-d-legacy', assetId('legacy.png')),
      'workspace-assets/agentv3-anon-session/file',
      'published-apps/a-example/index.html',
    ].sort());
    expect(state.deletes).toEqual([{ bucket: 'private-assets', prefix: 'workspace-assets-v2/YWJj/' }]);
    expect(state.objects.get('private-apks')?.has('store-apks/app.apk')).toBe(true);
    expect(state.documents.size).toBe(0);
    expect(res.body.totalDeleted).toBe(2); // Bucket results never become invented Firestore counts.
    expect(res.body.apps.totalDeleted).toBe(3);
  });

  it('can remove existing spills even after their Firestore pointer metadata was already erased', async () => {
    await saveWorkspaceAssets('agentv3-abc-session1', { 'photo.png': image }, 'abc');
    state.documents.clear();
    const result = await eraseUserWorkspaceAssetObjects('abc');
    expect(result).toEqual(verifiedRemovalReport);
    expect(state.objects.get('private-assets')?.size).toBe(0);
    // The exact-owner namespace remains independently retryable after metadata is gone.
    expect(await eraseUserWorkspaceAssetObjects('abc')).toEqual(result);
  });

  it('does not report partial bucket removal as successful or leak storage details, and a retry finishes it', async () => {
    await saveWorkspaceAssets('agentv3-abc-session1', { 'a.png': image, 'b.png': image }, 'abc');
    state.failDelete = true;
    const res = mockRes();
    await deleteProfile(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.body.accountDeleted).toBe(true);
    expect(res.body.workspaceAssetObjects).toEqual({
      ...verifiedRemovalReport,
      verifiedOwnerObjectsRemoved: false,
      failures: ['Workspace asset storage could not confirm removal.'],
    });
    expect(JSON.stringify(res.body.workspaceAssetObjects)).not.toContain('internal-bucket-details');
    expect(state.objects.get('private-assets')?.size).toBe(1);
    state.failDelete = false;
    expect(await eraseUserWorkspaceAssetObjects('abc')).toEqual(verifiedRemovalReport);
    expect(state.objects.get('private-assets')?.size).toBe(0);
  });

  it('reports unconfigured storage as unconfirmed without touching a bucket', async () => {
    for (const key of ['WORKSPACE_ASSETS_BUCKET', 'NAV_STORE_BUCKET', 'FIREBASE_STORAGE_BUCKET']) vi.stubEnv(key, '');
    const result = await eraseUserWorkspaceAssetObjects('abc');
    expect(result.attempted).toBe(false);
    expect(result.removed).toBe(false);
    expect(result.verifiedOwnerObjectsRemoved).toBe(false);
    expect(result.limitations).toEqual([legacyLimitation]);
    expect(result.failures).toEqual(['Workspace asset storage is not configured; removal could not be confirmed.']);
    expect(state.deletes).toEqual([]);
  });

  it('keeps unexpected eraser exceptions honestly unconfirmed in the registered route fallback', async () => {
    await saveWorkspaceAssets('agentv3-abc-session1', { 'a.png': image }, 'abc');
    const prefix = vi.spyOn(assetStorage, 'workspaceAssetVerifiedOwnerPrefix').mockImplementationOnce(() => {
      throw new Error('unexpected internal-owner-details');
    });
    const res = mockRes();
    try {
      await deleteProfile(mockReq({ body: { confirm: 'DELETE' } }), res);
    } finally {
      prefix.mockRestore();
    }
    expect(res.statusCode).toBe(200);
    expect(res.body.accountDeleted).toBe(true);
    expect(res.body.workspaceAssetObjects).toEqual({
      ...verifiedRemovalReport,
      attempted: false,
      verifiedOwnerObjectsRemoved: false,
      failures: ['Workspace asset storage could not confirm removal.'],
    });
    expect(JSON.stringify(res.body.workspaceAssetObjects)).not.toContain('internal-owner-details');
    expect(state.deletes).toEqual([]);
    expect(state.objects.get('private-assets')!.has(verifiedKey('abc', 'agentv3-abc-session1', 'a.png'))).toBe(true);
  });

  it.each(['', 'has space', '../abc', 'anon', ' abc', 'abc ', 'a'.repeat(65)])('refuses unusable ownership input %j before storage effects', async (uid) => {
    const result = await eraseUserWorkspaceAssetObjects(uid);
    expect(result.refusal).toBe('unusable-uid');
    expect(result.attempted).toBe(false);
    expect(result.removed).toBe(false);
    expect(result.verifiedOwnerObjectsRemoved).toBe(false);
    expect(state.deletes).toEqual([]);
  });

  it('can erase a verified hyphenated owner without deleting its shorter neighbor or legacy objects', async () => {
    const workspace = 'agentv3-abc-d-session1';
    await saveWorkspaceAssets(workspace, { 'a.png': image }, 'abc-d');
    await saveWorkspaceAssets(workspace, { 'a.png': image }, 'abc');
    await saveWorkspaceAssets(workspace, { 'a.png': image });
    expect(await eraseUserWorkspaceAssetObjects('abc-d')).toEqual(verifiedRemovalReport);
    expect([...state.objects.get('private-assets')!.keys()].sort()).toEqual([
      verifiedKey('abc', workspace, 'a.png'),
      workspaceAssetObjectKey(workspace, assetId('a.png')),
    ].sort());
    expect(state.deletes).toEqual([{ bucket: 'private-assets', prefix: 'workspace-assets-v2/YWJjLWQ/' }]);
  });

  it('keeps legacy and verified-owner pointers readable without inferring ownership from their workspace id', async () => {
    await saveWorkspaceAssets('agentv3-abc-legacy', { 'old.png': image });
    await saveWorkspaceAssets('agentv3-abc-current', { 'new.png': image }, 'abc');
    expect(await loadWorkspaceAssetsWithCompleteness('agentv3-abc-legacy')).toEqual({
      assets: { 'old.png': image }, complete: true, oversized: [],
    });
    expect(await loadWorkspaceAssetsWithCompleteness('agentv3-abc-current')).toEqual({
      assets: { 'new.png': image }, complete: true, oversized: [],
    });
  });

  it.each([undefined, null, 'anon', 'bad/owner'])('retains unverified writer fallback for owner %j', async (owner) => {
    await saveWorkspaceAssets('agentv3-abc-session1', { 'a.png': image }, owner);
    expect(await eraseUserWorkspaceAssetObjects('abc')).toEqual(verifiedRemovalReport);
    expect([...state.objects.get('private-assets')!.keys()]).toEqual([
      workspaceAssetObjectKey('agentv3-abc-session1', assetId('a.png')),
    ]);
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
    await saveWorkspaceAssets('agentv3-abc-session1', { 'a.png': image }, 'abc');
    expect(state.objects.get(expected)?.size).toBe(1);
    expect(await eraseUserWorkspaceAssetObjects('abc')).toEqual(verifiedRemovalReport);
    expect(state.deletes[0].bucket).toBe(expected);
    expect(state.objects.get(expected)?.size).toBe(0);
  });
});

describe('verified owner object identity', () => {
  it('encodes exact owner and workspace components and terminates the owner prefix with a slash', () => {
    const shortOwner = Buffer.from('abc').toString('base64url');
    const longerOwner = Buffer.from('abc-d').toString('base64url');
    expect(longerOwner.startsWith(shortOwner)).toBe(true);
    const workspace = 'agentv3-abc-d-session/with:separators';
    const key = workspaceAssetVerifiedOwnerObjectKey('abc-d', workspace, 'asset-id')!;
    expect(key).toBe(`workspace-assets-v2/${longerOwner}/${Buffer.from(workspace).toString('base64url')}/asset-id`);
    expect(key.startsWith(workspaceAssetVerifiedOwnerPrefix('abc')!)).toBe(false);
    expect(key.split('/')).toHaveLength(4);
    expect(workspaceAssetVerifiedOwnerPrefix('abc')).toBe(`workspace-assets-v2/${shortOwner}/`);
    expect(workspaceAssetVerifiedOwnerPrefix('anon')).toBeNull();
    expect(workspaceAssetVerifiedOwnerPrefix('bad/owner')).toBeNull();
  });
});
