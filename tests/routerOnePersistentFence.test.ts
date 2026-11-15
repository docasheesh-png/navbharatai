import { describe, expect, it } from 'vitest';
import { FirestoreCatalogueAttemptStore, createRouterOneUncertainFence } from '../src/server/AI/RouterOne/catalogueAccounting';
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
// OWNER DECISION 2026-11-15 ("Unknown keemat absorb karo"): an unknown-cost attempt is absorbed and recorded,
// never a fence. Before it, a single pending or expired attempt refused every later Router One call on every
// server, forever — builds showed ENGINE_R1 failing 45/45 in under a second with no request sent.
describe('Router One attempt store: unknown cost is absorbed, never a permanent fence', () => {
  it('allows normal concurrent requests sharing a key across workers', async () => {
    const { db, rows } = database();
    const outcomes = await Promise.allSettled(['one', 'two'].map(id => new FirestoreCatalogueAttemptStore(db).reserve(binding, id, 'key', snapshot, deadline())));
    expect(outcomes.map(o => o.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(Object.keys(rows.get('router_one_accounting_keys/key')!.active as object)).toEqual(['one', 'two']);
  });
  it('THE REPORTED BUG: a key left with an unresolved entry by the old rule admits the next call and is cleaned', async () => {
    const { db, rows } = database();
    rows.set('router_one_accounting_keys/key', { version: 2, active: { stale: 1 }, unresolved: { old: true, stale: true } });
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'fresh', 'key', snapshot, deadline());
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {} });
    expect(Object.keys(rows.get('router_one_accounting_keys/key')!.active as object)).toEqual(['fresh']);
    expect(rows.get('router_one_catalogue_attempts/fresh')).toMatchObject({ status: 'reserved' });
  });
  it('a pending (unknown-cost) completion releases its hold and is recorded as absorbed', async () => {
    const { db, rows } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await store.finish('one', 'key', pending);
    expect(rows.get('router_one_catalogue_attempts/one')).toMatchObject({ status: 'absorbed-unknown', result: pending });
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ active: {}, unresolved: {} });
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'two', 'key', snapshot, deadline());
    expect(Object.keys(rows.get('router_one_accounting_keys/key')!.active as object)).toEqual(['two']);
  });
  it('a known completion is held until its verified release; a lost release no longer blocks the next call', async () => {
    const { db, rows } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await store.finish('one', 'key', known);
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: { one: true } });
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'two', 'key', snapshot, deadline());
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {} });
    expect(rows.get('router_one_catalogue_attempts/one')).toMatchObject({ status: 'catalogue-calculated' });
  });
  it('a verified release still clears the hold exactly once', async () => {
    const { db } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await store.finish('one', 'key', known);
    await store.releaseVerified('one', 'key');
    await expect(store.releaseVerified('one', 'key')).rejects.toThrow();
  });
  it('an expired attempt (a worker died mid-call) is absorbed instead of fencing the key across restarts', async () => {
    const { db, rows } = database(); let now = 1000;
    await new FirestoreCatalogueAttemptStore(db, () => now).reserve(binding, 'one', 'key', snapshot, 1100);
    now = 1101;
    await new FirestoreCatalogueAttemptStore(db, () => now).reserve(binding, 'two', 'key', snapshot, 1200);
    expect(rows.get('router_one_catalogue_attempts/one')).toMatchObject({ status: 'absorbed-expired' });
    expect(Object.keys(rows.get('router_one_accounting_keys/key')!.active as object)).toEqual(['two']);
    expect([...rows.keys()].every(p => p.startsWith('router_one_'))).toBe(true);
  });
  it('rejects a duplicate call id, a wrong or repeated completion, and releasing an unknown cost', async () => {
    const { db } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await expect(store.reserve(binding, 'one', 'key', snapshot, deadline())).rejects.toThrow();
    await expect(store.finish('wrong', 'key', pending)).rejects.toThrow();
    await store.finish('one', 'key', pending);
    await expect(store.finish('one', 'key', pending)).rejects.toThrow();
    await expect(store.releaseVerified('one', 'key')).rejects.toThrow();
  });
  it('still refuses a malformed key record instead of guessing', async () => {
    const { db, rows } = database();
    rows.set('router_one_accounting_keys/key', { version: 1, active: {}, unresolved: {} });
    await expect(new FirestoreCatalogueAttemptStore(db).reserve(binding, 'one', 'key', snapshot, deadline())).rejects.toThrow();
  });
});

describe('bounded local uncertainty fence', () => {
  it('does not evict uncertain keys and fails closed at capacity', () => {
    const fence = createRouterOneUncertainFence(2);
    fence.add('one'); fence.add('two'); fence.add('one');
    expect(fence.has('one')).toBe(true); expect(fence.has('two')).toBe(true);
    expect(fence.has('healthy')).toBe(false);
    fence.add('three');
    for (const key of ['one', 'two', 'three', 'healthy']) expect(fence.has(key)).toBe(true);
    for (let i = 0; i < 10000; i++) fence.add(`overflow-${i}`);
    expect(fence.has('new')).toBe(true);
  });
});
