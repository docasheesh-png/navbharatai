import { describe, it, expect } from 'vitest';
import * as admin from 'firebase-admin';
import { FirestoreConversationStore } from './FirestoreConversationStore';

// ── A compact but faithful in-memory fake of the narrow Firestore surface the store uses:
// nested documents/subcollections, get/set(merge)/update, where+orderBy+limit queries,
// runTransaction (single-threaded, no isolation needed) and batched deletes. It lets us unit-
// test the store's real logic (seq increment, transcript reassembly, metadata merge, listing)
// without a live Firestore. ─────────────────────────────────────────────────────────────────
class FakeDoc {
  data: Record<string, unknown> | undefined;
  readonly subcols = new Map<string, FakeCollection>();
  constructor(readonly id: string) {}
  collection(name: string): FakeCollection {
    let c = this.subcols.get(name);
    if (!c) { c = new FakeCollection(); this.subcols.set(name, c); }
    return c;
  }
}
class DocRef {
  constructor(readonly col: FakeCollection, readonly id: string) {}
  private node(): FakeDoc {
    let d = this.col.docs.get(this.id);
    if (!d) { d = new FakeDoc(this.id); this.col.docs.set(this.id, d); }
    return d;
  }
  async get() {
    const d = this.col.docs.get(this.id);
    return { exists: !!d?.data, id: this.id, ref: this, data: () => d?.data };
  }
  async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
    const d = this.node();
    d.data = opts?.merge ? { ...(d.data ?? {}), ...data } : { ...data };
  }
  async update(data: Record<string, unknown>) {
    const d = this.node();
    d.data = { ...(d.data ?? {}), ...data };
  }
  collection(name: string) { return this.node().collection(name); }
}
class Query {
  constructor(
    readonly col: FakeCollection,
    readonly filters: Array<[string, string, unknown]> = [],
    readonly order?: [string, 'asc' | 'desc'],
    readonly lim?: number,
  ) {}
  where(f: string, _op: string, v: unknown) { return new Query(this.col, [...this.filters, [f, '==', v]], this.order, this.lim); }
  orderBy(f: string, dir: 'asc' | 'desc' = 'asc') { return new Query(this.col, this.filters, [f, dir], this.lim); }
  limit(n: number) { return new Query(this.col, this.filters, this.order, n); }
  async get() {
    let rows = [...this.col.docs.values()].filter((d) => d.data);
    for (const [f, , v] of this.filters) rows = rows.filter((d) => d.data?.[f] === v);
    if (this.order) {
      const [f, dir] = this.order;
      rows.sort((a, b) => (((a.data?.[f] as number) ?? 0) - ((b.data?.[f] as number) ?? 0)) * (dir === 'desc' ? -1 : 1));
    }
    if (this.lim !== undefined) rows = rows.slice(0, this.lim);
    return { docs: rows.map((d) => ({ id: d.id, data: () => d.data, ref: new DocRef(this.col, d.id) })) };
  }
}
class FakeCollection {
  readonly docs = new Map<string, FakeDoc>();
  doc(id: string) { return new DocRef(this, id); }
  where(f: string, op: string, v: unknown) { return new Query(this).where(f, op, v); }
  orderBy(f: string, dir: 'asc' | 'desc' = 'asc') { return new Query(this).orderBy(f, dir); }
  // A CollectionReference IS a Query in Firestore — `.get()` returns every doc.
  get() { return new Query(this).get(); }
}
class FakeFirestore {
  readonly cols = new Map<string, FakeCollection>();
  collection(name: string): FakeCollection {
    let c = this.cols.get(name);
    if (!c) { c = new FakeCollection(); this.cols.set(name, c); }
    return c;
  }
  async runTransaction<T>(fn: (tx: { get: (r: DocRef) => Promise<unknown>; set: (r: DocRef, d: Record<string, unknown>, o?: { merge?: boolean }) => void; delete: (r: DocRef) => void }) => Promise<T>): Promise<T> {
    return fn({ get: (r) => r.get(), set: (r, d, o) => { void r.set(d, o); }, delete: (r) => { r.col.docs.delete(r.id); } });
  }
  batch() {
    const ops: Array<() => void> = [];
    return {
      delete: (r: DocRef) => ops.push(() => { r.col.docs.delete(r.id); }),
      commit: async () => { ops.forEach((op) => op()); },
    };
  }
}

function newStore() {
  const fake = new FakeFirestore();
  const store = new FirestoreConversationStore(fake as unknown as admin.firestore.Firestore);
  return { store, fake };
}

const base = { id: 'b1', userId: 'u1', workspaceId: 'ws-1', title: 'todo app', createdAt: 1000 };

describe('FirestoreConversationStore (faithful fake)', () => {
  it('creates, then get() reassembles metadata + seed transcript', async () => {
    const { store } = newStore();
    await store.create({ ...base, messages: [{ role: 'user', content: 'hi' }] });
    const rec = await store.get('b1');
    expect(rec?.status).toBe('running');
    expect(rec?.userId).toBe('u1');
    // get() attaches each turn's wall-clock ts to its messages (eternal-sessions interleave).
    expect(rec?.messages).toEqual([{ role: 'user', content: 'hi', ts: 1000 }]);
    expect(rec?.billedUsd).toBe(0);
    expect(rec?.createdAt).toBe(1000);
  });

  it('rejects a duplicate id and returns null for unknown', async () => {
    const { store } = newStore();
    expect(await store.get('nope')).toBeNull();
    await store.create({ ...base });
    await expect(store.create({ ...base })).rejects.toThrow(/already exists/);
  });

  it('appends turns into the subcollection and get() concatenates them in order', async () => {
    const { store } = newStore();
    await store.create({ ...base, messages: [{ role: 'user', content: 'hi' }] });
    await store.appendMessages('b1', [{ role: 'assistant', content: 'a' }], { usage: { inputTokens: 5, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, billedUsd: 0.1, updatedAt: 2000 });
    await store.appendMessages('b1', [{ role: 'user', content: 'r' }], { status: 'complete', billedUsd: 0.2, updatedAt: 3000 });
    const rec = await store.get('b1');
    expect(rec?.messages).toEqual([
      { role: 'user', content: 'hi', ts: 1000 },
      { role: 'assistant', content: 'a', ts: 2000 },
      { role: 'user', content: 'r', ts: 3000 },
    ]);
    expect(rec?.status).toBe('complete');
    expect(rec?.billedUsd).toBe(0.2);
    expect(rec?.usage.inputTokens).toBe(5);
    expect(rec?.updatedAt).toBe(3000);
  });

  it('throws when appending/updating an unknown id', async () => {
    const { store } = newStore();
    await expect(store.appendMessages('ghost', [], { updatedAt: 1 })).rejects.toThrow(/unknown conversation id/);
    await expect(store.update('ghost', { updatedAt: 1 })).rejects.toThrow(/unknown conversation id/);
  });

  it('update() finalizes status without adding turns', async () => {
    const { store } = newStore();
    await store.create({ ...base, messages: [{ role: 'user', content: 'hi' }] });
    await store.update('b1', { status: 'stopped', updatedAt: 9 });
    const rec = await store.get('b1');
    expect(rec?.status).toBe('stopped');
    expect(rec?.messages).toHaveLength(1);
  });

  it('listByUser returns metadata (no transcript) scoped + ordered by updatedAt desc + capped', async () => {
    const { store } = newStore();
    await store.create({ ...base, id: 'a', userId: 'u1', messages: [{ role: 'user', content: 'x' }] });
    await store.create({ ...base, id: 'b', userId: 'u1' });
    await store.create({ ...base, id: 'c', userId: 'u2' });
    await store.update('a', { updatedAt: 5000 }); // make 'a' most recent for u1
    const u1 = await store.listByUser('u1');
    expect(u1.map((r) => r.id)).toEqual(['a', 'b']);
    expect(u1[0].messages).toEqual([]); // list view omits the transcript
    expect((await store.listByUser('u1', 1)).map((r) => r.id)).toEqual(['a']);
    expect(await store.listByUser('nobody')).toEqual([]);
  });

  it('listByUser NEVER issues an ordered query, so no composite index can ever be required', async () => {
    // Reproduces the real bug: agentv3_conversations had no (userId, updatedAt) index, so the
    // ordered query threw and the history menu showed "No saved chats yet".
    //
    // This used to be a FALLBACK test — try the ordered query, recover when it throws. That was the
    // wrong guarantee to lock in: the index was never deployed and never could be from this repo, so
    // the "fast path" failed on every single history load and each user paid for a doomed round-trip
    // first. The query is now index-free by construction, and this test asserts the stronger
    // property: the fake THROWS if `orderBy` is ever called, so a future edit that reintroduces the
    // ordered query fails here rather than in production.
    const rows: Record<string, any> = {
      a: { userId: 'u1', updatedAt: 300, title: 'A', workspaceId: 'w', createdAt: 1 },
      b: { userId: 'u1', updatedAt: 100, title: 'B', workspaceId: 'w', createdAt: 1 },
      c: { userId: 'u1', updatedAt: 200, title: 'C', workspaceId: 'w', createdAt: 1 },
      d: { userId: 'u2', updatedAt: 999, title: 'D', workspaceId: 'w', createdAt: 1 },
    };
    const makeQuery = (filters: Array<[string, unknown]>, lim?: number): any => ({
      where: (f: string, _op: string, v: unknown) => makeQuery([...filters, [f, v]], lim),
      orderBy: () => {
        // In the real database this is where the missing composite index bites. Failing loudly HERE
        // is the point: an ordered query must be caught by this test, not by a user whose history
        // silently reads "No saved chats yet".
        throw new Error('orderBy() must never be called — it would require an undeployed index');
      },
      limit: (n: number) => makeQuery(filters, n),
      get: async () => {
        let ids = Object.keys(rows).filter((id) => filters.every(([f, v]) => rows[id][f] === v));
        if (lim !== undefined) ids = ids.slice(0, lim);
        return { docs: ids.map((id) => ({ id, data: () => rows[id], ref: null })) };
      },
    });
    const fakeDb = { collection: () => makeQuery([], undefined) };
    const store = new FirestoreConversationStore(fakeDb as unknown as admin.firestore.Firestore);
    const u1 = await store.listByUser('u1', 50);
    expect(u1.map((r) => r.id)).toEqual(['a', 'c', 'b']); // newest-first, sorted in memory
    expect(u1.some((r) => r.id === 'd')).toBe(false); // other user excluded
  });

  it('removes the main doc and its turns', async () => {
    const { store } = newStore();
    await store.create({ ...base, messages: [{ role: 'user', content: 'hi' }] });
    await store.remove('b1');
    expect(await store.get('b1')).toBeNull();
  });

  it('stores timeline chunks + finalState/framework and get() reassembles them in order', async () => {
    const { store } = newStore();
    await store.create({ ...base, messages: [{ role: 'user', content: 'hi' }] });
    // Turn-coupled chunk (appendMessages patch) then an end-of-build chunk (update patch).
    await store.appendMessages('b1', [{ role: 'assistant', content: 'a' }], {
      updatedAt: 2000,
      timelineAppend: [{ t: 'file', path: 'a.ts', kind: 'create', agent: 'architect', ts: 1500 }],
    });
    await store.update('b1', {
      updatedAt: 3000,
      status: 'complete',
      timelineAppend: [{ t: 'preview', url: 'https://x', ts: 2500 }],
      finalState: { billedInr: 42, tokens: 999 },
      framework: 'nextjs',
    });
    const rec = await store.get('b1', { includeTimeline: true });
    expect(rec?.timeline).toEqual([
      { t: 'file', path: 'a.ts', kind: 'create', agent: 'architect', ts: 1500 },
      { t: 'preview', url: 'https://x', ts: 2500 },
    ]);
    expect(rec?.finalState).toEqual({ billedInr: 42, tokens: 999 });
    expect(rec?.framework).toBe('nextjs');
    expect(rec?.status).toBe('complete');
    // Legacy docs (no timeline) simply omit the field.
    const { store: fresh } = newStore();
    await fresh.create({ ...base, id: 'legacy' });
    expect((await fresh.get('legacy', { includeTimeline: true }))?.timeline).toBeUndefined();
  });

  it('remove() also deletes timeline chunks', async () => {
    const { store, fake } = newStore();
    await store.create({ ...base });
    await store.update('b1', { updatedAt: 2, timelineAppend: [{ t: 'preview', url: 'https://x', ts: 1 }] });
    await store.remove('b1');
    expect(await store.get('b1')).toBeNull();
    // Re-creating the same id must not resurrect old timeline chunks.
    await store.create({ ...base });
    expect((await store.get('b1', { includeTimeline: true }))?.timeline).toBeUndefined();
    void fake;
  });
});
