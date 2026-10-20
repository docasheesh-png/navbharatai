import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const state = vi.hoisted(() => ({
  uid: 'abc' as string | null,
  docs: new Map<string, Record<string, unknown>>(),
  deleted: [] as string[],
  queried: [] as string[],
  bucketCopies: new Set<string>(),
  channels: new Set<string>(),
  listedSnapshots: 0,
  authDeletes: vi.fn(),
}));
function document(path: string): any {
  return {
    id: path.slice(path.lastIndexOf('/') + 1), path,
    get firestore() { return db; },
    collection: (sub: string) => collection(`${path}/${sub}`),
    get: async () => { state.queried.push(path); return snapshot(path); },
    delete: async () => { state.deleted.push(path); state.docs.delete(path); },
  };
}
function snapshot(path: string): any {
  const ref = document(path);
  return { id: ref.id, ref, exists: state.docs.has(path), data: () => state.docs.get(path), get: (field: string) => state.docs.get(path)?.[field] };
}
function collection(path: string): any {
  const filters: Array<(key: string, value: Record<string, unknown>) => boolean> = [];
  let orderField = '__name__'; let cap = Infinity;
  const query: any = {
    doc: (id: string) => document(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => {
      filters.push((_key, data) => op === '==' ? data[field] === value : op === '>=' ? String(data[field]) >= String(value) : String(data[field]) <= String(value));
      return query;
    },
    orderBy: (field: unknown) => { orderField = typeof field === 'string' ? field : '__name__'; return query; },
    startAt: (bound: string) => { filters.push((key, value) => String(orderField === '__name__' ? key.split('/').at(-1) : value[orderField]) >= bound); return query; },
    endAt: (bound: string) => { filters.push((key, value) => String(orderField === '__name__' ? key.split('/').at(-1) : value[orderField]) <= bound); return query; },
    startAfter: (bound: string) => { filters.push((key) => key.split('/').at(-1)! > bound); return query; },
    select: () => query,
    limit: (n: number) => { cap = n; return query; },
    listDocuments: async () => (await query.get()).docs.map((entry: any) => entry.ref),
    get: async () => {
      state.queried.push(path);
      const docs = [...state.docs.entries()].filter(([key, value]) => key.startsWith(`${path}/`)
        && !key.slice(path.length + 1).includes('/') && filters.every((test) => test(key, value)))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, cap).map(([key]) => snapshot(key));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  };
  return query;
}
const db = {
  collection,
  batch: () => {
    const refs: any[] = [];
    return { delete: (ref: any) => refs.push(ref), commit: async () => { for (const ref of refs) await ref.delete(); } };
  },
};
vi.mock('../src/server/lib/serverDb', async (original) => ({
  ...await original<typeof import('../src/server/lib/serverDb')>(), getServerDb: () => db,
}));
vi.mock('firebase-admin', async (original) => ({
  ...await original<typeof import('firebase-admin')>(), apps: [{}], initializeApp: vi.fn(),
  firestore: Object.assign(() => db, { FieldPath: { documentId: () => '__name__' } }),
}));
vi.mock('../src/server/lib/authMiddleware', async (original) => ({
  ...await original<typeof import('../src/server/lib/authMiddleware')>(),
  verifyFirebaseIdentity: async () => state.uid ? { uid: state.uid, email: null } : null,
  deleteAuthAccount: state.authDeletes,
}));
vi.mock('../src/server/lib/DataRetentionManager', async (original) => ({
  ...await original<typeof import('../src/server/lib/DataRetentionManager')>(),
  getRetentionDb: () => db,
}));
vi.mock('../src/server/lib/snapshotErase', async (original) => ({
  ...await original<typeof import('../src/server/lib/snapshotErase')>(),
  liveSnapshotEraseDeps: () => ({
    listWorkspaceIds: async () => { state.listedSnapshots++; return [...state.bucketCopies]; },
    removeBucket: async (sub: string) => { state.bucketCopies.delete(sub); return { attempted: true, deleted: true }; },
    deleteChannel: async (id: string) => { state.channels.delete(id); return true; },
  }),
}));
vi.mock('../src/server/lib/workspaceAssetErase', async (original) => ({
  ...await original<typeof import('../src/server/lib/workspaceAssetErase')>(),
  eraseUserWorkspaceAssetObjects: async () => ({ attempted: false, removed: false, verifiedOwnerObjectsRemoved: false, failures: [], limitations: [] }),
}));
vi.mock('../src/server/lib/publishedListingErase', () => ({
  getListingDb: () => db,
  deIdentifyPublishedListings: async () => ({ collections: [], totalDeleted: 0, totalDeIdentified: 0 }),
}));

const { registerProfileRoutes } = await import('../src/server/routes/profile');
const { WORKSPACE_OWNERSHIP_ERASURE_LIMITATION } = await import('../src/server/lib/derivedIdErase');
const handler = captureRoutes(registerProfileRoutes).get('DELETE /api/profile')!;
const bot = 'a1b2c3d4e5f60718293a4b5c';
const foreignBot = 'b1b2c3d4e5f60718293a4b5c';
const ws = 'agentv3-abc-d-session1';

beforeEach(() => {
  state.uid = 'abc'; state.docs.clear(); state.deleted.length = 0; state.queried.length = 0;
  state.bucketCopies.clear(); state.channels.clear(); state.listedSnapshots = 0;
  state.authDeletes.mockReset().mockResolvedValue('deleted');
  vi.stubEnv('VITEST', ''); // Real erasers execute against the stateful injected database.
  state.docs.set(`workspace_files_v3/${ws}`, { paths: ['src/main.ts'] });
  state.docs.set(`workspace_files_v3/${ws}/files/main`, { path: 'src/main.ts', content: 'foreign source' });
  state.docs.set(`build_history_v2/${ws}`, { workspaceId: ws, storageVersion: 2 });
  state.docs.set(`build_history_v2/${ws}/versions/v1`, { files: { 'src/main.ts': 'foreign source' } });
  state.docs.set(`build_sessions_v2/${ws}`, { result: 'foreign result' });
  state.docs.set('build_events/foreign', { workspaceId: ws, payload: 'foreign event' });
  // An own source row cannot prove who last wrote bytes under the colliding workspace key.
  state.docs.set('user_build_history/own', { userId: 'abc', sessionId: 'd-session1' });
  state.docs.set('users/abc', { displayName: 'Own account data' });
  state.docs.set(`bots/${bot}`, { ownerUid: 'abc' });
  state.docs.set(`bots/${foreignBot}`, { ownerUid: 'abc-d' });
  state.docs.set(`bot_sessions/${bot}_chat1`, { messages: ['own bot history'] });
  state.docs.set(`bot_sessions/${foreignBot}_chat1`, { messages: ['foreign bot history'] });
  state.docs.set('user_workspaces/abc', { version: 2, chunkCount: 1 });
  // UID abc's chunk 0 is also UID abc__c0's manifest. Exact key construction is not ownership proof.
  state.docs.set('user_workspaces/abc__c0', { version: 2, chunkCount: 1, foreignManifest: true });
  state.docs.set('user_workspaces/abc__c0__c0', { data: 'foreign synced content' });
  state.docs.set(`agentv3_conversations/${ws}`, { userId: 'abc', workspaceId: ws });
  state.docs.set(`agentv3_conversations/${ws}/turns/foreign`, { content: 'foreign appended conversation' });
  state.docs.set(`agentv3_conversations/${ws}/timeline/foreign`, { content: 'foreign appended timeline' });
  state.bucketCopies.add(ws); state.channels.add('foreign-channel');
});
afterEach(() => vi.unstubAllEnvs());

describe('registered account deletion never turns a legacy UID prefix into foreign ownership', () => {
  it('abc retains abc-d source, histories, events and hosted snapshots while exact verified bot ownership still erases its own sessions', async () => {
    const ownExactPaths = [`bot_sessions/${bot}_chat1`, `bots/${bot}`, 'users/abc', 'user_build_history/own'];
    const preserved = [...state.docs.entries()].filter(([path]) => !ownExactPaths.includes(path));
    const res = mockRes();
    await handler(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.derived.collections.find((entry: any) => entry.collection === 'bot_sessions')).toMatchObject({ documents: 1, error: undefined });
    for (const [path, value] of preserved) expect(state.docs.get(path), path).toEqual(value);
    expect(state.docs.has(`bot_sessions/${bot}_chat1`)).toBe(false);
    expect(state.deleted.sort()).toEqual(ownExactPaths.sort());
    expect(res.body.apps).toEqual({ uid: 'abc', collections: [], totalDeleted: 0, refusal: 'ownership-unverified' });
    expect(res.body.snapshots).toMatchObject({ workspaces: 0, bucketRemoved: 0, channelsRemoved: 0, refusal: 'ownership-unverified' });
    expect(res.body.synced).toMatchObject({ chunks: 0, manifestDeleted: false, probed: 0, refusal: 'ownership-unverified' });
    expect(state.listedSnapshots).toBe(0);
    expect([...state.bucketCopies]).toEqual([ws]);
    expect([...state.channels]).toEqual(['foreign-channel']);
    expect(res.body.derived.keys).toEqual({ bots: 1, historySessions: 0 });
    expect(res.body.derived.totalDeleted).toBe(1);
    expect(res.body.derived.limitations).toContainEqual(WORKSPACE_OWNERSHIP_ERASURE_LIMITATION);
    expect(res.body.collections.find((entry: any) => entry.collection === 'agentv3_conversations'))
      .toMatchObject({ deleted: 0, refusal: 'ownership-unverified' });
    expect(res.body.collections.filter((entry: any) => entry.error && entry.refusal !== 'ownership-unverified')).toEqual([]);
    expect(state.queried.some((path) => /workspace_files_v3|build_history_v2|build_sessions_v2|build_events|user_workspaces/.test(path))).toBe(false);
    expect(state.authDeletes).toHaveBeenCalledWith('abc');
  });

  it('a chunk-shaped verified UID cannot erase the other account\'s colliding sync chunk as its own manifest', async () => {
    state.uid = 'abc__c0';
    const preserved = [...state.docs.entries()];
    const res = mockRes();
    await handler(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.statusCode).toBe(200);
    expect([...state.docs.entries()]).toEqual(preserved);
    expect(res.body.synced).toMatchObject({ chunks: 0, manifestDeleted: false, probed: 0, refusal: 'ownership-unverified' });
    expect(state.deleted).toEqual([]);
    expect(state.queried.some((path) => path.startsWith('user_workspaces'))).toBe(false);
  });

  it.each([null, ''])('refuses an unverified account without touching retained bytes (%s)', async (uid) => {
    state.uid = uid;
    const before = [...state.docs.entries()];
    const res = mockRes();
    await handler(mockReq({ body: { confirm: 'DELETE' } }), res);
    expect(res.statusCode).toBe(401);
    expect([...state.docs.entries()]).toEqual(before);
    expect(state.queried).toEqual([]);
    expect(state.authDeletes).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before destructive exact-owner work too', async () => {
    const res = mockRes();
    await handler(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(state.deleted).toEqual([]);
    expect(state.queried).toEqual([]);
  });
});
