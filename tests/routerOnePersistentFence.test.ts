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
describe('Router One key lock settles and releases (owner 2026-11-15, BR2388)', () => {
  it('allows normal concurrent requests sharing a key across workers', async () => {
    const { db, rows } = database();
    const outcomes = await Promise.allSettled(['one', 'two'].map(id => new FirestoreCatalogueAttemptStore(db).reserve(binding, id, 'key', snapshot, deadline())));
    expect(outcomes.map(o => o.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(Object.keys(rows.get('router_one_accounting_keys/key')!.active as object)).toEqual(['one', 'two']);
  });
  // OWNER 2026-11-15 (BR2388): an earlier call that ended without a complete receipt no longer locks the
  // key forever. The next reserve settles it by a labelled estimate (absorbed) and releases it.
  it('a pending call no longer locks the key: the next reserve self-heals it by estimate', async () => {
    const { db, rows } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await store.finish('one', 'key', pending);
    await store.finish('two', 'key', known);
    await store.releaseVerified('two', 'key');
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'three', 'key', snapshot, deadline());
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {} });
    expect(Object.keys(rows.get('router_one_accounting_keys/key')!.active as object)).toEqual(['three']);
    expect(rows.get('router_one_catalogue_attempts/one')).toMatchObject({ status: 'self-healed-estimate', previousStatus: 'pending', absorbed: true });
    expect((rows.get('router_one_catalogue_attempts/one')!.result as { kind: string }).kind).toBe('catalogue-estimated');
    // the verified call is untouched by the heal
    expect(rows.get('router_one_catalogue_attempts/two')).toMatchObject({ status: 'catalogue-calculated' });
    expect([...rows.keys()].every(p => p.startsWith('router_one_'))).toBe(true);
  });
  it('a settled call whose release was not acknowledged is released (never re-priced) by the next reserve', async () => {
    const { db, rows } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    await store.finish('one', 'key', known);
    await new FirestoreCatalogueAttemptStore(db).reserve(binding, 'two', 'key', snapshot, deadline());
    expect(rows.get('router_one_catalogue_attempts/one')).toMatchObject({ status: 'catalogue-calculated' });
    // the original worker's late release is idempotent success, not an accounting failure
    await expect(store.releaseVerified('one', 'key')).resolves.toBeUndefined();
    // a never-finished call still cannot be released
    await expect(store.releaseVerified('two', 'key')).rejects.toThrow();
  });
  it('an expired attempt is self-healed on the next reserve instead of fencing until a manual write', async () => {
    const { db, rows } = database(); let now = 1000;
    await new FirestoreCatalogueAttemptStore(db, () => now).reserve(binding, 'one', 'key', snapshot, 1100);
    now = 1101;
    await new FirestoreCatalogueAttemptStore(db, () => now).reserve(binding, 'two', 'key', snapshot, 1200);
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ unresolved: {} });
    expect(rows.get('router_one_catalogue_attempts/one')).toMatchObject({ status: 'self-healed-estimate', previousStatus: 'reserved' });
    // the healed call can no longer be finished: a late receipt cannot charge it a second time
    await expect(new FirestoreCatalogueAttemptStore(db, () => now).finish('one', 'key', known)).rejects.toThrow();
  });
  it('a committed finish with a lost acknowledgement does not keep the key locked', async () => {
    const { db } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'one', 'key', snapshot, deadline());
    const uncertainFinish = async () => { await store.finish('one', 'key', known); throw new Error('acknowledgement lost'); };
    await expect(uncertainFinish()).rejects.toThrow('acknowledgement lost');
    await expect(new FirestoreCatalogueAttemptStore(db).reserve(binding, 'two', 'key', snapshot, deadline())).resolves.toBeUndefined();
  });
  it('rejects wrong or repeated completion and refuses to release pending cost', async () => {
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
