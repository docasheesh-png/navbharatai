import { describe, expect, it, vi } from 'vitest';
import { FirestoreRegistryStore } from './store';
import { normalizeModel } from './eligibility';
import type { CatalogManifest } from './types';
function fakeDb() {
  const data = new Map<string, any>();
  const clone = (v: any) => v === undefined ? undefined : structuredClone(v);
  const doc = (path: string): any => ({ path,
    async get() { const value = clone(data.get(path)); return { exists: value !== undefined, data: () => value }; },
    async set(value: any, opts?: any) { data.set(path, opts?.merge ? { ...data.get(path), ...clone(value) } : clone(value)); },
    collection(name: string) { return collection(`${path}/${name}`); },
  });
  const collection = (path: string, cap = Infinity, order?: string): any => ({
    doc(id: string) { return doc(`${path}/${id}`); },
    limit(n: number) { return collection(path, n, order); },
    orderBy(field: string) { return collection(path, cap, field); },
    async get() { let rows = [...data.entries()].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
      if (order) rows.sort((a,b) => b[1][order] - a[1][order]);
      rows = rows.slice(0, cap); const docs = rows.map(([path, value]) => ({ id: path.split('/').pop(), data: () => clone(value) })); return { size: docs.length, docs }; },
  });
  let tail = Promise.resolve();
  const db: any = { collection, runTransaction: vi.fn((fn: any) => { const run = tail.then(() => fn({ get: (ref: any) => ref.get(), set: (ref: any, value: any, opts: any) => ref.set(value, opts) })); tail = run.catch(() => {}); return run; }) };
  return { db, data };
}
function fixture(now: number, version: string) {
  const raw = { id: 'test/model:free', pricing: { prompt:'0', completion:'0' }, architecture: { input_modalities:['text'], output_modalities:['text'] }, context_length:100000 };
  const ep = { data: { id:raw.id, endpoints:[{ model_id:raw.id, tag:'test/endpoint', pricing:raw.pricing, context_length:100000, max_completion_tokens:8192, supported_parameters:['max_tokens'], supports_implicit_caching:false }] } };
  return normalizeModel(raw,ep,true,now,600000,version);
}
function manifest(now: number, version: string): CatalogManifest { return { version,count:1,fetchedAt:now,expiresAt:now+600000,accountVerified:true,transitions:{} }; }
describe('durable fenced registry storage', () => {
  it('only one concurrent sync claims an active lease', async () => { const { db }=fakeDb(); const store=new FirestoreRegistryStore(db); const now=Date.now(); const claims=await Promise.all([store.claim(now,120000),store.claim(now,120000)]); expect(claims.filter(Boolean)).toHaveLength(1); });
  it('database claim failure fails closed', async () => { const { db }=fakeDb(); db.runTransaction.mockRejectedValue(new Error('unavailable')); await expect(new FirestoreRegistryStore(db).claim(Date.now(),120000)).rejects.toThrow(); });
  it('publishes compact immutable chunks and reuses stable contents across refreshes', async () => { const { db,data }=fakeDb(); const store=new FirestoreRegistryStore(db); const now=Date.now(); const lease=(await store.claim(now,120000))!; await store.publish(lease,[fixture(now,'a')],manifest(now,'a')); const second=(await store.claim(now+1,120000))!; await store.publish(second,[fixture(now+1,'b')],manifest(now+1,'b')); const loaded=await store.read(); expect(loaded.manifest?.version).toBe('b'); expect(loaded.models[0].pricingVerifiedAt).toBe(now+1); expect([...data.keys()].filter(k=>k.includes('/chunks/'))).toHaveLength(1); });
  it('old expired writer cannot overwrite a newer lease or manifest', async () => { const { db,data }=fakeDb(); const store=new FirestoreRegistryStore(db); const now=Date.now(); const old=(await store.claim(now,120000))!; const state=data.get('live_ai_registry/openrouter'); state.lease.expiresAt=now-1; data.set('live_ai_registry/openrouter',state); const fresh=(await store.claim(now,120000))!; await store.publish(fresh,[fixture(now,'new')],manifest(now,'new')); await expect(store.publish(old,[fixture(now,'old')],manifest(now,'old'))).rejects.toThrow('lease'); expect((await store.read()).manifest?.version).toBe('new'); });
  it('disable survives catalog refresh and is enforced on the point-read dispatch gate', async () => { const { db }=fakeDb(); const store=new FirestoreRegistryStore(db); const now=Date.now(); let lease=(await store.claim(now,120000))!; await store.publish(lease,[fixture(now,'a')],manifest(now,'a')); await store.control('test/model:free','approve-terms','admin',now,'a','Reviewed intended use'); expect(await store.recheck((await store.read()).models[0],now)).toBe(true); await store.control('test/model:free','disable','admin',now,'a','Disabled for testing'); lease=(await store.claim(now+1,120000))!; await store.publish(lease,[fixture(now+1,'b')],manifest(now+1,'b')); expect(await store.recheck((await store.read()).models[0],now+1)).toBe(false); });
  it('terms review cannot bind a stale version', async () => { const { db }=fakeDb(); const store=new FirestoreRegistryStore(db); const now=Date.now(); await store.publish((await store.claim(now,120000))!,[fixture(now,'new')],manifest(now,'new')); await expect(store.control('test/model:free','approve-terms','admin',now,'old','Reviewed intended use')).rejects.toThrow('VERSION_CHANGED'); });
  it('quarantine remains effective despite a new manifest and no old-version match', async () => { const { db }=fakeDb(); const store=new FirestoreRegistryStore(db); const now=Date.now(); await store.publish((await store.claim(now,120000))!,[fixture(now,'new')],manifest(now,'new')); await store.quarantine('test/model:free','Unexpected charge',now); expect((await store.read()).controls['test/model:free'].disabled).toBe(true); });
  it('persisted retry-after prevents a new claim', async () => { const { db }=fakeDb(); const store=new FirestoreRegistryStore(db); const now=Date.now(); const lease=(await store.claim(now,120000))!; await store.fail(lease,now,'429',now+3600000); expect(await store.claim(now+300000,120000)).toBeNull(); });
});

describe('image metadata publication', () => {
  it('separately leases image discovery and bounds refresh to hourly', async () => { const { db } = fakeDb(); const store = new FirestoreRegistryStore(db); const now = Date.now(); const lease = (await store.claimImages(now))!; expect(await store.claimImages(now)).toBeNull(); await store.publishImages(lease, { fetchedAt: now, models: [] }, now); expect(await store.claimImages(now + 300000)).toBeNull(); expect((await store.imageState()).snapshot).toMatchObject({ fetchedAt: now }); });
  it('failed image scan preserves prior snapshot and applies retry cooldown', async () => { const { db, data } = fakeDb(); const store = new FirestoreRegistryStore(db); const now = Date.now(); data.set('live_ai_registry/openrouter-images', { snapshot: { models: ['old'] } }); const lease = (await store.claimImages(now))!; await store.failImages(lease, now, now + 7200000); expect(await store.claimImages(now + 3600000)).toBeNull(); expect((await store.imageState()).snapshot).toEqual({ models: ['old'] }); expect(await store.claimImages(now + 100)).toBeNull(); });
  it('expired image writer cannot publish', async () => { const { db, data } = fakeDb(); const store = new FirestoreRegistryStore(db); const now = Date.now(); const lease = (await store.claimImages(now))!; data.get('live_ai_registry/openrouter-images').lease.expiresAt = now - 1; await expect(store.publishImages(lease, { models: [] }, now)).rejects.toThrow('expired'); });
});
