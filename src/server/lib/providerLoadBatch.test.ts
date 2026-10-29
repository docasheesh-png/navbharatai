import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { ProviderLoadBatchStore, ProviderLoadBatchService, advanceLoadBatch as executeWave, loadCorpusHash, type LoadBatchAuthority, type LoadQuestion } from './providerLoadBatch';
import { FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
const advanceLoadBatch = (...args: [string, readonly LoadQuestion[], ProviderLoadBatchStore, Parameters<typeof executeWave>[3]]) => executeWave(...args, randomUUID());
const authority: LoadBatchAuthority = { scopeId: 'synthetic-test-only', model: 'configured-model', totalAttempts: 1000, priorAttempts: 640,
  priorCostNanoUsd: 48_822_000, totalBudgetNanoUsd: 100_000_000, maxAttemptNanoUsd: 1000, maxConcurrency: 10, maxOutputTokens: 256, expiresAt: 999999 };
const questions = (count: number): LoadQuestion[] => Array.from({ length: count }, (_, i) => ({ id: `q-${i}`, prompt: `Return only the JSON integer ${i}.`, expected: i }));
function fixture() {
  const docs = new Map<string, any>([['free_chat_chain/provider_diagnostics/control/cheaperinference', { enabled: true, revision: 1 }], ['legacy/pending', { held: 999 }]]);
  let serial = Promise.resolve(), uncertain = false;
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  const db = { doc: (path: string) => ({ path, get: async () => snapshot(path) }), runTransaction: (callback: any) => {
    const work = serial.then(async () => {
      const writes = new Map<string, any>();
      const result = await callback({ get: async (ref: any) => snapshot(ref.path), set: (ref: any, value: any) => writes.set(ref.path, structuredClone(value)),
        create: (ref: any, value: any) => { if (docs.has(ref.path)) throw Error('exists'); writes.set(ref.path, structuredClone(value)); } });
      for (const [path, value] of writes) docs.set(path, value);
      if (uncertain) { uncertain = false; throw Error('lost acknowledgement'); }
      return result;
    }); serial = work.then(() => undefined, () => undefined); return work;
  } } as unknown as Firestore;
  return { docs, store: new ProviderLoadBatchStore(db, () => 1000), other: new ProviderLoadBatchStore(db, () => 1000), loseAck: () => { uncertain = true; } };
}
const result = { text: '0', amount: '0.0000001', usage: { inputTokens: 1, outputTokens: 1, cachedTokens: null } };
describe('durable bounded concurrent batch (mock database and provider only)', () => {
  it('caps new attempts at the remaining360, preserves prior spend and old holds', async () => {
    const f = fixture();
    await expect(f.store.create(authority, questions(361), 2)).rejects.toMatchObject({ code: 'invalid' });
    const b = await f.store.create(authority, questions(360), 2);
    expect(b).toMatchObject({ count: 360, spentNanoUsd: 48_822_000 }); expect(f.docs.get('legacy/pending')).toEqual({ held: 999 });
    expect(JSON.stringify([...f.docs.values()])).not.toContain('Return only');
  });
  it('duplicate creation preserves state and refuses replacement corpus or limits', async () => {
    const f = fixture(); await f.store.create(authority, questions(4), 2); await f.store.claim(authority.scopeId);
    expect((await f.other.create(authority, questions(4), 2)).next).toBe(1);
    await expect(f.other.create(authority, questions(3), 2)).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.other.create({ ...authority, totalBudgetNanoUsd: 200_000_000 }, questions(4), 2)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('two workers atomically share concurrency and distinct ordinals', async () => {
    const f = fixture(); await f.store.create(authority, questions(8), 2);
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? f.other : f.store).claim(authority.scopeId)));
    const issued = claims.filter(Boolean); expect(issued).toHaveLength(2); expect(new Set(issued.map(i => i!.requestId)).size).toBe(2);
    const first = issued[0]!;
    expect(await Promise.all([f.store.dispatch(authority.scopeId, first), f.other.dispatch(authority.scopeId, first)])).toEqual([true, false]);
  });
  it('lost claim acknowledgement consumes its ordinal and retains concurrency without retry', async () => {
    const f = fixture(); await f.store.create(authority, questions(3), 1); f.loseAck();
    await expect(f.store.claim(authority.scopeId)).rejects.toThrow('lost acknowledgement');
    expect(await f.other.claim(authority.scopeId)).toBeNull(); expect((await f.store.read(authority.scopeId))?.next).toBe(1);
  });
  it.each(['stop', 'disable'] as const)('rechecks %s after reservation, releases only undispatched reservation', async action => {
    const f = fixture(); await f.store.create(authority, questions(3), 2); const item = (await f.store.claim(authority.scopeId))!;
    if (action === 'stop') await f.other.stop(authority.scopeId); else f.docs.set('free_chat_chain/provider_diagnostics/control/cheaperinference', { enabled: false, revision: 2 });
    expect(await f.store.dispatch(authority.scopeId, item)).toBe(false);
    expect(await f.store.read(authority.scopeId)).toMatchObject({ active: 0, heldNanoUsd: 0, next: 1 });
    expect((await f.store.readItem(authority.scopeId, 0))?.state).toBe('cancelled');
  });
  it('unknown complete-response costs retain liability but release the completed concurrency slot', async () => {
    const f = fixture(); await f.store.create({ ...authority, totalBudgetNanoUsd: authority.priorCostNanoUsd + 1000 }, questions(3), 1);
    const adapter = { model: authority.model, call: vi.fn().mockResolvedValue({ ...result, amount: null }) };
    const b = await advanceLoadBatch(authority.scopeId, questions(3), f.store, adapter);
    expect(b).toMatchObject({ heldNanoUsd: 1000, active: 0, completed: 1 });
    await advanceLoadBatch(authority.scopeId, questions(3), f.store, adapter); expect(adapter.call).toHaveBeenCalledOnce();
  });
  it.each(['TIMEOUT', 'NETWORK', 'ABORTED'] as const)('keeps uncertainty and in-flight slot for %s; never retries', async code => {
    const f = fixture(); await f.store.create(authority, questions(4), 1);
    const adapter = { model: authority.model, call: vi.fn().mockRejectedValue(new FreeChainProviderError(code)) };
    const b = await advanceLoadBatch(authority.scopeId, questions(4), f.store, adapter);
    expect(b).toMatchObject({ next: 1, active: 1, completed: 1, heldNanoUsd: 1000 });
    await advanceLoadBatch(authority.scopeId, questions(4), f.store, adapter); expect(adapter.call).toHaveBeenCalledOnce();
    expect(await f.store.readItem(authority.scopeId, 0)).toMatchObject({ actualNanoUsd: null, quality: 'not_evaluated', state: 'unknown' });
  });
  it('settles a structured failed-call receipt once, without treating it as quality success', async () => {
    const f = fixture(); await f.store.create(authority, questions(1), 1);
    await advanceLoadBatch(authority.scopeId, questions(1), f.store, { model: authority.model,
      call: vi.fn().mockRejectedValue(new FreeChainProviderError('SERVER', { status: 503, supplierChargeUsd: '0.0000001' })) });
    const item = (await f.store.readItem(authority.scopeId, 0))!;
    expect(item).toMatchObject({ actualNanoUsd: 100, quality: 'not_evaluated', responseReceived: false });
    await f.store.finish(authority.scopeId, item, { actualNanoUsd: 100, quality: 'not_evaluated', responseReceived: false, usage: result.usage, elapsedMs: 1 });
    expect(await f.store.read(authority.scopeId)).toMatchObject({ spentNanoUsd: authority.priorCostNanoUsd + 100, completed: 1 });
  });
  it('an evidenced overrun stops unsent work and records actual spend instead of truncating it', async () => {
    const f = fixture(); await f.store.create(authority, questions(2), 1);
    const b = await advanceLoadBatch(authority.scopeId, questions(2), f.store, { model: authority.model, call: vi.fn().mockResolvedValue({ ...result, amount: '0.000002' }) });
    expect(b).toMatchObject({ stopped: true, spentNanoUsd: authority.priorCostNanoUsd + 2000 });
    expect(await f.store.claim(authority.scopeId)).toBeNull();
  });
  it('counts format failures without stripping explanations or changing stored benchmark output', async () => {
    const f = fixture(); await f.store.create(authority, questions(1), 1);
    await advanceLoadBatch(authority.scopeId, questions(1), f.store, { model: authority.model, call: vi.fn().mockResolvedValue({ ...result, text: '0. Wait, answer: 0' }) });
    expect(await f.store.readItem(authority.scopeId, 0)).toMatchObject({ quality: 'fail' });
    expect(JSON.stringify([...f.docs.values()])).not.toContain('Wait, answer');
  });
  it('actually overlaps calls up to the durable bound, with no fallback or extra attempt', async () => {
    const f = fixture(); const corpus = questions(6); await f.store.create(authority, corpus, 2);
    let active = 0, peak = 0; const releases: Array<() => void> = [];
    const call = vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise<void>(resolve => releases.push(resolve)); active--; return result; });
    const work = advanceLoadBatch(authority.scopeId, corpus, f.store, { model: authority.model, call });
    await vi.waitFor(() => expect(releases.length).toBe(2)); releases.forEach(release => release()); await work;
    expect(peak).toBe(2); expect(call).toHaveBeenCalledTimes(2); expect((await f.store.read(authority.scopeId))?.completed).toBe(2);
  });
  it('rejects model/corpus mismatch before dispatch and keeps raw errors out of records', async () => {
    const f = fixture(); await f.store.create(authority, questions(2), 1); const call = vi.fn();
    await expect(advanceLoadBatch(authority.scopeId, questions(2), f.store, { model: 'other', call })).rejects.toMatchObject({ code: 'conflict' });
    expect(call).not.toHaveBeenCalled();
    await advanceLoadBatch(authority.scopeId, questions(2), f.store, { model: authority.model, call: vi.fn().mockRejectedValue(new Error('Bearer secret prompt')) });
    expect(JSON.stringify([...f.docs.values()])).not.toMatch(/Bearer|secret|prompt/);
  });
  it('rejects duplicate questions and invalid money', async () => {
    const f = fixture(); const q = questions(1)[0]; expect(() => loadCorpusHash([q, { ...q, id: 'other' }])).toThrow();
    await expect(f.store.create({ ...authority, maxAttemptNanoUsd: Number.MAX_SAFE_INTEGER + 1 }, questions(1), 1)).rejects.toMatchObject({ code: 'invalid' });
  });
  it('server service never accepts a replacement authority during advance', async () => {
    const f = fixture(); let current = authority; const adapter = vi.fn();
    const service = new ProviderLoadBatchService(f.store, questions(2), async () => current, adapter);
    await service.create(1); current = { ...authority, maxConcurrency: 9 };
    await expect(service.advance(randomUUID())).rejects.toMatchObject({ code: 'conflict' }); expect(adapter).not.toHaveBeenCalled();
  });
});

it('disable/re-enable invalidates old reserved claims and read projection omits unknown fields', async () => {
 const f = fixture(); await f.store.create(authority, questions(2), 1); const item = (await f.store.claim(authority.scopeId))!;
 const path = `free_chat_chain/provider_load_batches/scopes/${authority.scopeId}/items/0`;
 f.docs.set(path, { ...f.docs.get(path), token: 'secret' });
 expect(JSON.stringify(await f.store.readItem(authority.scopeId, 0))).not.toContain('secret');
 f.docs.set('free_chat_chain/provider_diagnostics/control/cheaperinference', { enabled: true, revision: 3 });
 expect(await f.store.dispatch(authority.scopeId, item)).toBe(false);
});

it('a duplicate advance key never allocates another wave, even after first wave completes', async () => {
 const f = fixture(), corpus = questions(4); await f.store.create(authority, corpus, 2);
 const adapter = { model: authority.model, call: vi.fn().mockResolvedValue(result) }, key = randomUUID();
 await Promise.all([executeWave(authority.scopeId, corpus, f.store, adapter, key), executeWave(authority.scopeId, corpus, f.other, adapter, key)]);
 await executeWave(authority.scopeId, corpus, f.store, adapter, key);
 expect(adapter.call).toHaveBeenCalledTimes(2); expect((await f.store.read(authority.scopeId))?.next).toBe(2);
});
it.each([502, 503, 504])('HTTP%s does not prove upstream work stopped', async status => {
 const f = fixture(), corpus = questions(2); await f.store.create(authority, corpus, 1);
 await advanceLoadBatch(authority.scopeId, corpus, f.store, { model: authority.model, call: vi.fn().mockRejectedValue(new FreeChainProviderError(status === 504 ? 'TIMEOUT' : 'SERVER', { status })) });
 expect(await f.store.read(authority.scopeId)).toMatchObject({ active: 1, heldNanoUsd: 1000 });
});
it('shared admission failure never dispatches and releases only the local unsent slot', async () => {
 const f=fixture(),corpus=questions(2);await f.store.create(authority,corpus,1);const call=vi.fn();
 await expect(executeWave(authority.scopeId,corpus,f.store,{model:authority.model,call},randomUUID(),undefined,async()=>{throw Error('shared hold uncertain');})).rejects.toMatchObject({code:'unavailable'});
 expect(call).not.toHaveBeenCalled();expect(await f.store.read(authority.scopeId)).toMatchObject({next:1,active:0,heldNanoUsd:0});
 expect(await f.store.readItem(authority.scopeId,0)).toMatchObject({state:'cancelled',actualNanoUsd:null,reason:'not_dispatched'});
});
it('lost shared settlement still preserves actual local receipt and never replays the wave', async () => {
 const f=fixture(),corpus=questions(2);await f.store.create(authority,corpus,1);const call=vi.fn().mockResolvedValue(result),key=randomUUID();
 const admit=vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(Error('lost')));
 await expect(executeWave(authority.scopeId,corpus,f.store,{model:authority.model,call},key,undefined,admit)).rejects.toThrow();
 expect(await f.store.readItem(authority.scopeId,0)).toMatchObject({actualNanoUsd:100,quality:'pass'});
 await executeWave(authority.scopeId,corpus,f.store,{model:authority.model,call},key,undefined,admit);expect(call).toHaveBeenCalledOnce();expect(admit).toHaveBeenCalledOnce();
});
it('configuration revision invalidates reserved old settings before physical dispatch',async()=>{
 const f=fixture(),corpus=questions(2);await f.store.create(authority,corpus,1);const item=(await f.store.claim(authority.scopeId))!;
 await f.store.update(authority.scopeId,0,{...authority,maxOutputTokens:1024},corpus,2,1,'admin');
 expect(await f.store.dispatch(authority.scopeId,item)).toBe(false);expect(await f.store.read(authority.scopeId)).toMatchObject({next:1,active:0,heldNanoUsd:0});
});
it('stale wave revision cannot use an adapter prepared before a settings edit',async()=>{
 const f=fixture(),corpus=questions(2);await f.store.create(authority,corpus,1);await f.store.update(authority.scopeId,0,{...authority,maxOutputTokens:1024},corpus,2,1,'admin');
 const call=vi.fn();await expect(executeWave(authority.scopeId,corpus,f.store,{model:authority.model,call},randomUUID(),undefined,undefined,0)).rejects.toMatchObject({code:'conflict'});expect(call).not.toHaveBeenCalled();
});

import { MAX_CONCURRENCY as LOAD_MAX_CONCURRENCY } from './providerLoadBatch';
describe('load batch concurrency ceiling', () => {
  it('allows flexible concurrency up to 10 lakh', () => { expect(LOAD_MAX_CONCURRENCY).toBe(1_000_000); });
});
