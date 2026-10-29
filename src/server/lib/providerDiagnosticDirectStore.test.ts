import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { checkedRun } from './providerDiagnosticStore';
import { ProviderDiagnosticDirectStore } from './providerDiagnosticDirectStore';
const key = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const root = 'free_chat_chain/provider_diagnostic_pair_20261028/runs/';
function fixture() {
  const docs = new Map<string, any>([
    ['free_chat_chain/provider_diagnostics/control/surplus', { enabled: true, revision: 1 }],
    ['free_chat_chain/provider_diagnostics/control/cheaperinference', { enabled: true, revision: 1 }],
    ['free_chat_chain/paid_day_2026-10-28', { heldNanoUsd: 999 }],
    ['live_ai_registry/old_connection_test', { status: 'completed', latencyMs: 7777 }],
  ]);
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  let serial = Promise.resolve(); let uncertain = false;
  const db = { doc: (path: string) => ({ path, get: async () => snapshot(path) }), runTransaction: (callback: any) => {
    const work = serial.then(async () => {
      const writes = new Map<string, any>();
      const result = await callback({ get: async (ref: any) => snapshot(ref.path),
        set: (ref: any, value: any) => writes.set(ref.path, structuredClone(value)),
        create: (ref: any, value: any) => { if (docs.has(ref.path)) throw Error('exists'); writes.set(ref.path, structuredClone(value)); } });
      for (const [path, value] of writes) docs.set(path, value);
      if (uncertain) { uncertain = false; throw Error('lost acknowledgement'); }
      return result;
    }); serial = work.then(() => undefined, () => undefined); return work;
  } };
  return { docs, store: new ProviderDiagnosticDirectStore(db as unknown as Firestore, () => 1000), uncertain: () => { uncertain = true; } };
}
describe('direct manual diagnostic idempotency without bespoke pricing/allowance gates', () => {
  it('admits without catalog, pricing, FX, review or budget documents and preserves historical holds', async () => {
    const f = fixture(); const before = structuredClone([...f.docs]);
    expect(await f.store.status('surplus', 'configured')).toMatchObject({ dispatchReady: true });
    const { run } = await f.store.reserve(key, 'surplus', 'configured');
    expect(run).toMatchObject({ state: 'pending', actualCostNanoUsd: null });
    expect(run).not.toHaveProperty('reservedNanoUsd');
    for (const [path, value] of before) expect(f.docs.get(path)).toEqual(value);
  });
  it('atomically admits and claims the same submission only once', async () => {
    const { store } = fixture();
    const runs = await Promise.all([store.reserve(key, 'surplus', 'm'), store.reserve(key, 'surplus', 'm')]);
    expect(runs.map(r => r.mayDispatch)).toEqual([true, false]);
    expect(await Promise.all([store.claimDispatch(key, runs[0].run.runId), store.claimDispatch(key, runs[0].run.runId)])).toEqual([true, false]);
    await expect(store.reserve(key, 'cheaperinference', 'm')).rejects.toMatchObject({ reason: 'invalid_request' });
  });
  it('lost reservation acknowledgement never enables a duplicate dispatch', async () => {
    const f = fixture(); f.uncertain();
    await expect(f.store.reserve(key, 'surplus', 'm')).rejects.toThrow('lost acknowledgement');
    expect((await f.store.reserve(key, 'surplus', 'm')).mayDispatch).toBe(false);
  });
  it('retains unknown cost while allowing a separate explicitly submitted request', async () => {
    const { store, docs } = fixture(); const { run } = await store.reserve(key, 'surplus', 'm');
    await store.claimDispatch(key, run.runId);
    expect(await store.finish(key, run.runId, null)).toMatchObject({ state: 'unknown_liability', actualCostNanoUsd: null, completedAt: 1000 });
    expect((await store.reserve(other, 'cheaperinference', 'm')).mayDispatch).toBe(true);
    expect(docs.get(root + key).actualCostNanoUsd).toBeNull();
  });
  it('stores only safe metadata and exact receipt without touching shared holds', async () => {
    const { store, docs } = fixture(); const { run } = await store.reserve(key, 'surplus', 'm'); await store.claimDispatch(key, run.runId);
    await store.finish(key, run.runId, 123);
    expect(await store.read(key)).toMatchObject({ state: 'settled', actualCostNanoUsd: 123 });
    expect(docs.get('free_chat_chain/paid_day_2026-10-28')).toEqual({ heldNanoUsd: 999 });
    expect(Object.keys(docs.get(root + key)).sort()).toEqual(['accountingBasis','actualCostNanoUsd','completedAt','controlRevision','dispatchClaimedAt','model','provider','runId','startedAt','state','version'].sort());
  });
  it('OFF blocks direct admission; disabling or cycling revision before claim blocks dispatch', async () => {
    const { store, docs } = fixture(); const { run } = await store.reserve(key, 'surplus', 'm');
    docs.set('free_chat_chain/provider_diagnostics/control/surplus', { enabled: false, revision: 2 });
    expect(await store.claimDispatch(key, run.runId)).toBe(false);
    await expect(store.reserve(other, 'surplus', 'm')).rejects.toMatchObject({ reason: 'diagnostics_disabled' });
    expect(await store.read(key)).not.toBeNull();
    docs.set('free_chat_chain/provider_diagnostics/control/surplus', { enabled: true, revision: 3 });
    expect(await store.claimDispatch(key, run.runId)).toBe(false);
    expect((await store.reserve(other, 'cheaperinference', 'm')).mayDispatch).toBe(true);
  });
});

it('shares deployed key namespace and the old decoder refuses a new record rather than redispatching', async () => {
  const { store, docs } = fixture(); await store.reserve(key, 'surplus', 'm');
  const record = docs.get(root + key);
  expect(record.version).toBe(2); expect(() => checkedRun(record)).toThrow();
});
it('reads old records without rewriting or disclosing additional fields', async () => {
  const { store, docs } = fixture(); const old = { version: 1, runId: key, provider: 'surplus', model: 'm', startedAt: 1000,
    day: '2026-10-28', month: '2026-10', reservedNanoUsd: 100, reservedPaise: 1, conversionCeiling: 10000,
    state: 'unknown_liability', actualCostNanoUsd: null, privateExtra: 'must-not-leak' };
  docs.set(root + key, old);
  expect(JSON.stringify(await store.read(key))).not.toContain('must-not-leak');
  expect((await store.reserve(key, 'surplus', 'm')).mayDispatch).toBe(false);
  expect(docs.get(root + key)).toEqual(old);
});
