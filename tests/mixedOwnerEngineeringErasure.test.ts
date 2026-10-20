import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  documents: new Map<string, Record<string, any>>(),
  deleted: [] as string[],
}));
function document(path: string): any {
  const ref: any = {
    path, id: path.split('/').at(-1),
    collection: (sub: string) => collection(`${path}/${sub}`),
    get: async () => ({ id: ref.id, ref, exists: state.documents.has(path),
      data: () => structuredClone(state.documents.get(path)), get: (field: string) => state.documents.get(path)?.[field] }),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
      state.documents.set(path, structuredClone(options?.merge ? { ...state.documents.get(path), ...data } : data));
    },
    delete: async () => { state.deleted.push(path); state.documents.delete(path); },
  };
  return ref;
}
function collection(path: string): any {
  const filters: Array<(data: Record<string, any>) => boolean> = [];
  let cap = Infinity;
  const query: any = {
    doc: (id: string) => document(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => { filters.push((data) => data[field] === value); return query; },
    limit: (n: number) => { cap = n; return query; },
    get: async () => {
      const docs = await Promise.all([...state.documents.entries()]
        .filter(([key, data]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/') && filters.every((test) => test(data)))
        .slice(0, cap).map(([key]) => document(key).get()));
      return { docs, empty: !docs.length, size: docs.length };
    },
    listDocuments: async () => (await query.get()).docs.map((snap: any) => snap.ref),
  };
  return query;
}
const db: any = {
  doc: document, collection,
  runTransaction: async (body: (tx: any) => Promise<any>) => {
    const writes: Array<() => Promise<unknown>> = [];
    const value = await body({ get: (ref: any) => ref.get(), set: (ref: any, data: any, options: any) => writes.push(() => ref.set(data, options)) });
    for (const write of writes) await write();
    return value;
  },
};
vi.mock('../src/server/lib/serverDb', async (original) => ({
  ...await original<typeof import('../src/server/lib/serverDb')>(), getServerDb: () => db,
}));
vi.mock('firebase-admin', async (original) => ({
  ...await original<typeof import('firebase-admin')>(), apps: [{}], initializeApp: vi.fn(),
}));
const { adrStore } = await import('../src/server/AgentV3/adrMemory');
const { recordDebt } = await import('../src/server/AppMakerLab/intelligence/TechnicalDebtTracker');
const { appAiRegistryStore } = await import('../src/server/lib/AppAiRegistryStore');
const { deleteUserData } = await import('../src/server/lib/DataRetentionManager');
const { workspaceIdFor, safeWorkspaceUid } = await import('../src/server/lib/workspaceIdentity');
const { SESSION_ID_RE } = await import('../src/server/lib/identityPolicy');
const { siteIdForWorkspace } = await import('../src/server/lib/firebaseCustomDomain');

beforeEach(() => {
  state.documents.clear(); state.deleted.length = 0;
  vi.stubEnv('VITEST', ''); vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => vi.unstubAllEnvs());

// Both pairs satisfy the LIVE build's UID/session rules. No forged token or arbitrary
// project id is needed: AgentV3 passes these verified UIDs and derived workspace IDs.
const own = 'abc';
const other = 'abc__agentv3-abc-x';
const ownSession = 'x__agentv3-abc__agentv3-abc-x-session1';
const otherSession = 'session1';

describe('a latest userId field cannot authorize erasing mixed-owner historical arrays', () => {
  it.each(['adrDecisions', 'techDebt'])('real ADR/debt writers mix valid owners, and actual account erasure retains %s', async (collectionName) => {
    expect(safeWorkspaceUid(own)).toBe(own); expect(safeWorkspaceUid(other)).toBe(other);
    expect(SESSION_ID_RE.test(ownSession)).toBe(true); expect(SESSION_ID_RE.test(otherSession)).toBe(true);
    const ownWorkspace = workspaceIdFor(own, ownSession)!;
    const otherWorkspace = workspaceIdFor(other, otherSession)!;
    const key = `${own}__${ownWorkspace}`;
    expect(key).toBe(`${other}__${otherWorkspace}`);

    expect(await adrStore.record(other, otherWorkspace, { framework: 'vue', files: {} }, '2026-10-19T00:00:00Z')).not.toBeNull();
    expect(await adrStore.record(own, ownWorkspace, { framework: 'react', files: {} }, '2026-10-20T00:00:00Z')).not.toBeNull();
    await recordDebt(other, otherWorkspace, [{ category: 'security', severity: 'high', message: 'foreign original finding' }], '2026-10-19T00:00:00Z');
    await recordDebt(own, ownWorkspace, [{ category: 'runtime', severity: 'medium', message: 'own later finding' }], '2026-10-20T00:00:00Z');

    const adr = state.documents.get(`adrDecisions/${key}`)!;
    const debt = state.documents.get(`techDebt/${key}`)!;
    expect(adr.userId).toBe(own); expect(adr.records.map((record: any) => record.framework)).toEqual(['vue', 'react']);
    expect(debt.userId).toBe(own); expect(debt.items.map((item: any) => item.message)).toEqual(['foreign original finding', 'own later finding']);
    state.documents.set('users/abc', { own: true });
    const before = structuredClone({ adr, debt });
    const report = await deleteUserData(db, own);
    expect(state.documents.get(`${collectionName}/${key}`)).toEqual(collectionName === 'adrDecisions' ? before.adr : before.debt);
    expect(state.documents.has('users/abc')).toBe(false);
    expect(state.deleted).toEqual(['users/abc']);
    for (const name of ['adrDecisions', 'techDebt']) {
      expect(report.collections.find((entry) => entry.collection === name)).toMatchObject({ deleted: 0, refusal: 'ownership-unverified' });
    }
  });

  it('the real app identity writer retains the prior owner nonce at a collided workspace hash; userId cannot authorize deleting it', async () => {
    const workspace = workspaceIdFor('abc-d', 'session1')!;
    expect(workspace).toBe(workspaceIdFor('abc', 'd-session1'));
    const appId = siteIdForWorkspace(workspace);
    expect(await appAiRegistryStore.mint(appId, workspace, 'abc-d', 'foreign-published-generation')).toBe(true);
    expect(await appAiRegistryStore.mint(appId, workspace, 'abc', 'own-published-generation')).toBe(true);
    const row = structuredClone(state.documents.get(`app_ai_apps/${appId}`)!);
    expect(row).toMatchObject({ userId: 'abc', workspaceId: workspace, nonce: 'own-published-generation', prevNonce: 'foreign-published-generation' });
    const report = await deleteUserData(db, 'abc');
    expect(state.documents.get(`app_ai_apps/${appId}`)).toEqual(row);
    expect(state.deleted).toEqual([]);
    expect(report.collections.find((entry) => entry.collection === 'app_ai_apps')).toMatchObject({ deleted: 0, refusal: 'ownership-unverified' });
  });
});
