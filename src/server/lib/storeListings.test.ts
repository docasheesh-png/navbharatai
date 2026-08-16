import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The listings that a real user actually sees, pinned against the composite-index bug.
 *
 * `galleryStore`, `navStoreStore` and `UserBuildHistoryStore` all issued a `.where(A).orderBy(B)`
 * query, and none of the three had a single test. Two of them swallowed the resulting throw and
 * returned an empty list, so the failure arrived at the user as "you have nothing here" — the
 * quietest possible way for a store to break.
 *
 * These tests drive each function through a Firestore double that FAILS if `orderBy` is ever called,
 * and check the ordering the user is entitled to. `firestoreIndexSafe.test.ts` guards the shape
 * across the whole server; this file guards the behaviour of the specific screens.
 */

/** A collection double that refuses to be ordered, and applies equality filters itself. */
function fakeCollection(docs: Array<Record<string, unknown>>) {
  const state = { filters: [] as Array<[string, unknown]>, limit: 0, orderByCalls: 0 };
  const q: Record<string, unknown> = {
    where(field: string, op: string, value: unknown) {
      expect(op, 'only equality filters keep a query index-free').toBe('==');
      state.filters.push([field, value]);
      return q;
    },
    orderBy() {
      state.orderByCalls++;
      throw new Error('orderBy() would require a composite index that is not deployed');
    },
    limit(n: number) { state.limit = n; return q; },
    async get() {
      const matching = docs.filter((d) => state.filters.every(([f, v]) => d[f] === v));
      return { docs: matching.slice(0, state.limit || matching.length).map((data) => ({ id: String(data.id ?? ''), data: () => data })) };
    },
  };
  return { q, state };
}

const dbWith = (docs: Array<Record<string, unknown>>) => {
  const { q, state } = fakeCollection(docs);
  return { db: { collection: () => q }, state };
};

describe('galleryStore listings', () => {
  beforeEach(() => vi.resetModules());

  it('lists approved apps newest-first without ordering in the query', async () => {
    const { db, state } = dbWith([
      { id: 'old', status: 'approved', publishedAt: 100 },
      { id: 'new', status: 'approved', publishedAt: 900 },
      { id: 'mid', status: 'approved', publishedAt: 500 },
      { id: 'hidden', status: 'pending', publishedAt: 999 },
    ]);
    vi.doMock('./serverDb', () => ({ getServerDb: () => db }));
    const { listGalleryApps } = await import('./galleryStore');

    const apps = await listGalleryApps('approved');
    expect(apps.map((a) => a.id)).toEqual(['new', 'mid', 'old']);
    expect(state.orderByCalls).toBe(0);
    // A `pending` app must never reach a public listing — the status IS the safety model here.
    expect(apps.some((a) => a.id === 'hidden')).toBe(false);
  });

  it("lists one publisher's own apps regardless of status", async () => {
    const { db } = dbWith([
      { id: 'mine-1', uid: 'u1', status: 'pending', publishedAt: 10 },
      { id: 'mine-2', uid: 'u1', status: 'rejected', publishedAt: 30 },
      { id: 'theirs', uid: 'u2', status: 'approved', publishedAt: 99 },
    ]);
    vi.doMock('./serverDb', () => ({ getServerDb: () => db }));
    const { listGalleryAppsByUid } = await import('./galleryStore');

    const apps = await listGalleryAppsByUid('u1');
    expect(apps.map((a) => a.id)).toEqual(['mine-2', 'mine-1']);
    expect(apps.some((a) => a.id === 'theirs')).toBe(false);
  });
});

describe('navStoreStore listings', () => {
  beforeEach(() => {
    vi.resetModules();
    // This store deliberately returns no database under VITEST so nothing in the suite can touch a
    // real project. These tests need the query path itself, so the flags are cleared per import.
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'development');
  });

  async function loadStore(docs: Array<Record<string, unknown>>) {
    const { db, state } = dbWith(docs);
    vi.doMock('./serverDb', () => ({ getServerDb: () => db }));
    vi.doMock('firebase-admin', () => ({ apps: [{}], initializeApp: () => {}, firestore: {} }));
    return { mod: await import('./navStoreStore'), state };
  }

  it('lists submissions in a state newest-first without ordering in the query', async () => {
    const { mod, state } = await loadStore([
      { id: 'a', status: 'approved', submittedAt: 1 },
      { id: 'b', status: 'approved', submittedAt: 3 },
      { id: 'c', status: 'pending', submittedAt: 9 },
    ]);
    const apps = await mod.listApps('approved');
    expect(apps.map((a) => a.id)).toEqual(['b', 'a']);
    expect(state.orderByCalls).toBe(0);
    expect(apps.some((a) => a.id === 'c')).toBe(false);
  });

  it("lists one developer's own submissions", async () => {
    const { mod } = await loadStore([
      { id: 'x', uid: 'dev', submittedAt: 2 },
      { id: 'y', uid: 'dev', submittedAt: 8 },
      { id: 'z', uid: 'other', submittedAt: 99 },
    ]);
    expect((await mod.listAppsByUid('dev')).map((a) => a.id)).toEqual(['y', 'x']);
  });
});

describe('UserBuildHistoryStore.list', () => {
  beforeEach(() => {
    vi.resetModules();
    // The store short-circuits to null under VITEST so it never touches a real database; the tests
    // below need the query path, so the flags are cleared for the duration of each import.
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'development');
  });

  async function loadStore(docs: Array<Record<string, unknown>>) {
    const { db, state } = dbWith(docs);
    vi.doMock('./serverDb', () => ({ getServerDb: () => db }));
    vi.doMock('firebase-admin', () => ({ apps: [{}], initializeApp: () => {}, firestore: {} }));
    const mod = await import('./UserBuildHistoryStore');
    return { store: (mod as { userBuildHistoryStore?: unknown }).userBuildHistoryStore ?? mod, state };
  }

  it('returns a user\'s builds newest-first and never another user\'s', async () => {
    const { store, state } = await loadStore([
      { id: '1', userId: 'u1', createdAt: 100, status: 'completed', costInr: 5 },
      { id: '2', userId: 'u1', createdAt: 300, status: 'failed', costInr: 0 },
      { id: '3', userId: 'u2', createdAt: 999, status: 'completed', costInr: 50 },
    ]);
    const rows = await (store as { list: (u: string) => Promise<Array<{ id: string }>> }).list('u1');
    expect(rows.map((r) => r.id)).toEqual(['2', '1']);
    expect(state.orderByCalls).toBe(0);
  });

  it('applies the date range itself rather than asking Firestore for a second field', async () => {
    // A range on `createdAt` alongside the `userId` filter is exactly what needed the missing index.
    const { store } = await loadStore([
      { id: 'old', userId: 'u1', createdAt: 100 },
      { id: 'inside', userId: 'u1', createdAt: 500 },
      { id: 'later', userId: 'u1', createdAt: 900 },
    ]);
    const rows = await (store as { list: (u: string, o: object) => Promise<Array<{ id: string }>> })
      .list('u1', { period: 'custom', from: 400, to: 800 });
    expect(rows.map((r) => r.id)).toEqual(['inside']);
  });

  it('reports an empty history as empty, not as a failure', async () => {
    const { store } = await loadStore([{ id: 'x', userId: 'someone-else', createdAt: 1 }]);
    expect(await (store as { list: (u: string) => Promise<unknown[]> }).list('u1')).toEqual([]);
  });
});
