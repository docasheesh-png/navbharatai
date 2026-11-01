import { describe, expect, it } from 'vitest';
import { FirestoreCatalogueAttemptStore } from '../src/server/AI/RouterOne/catalogueAccounting';
import type { Firestore } from 'firebase-admin/firestore';
import type { PublicPriceSnapshot } from '../src/server/AI/RouterOne/publicPriceSource';
/** Atomic in-memory transaction model; no emulator/network and no wallet methods. */
function database() {
  const rows = new Map<string, Record<string, unknown>>(); let tail = Promise.resolve();
  const db = { doc: (path: string) => ({ path }), runTransaction: (fn: (tx: unknown) => Promise<void>) => {
    const result = tail.then(async () => {
      const writes: Array<() => void> = [];
      await fn({ get: async (ref: { path: string }) => ({ exists: rows.has(ref.path), data: () => rows.get(ref.path) }),
        create: (ref: { path: string }, value: Record<string, unknown>) => { if (rows.has(ref.path)) throw new Error('already exists'); writes.push(() => { rows.set(ref.path, value); }); },
        update: (ref: { path: string }, value: Record<string, unknown>) => { if (!rows.has(ref.path)) throw new Error('missing'); writes.push(() => { rows.set(ref.path, { ...rows.get(ref.path), ...value }); }); },
        set: (ref: { path: string }, value: Record<string, unknown>) => { writes.push(() => { rows.set(ref.path, value); }); },
      });
      for (const write of writes) write();
    });
    tail = result.catch(() => {}); return result;
  } } as unknown as Firestore;
  return { db, rows };
}
const binding = { uid: 'synthetic', buildId: 'synthetic', workspaceId: 'synthetic' };
const snapshot = { model: 'synthetic', sourceSha256: 'a'.repeat(64) } as PublicPriceSnapshot;
describe('persistent Router One unresolved-attempt fence', () => {
  it('allows one concurrent request, and another worker cannot recover an outstanding hold', async () => {
    const { db, rows } = database(); const first = new FirestoreCatalogueAttemptStore(db), second = new FirestoreCatalogueAttemptStore(db);
    const outcomes = await Promise.allSettled([first.reserve(binding, 'call-one', 'key', snapshot), second.reserve(binding, 'call-two', 'key', snapshot)]);
    expect(outcomes.map(o => o.status)).toEqual(['fulfilled', 'rejected']);
    expect(rows.get('router_one_catalogue_attempts/call-one')).toMatchObject({ status: 'reserved', snapshot, ...binding });
    expect(rows.has('router_one_catalogue_attempts/call-two')).toBe(false);
    await expect(new FirestoreCatalogueAttemptStore(db).reserve(binding, 'call-three', 'key', snapshot)).rejects.toThrow();
  });
  it('keeps missing usage blocked across requests and restarts without changing a wallet', async () => {
    const { db, rows } = database(); const first = new FirestoreCatalogueAttemptStore(db);
    await first.reserve(binding, 'call-one', 'key', snapshot);
    await first.finish('call-one', 'key', { kind: 'pending', reason: 'incomplete-usage', requestId: null });
    await expect(new FirestoreCatalogueAttemptStore(db).reserve({ ...binding, buildId: 'new-build' }, 'call-two', 'key', snapshot)).rejects.toThrow();
    expect(rows.get('router_one_accounting_keys/key')).toMatchObject({ pending: true, inflight: null });
    expect([...rows.keys()].every(p => p.startsWith('router_one_'))).toBe(true);
  });
  it('rejects a wrong or repeated completion identity transactionally', async () => {
    const { db, rows } = database(); const store = new FirestoreCatalogueAttemptStore(db);
    await store.reserve(binding, 'call-one', 'key', snapshot);
    await expect(store.finish('wrong', 'key', { kind: 'pending', reason: 'unknown', requestId: null })).rejects.toThrow();
    expect(rows.get('router_one_accounting_keys/key')?.inflight).toBe('call-one');
    await store.finish('call-one', 'key', { kind: 'pending', reason: 'unknown', requestId: null });
    await expect(store.finish('call-one', 'key', { kind: 'pending', reason: 'unknown', requestId: null })).rejects.toThrow();
  });
});
