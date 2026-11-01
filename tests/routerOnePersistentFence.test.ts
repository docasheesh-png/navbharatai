import { describe, expect, it } from 'vitest';
import { FirestoreCatalogueAttemptStore } from '../src/server/AI/RouterOne/catalogueAccounting';
import type { Firestore } from 'firebase-admin/firestore';
import type { PublicPriceSnapshot } from '../src/server/AI/RouterOne/publicPriceSource';
/** Atomic in-memory transaction model; no emulator/network and no wallet methods. */
function database() {
  const rows = new Map<string, Record<string, unknown>>(); let tail: Promise<unknown> = Promise.resolve();
  const db = { doc: (path: string) => ({ path }), runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const result = tail.then(async () => {
      const writes: Array<() => void> = [];
      const value = await fn({ get: async (ref: { path: string }) => ({ exists: rows.has(ref.path), data: () => rows.get(ref.path) }),
        create: (ref: { path: string }, value: Record<string, unknown>) => { if (rows.has(ref.path)) throw new Error('already exists'); writes.push(() => { rows.set(ref.path, value); }); },
        update: (ref: { path: string }, value: Record<string, unknown>) => { if (!rows.has(ref.path)) throw new Error('missing'); writes.push(() => { rows.set(ref.path, { ...rows.get(ref.path), ...value }); }); },
        set: (ref: { path: string }, value: Record<string, unknown>) => { writes.push(() => { rows.set(ref.path, value); }); },
      });
      for (const write of writes) write();
      return value;
    });
    tail = result.catch(() => {}); return result;
  } } as unknown as Firestore;
  return { db, rows };
}
const binding = { uid: 'synthetic', buildId: 'synthetic', workspaceId: 'synthetic' };
const snapshot = { model: 'synthetic', sourceSha256: 'a'.repeat(64) } as PublicPriceSnapshot;
const deadline = () => Date.now() + 60000;
const pending = { kind: 'pending' as const, reason: 'incomplete-usage', requestId: null };
const known = { kind: 'catalogue-calculated' } as import('../src/server/AI/RouterOne/catalogueAccounting').RouterOneCatalogueReceipt;
describe('persistent Router One unresolved-attempt fence', () => {
  it('allows normal concurrent requests sharing a key across workers', async () => {
    const { db, rows } = database();
    const outcomes = await Promise.allSettled(['one', 'two'].map(id => new FirestoreCatalogueAttemptStore(db).reserve(binding, id, 'key', snapshot, deadline())));
    expect(outcomes.map(o => o.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(Object.keys(rows.get('router_one_accounting_keys/key')!.active as object)).toEqual(['one', 'two']);
  });
  it('a known concurrent completion cannot clear another pending call', async () => {
    const { db, rows } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await store.reserve(binding, 'two', 'key', snapshot, deadline());
    await store.finish('one', 'key', pending);
    await store.finish('two', 'key', known);
    await store.releaseVerified('two', 'key');
    await expect(new FirestoreCatalogueAttemptStore(db).reserve(binding, 'three', 'key', snapshot, deadline())).rejects.toThrow();
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: { one: true } });
    expect([...rows.keys()].every(p => p.startsWith('router_one_'))).toBe(true);
  });
  it('completion holds remain until acknowledgement and explicit verified release', async () => {
    const { db } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await store.finish('one', 'key', known);
    await expect(new FirestoreCatalogueAttemptStore(db).reserve(binding, 'two', 'key', snapshot, deadline())).rejects.toThrow();
    await store.releaseVerified('one', 'key');
    await store.reserve(binding, 'two', 'key', snapshot, deadline());
    await expect(store.releaseVerified('two', 'key')).rejects.toThrow();
  });
  it('persists an expired attempt fence across restarts without timed release', async () => {
    const { db, rows } = database(); let now = 1000;
    await new FirestoreCatalogueAttemptStore(db, () => now).reserve(binding, 'one', 'key', snapshot, 1100);
    now = 1101;
    await expect(new FirestoreCatalogueAttemptStore(db, () => now).reserve(binding, 'two', 'key', snapshot, 1200)).rejects.toThrow();
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: { one: true } });
    now = 2000;
    await expect(new FirestoreCatalogueAttemptStore(db, () => now).reserve(binding, 'three', 'key', snapshot, 2100)).rejects.toThrow();
  });
  it('a committed finish with a lost acknowledgement keeps the cross-worker fence', async () => {
    const { db } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    const uncertainFinish = async () => { await store.finish('one', 'key', known); throw new Error('acknowledgement lost'); };
    await expect(uncertainFinish()).rejects.toThrow('acknowledgement lost');
    await expect(new FirestoreCatalogueAttemptStore(db).reserve(binding, 'two', 'key', snapshot, deadline())).rejects.toThrow();
  });
  it('rejects wrong or repeated completion and refuses to release pending cost', async () => {
    const { db } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await expect(store.finish('wrong', 'key', pending)).rejects.toThrow();
    await store.finish('one', 'key', pending);
    await expect(store.finish('one', 'key', pending)).rejects.toThrow();
    await expect(store.releaseVerified('one', 'key')).rejects.toThrow();
  });
});
