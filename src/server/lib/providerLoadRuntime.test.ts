import { expect, it, vi } from 'vitest';
import { ProviderLoadRuntime } from './providerLoadRuntime';
import { providerLoadDb } from '../../../tests/fixtures/providerLoadDb';
import { providerLoadCorpus } from './providerLoadCorpus';
import { loadCorpusHash } from './providerLoadBatch';
const config = { expectedRevision: 0, budgetInr: '1000', allInInrPerUsd: '100', priorSupplierUsd: '0.048822', priorAttempts: 640, attempts: 360, concurrency: 2, outputTokens: 2048 };
const quote = () => Promise.resolve({ model: 'beam', maximumNanoUsd: 1000, checkedAt: Date.now(), source: 'official-contract-mock' });
it('status is read-only; configuration creates no inference and includes prior spend', async () => {
 const { db, docs } = providerLoadDb(), reader = vi.fn(quote); const runtime = new ProviderLoadRuntime(db, reader);
 expect(await runtime.status()).toEqual({ settings: null, batch: null }); expect(reader).not.toHaveBeenCalled();
 const b = await runtime.configure(config, 'verified-admin');
 expect(b).toMatchObject({ count: 360, revision: 1, spentNanoUsd: 48822000, concurrency: 2, authority: { totalAttempts: 1000, totalBudgetNanoUsd: 10000000000 } });
 expect([...docs.keys()].some(path => path.endsWith('/audit/1'))).toBe(true);
 expect([...docs.values()].some(v => JSON.stringify(v).includes('Return only'))).toBe(false);
});
it('budget/count/concurrency edit is version checked and does not reset existing claims or liability', async () => {
 const { db } = providerLoadDb(), runtime = new ProviderLoadRuntime(db, quote);
 const b = await runtime.configure(config, 'admin'); const item = (await runtime.store.claim(b.scopeId))!;
 await runtime.store.dispatch(b.scopeId, item);
 await runtime.store.finish(b.scopeId, item, { actualNanoUsd: null, quality: 'not_evaluated', responseReceived: false, usage: { inputTokens:null,outputTokens:null,cachedTokens:null }, elapsedMs:100 });
 const next = await runtime.configure({ ...config, expectedRevision: 1, attempts: 400, budgetInr: '1200', concurrency: 3 }, 'admin');
 expect(next).toMatchObject({ revision:2, next:1, heldNanoUsd:1000, active:1, completed:1, count:400, concurrency:3 });
 await expect(runtime.configure({ ...config, expectedRevision:1 }, 'admin')).rejects.toMatchObject({ code:'conflict' });
 await expect(runtime.configure({ ...config, expectedRevision:2, budgetInr:'0.01' }, 'admin')).rejects.toMatchObject({ code:'invalid' });
 await expect(runtime.configure({ ...config, expectedRevision:2, priorSupplierUsd:'0' }, 'admin')).rejects.toMatchObject({ code:'invalid' });
});
it('concurrent configuration writers cannot silently overwrite a budget', async () => {
 const { db } = providerLoadDb(), a = new ProviderLoadRuntime(db, quote), b = new ProviderLoadRuntime(db, quote);
 await a.configure(config, 'admin');
 const results = await Promise.allSettled([a.configure({ ...config, expectedRevision:1, budgetInr:'1100' }, 'a'), b.configure({ ...config, expectedRevision:1, budgetInr:'1200' }, 'b')]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it('absent real quote is a clear unavailable outcome, not a synthetic attestation or zero price', async () => {
 const { db, docs } = providerLoadDb(); const before=docs.size;
 await expect(new ProviderLoadRuntime(db,async()=>{throw Error('raw sensitive body');}).configure(config,'admin')).rejects.toThrow();
 expect(docs.size).toBe(before);
});
it.each([{budgetInr:'NaN'},{attempts:-1},{concurrency:0},{allInInrPerUsd:'0'},{priorSupplierUsd:'-1'},{outputTokens:0},{key:'secret'}])('rejects invalid or privileged configuration %j', async patch => {
 const {db}=providerLoadDb(); await expect(new ProviderLoadRuntime(db,quote).configure({...config,...patch},'admin')).rejects.toThrow();
});
it('generated public corpus has stable prefixes, unique tasks, and deterministic checks', () => {
 const a=providerLoadCorpus(360), b=providerLoadCorpus(600);
 expect(a).toEqual(b.slice(0,360)); expect(new Set(b.map(q=>q.prompt)).size).toBe(600);
 expect(loadCorpusHash(a)).toBe(loadCorpusHash(b.slice(0,360))); expect(new Set(b.map(q=>q.id)).size).toBe(600);
});
it('explicit revision-checked resume preserves claims, spend and unknown holds',async()=>{
 const {db}=providerLoadDb(),runtime=new ProviderLoadRuntime(db,quote);const b=await runtime.configure(config,'admin');const item=(await runtime.store.claim(b.scopeId))!;
 await runtime.store.dispatch(b.scopeId,item);await runtime.store.finish(b.scopeId,item,{actualNanoUsd:null,quality:'not_evaluated',responseReceived:false,usage:{inputTokens:null,outputTokens:null,cachedTokens:null},elapsedMs:1});
 await runtime.stop('admin');const stopped=(await runtime.status()).batch!;expect(stopped.stopped).toBe(true);
 await expect(runtime.resume(stopped.revision-1,'admin')).rejects.toMatchObject({code:'conflict'});
 await runtime.resume(stopped.revision,'admin');expect((await runtime.status()).batch).toMatchObject({next:1,active:1,heldNanoUsd:1000,stopped:false});
});
it('identifies actual settings-read and configuration-write failures without raw database errors',async()=>{
 const f=providerLoadDb();const runtime=new ProviderLoadRuntime(f.db,quote);
 const doc=vi.spyOn(f.db,'doc').mockImplementation(()=>{throw Error('private database credential');});
 await expect(runtime.configure(config,'admin')).rejects.toMatchObject({stage:'settings_read',reason:'operation_unavailable'});doc.mockRestore();
 const tx=vi.spyOn(f.db,'runTransaction').mockRejectedValue(Error('private lost acknowledgement'));
 await expect(runtime.configure(config,'admin')).rejects.toMatchObject({stage:'configuration_write',reason:'operation_unavailable'});tx.mockRestore();
});
it('reports revision conflict before native quote or mutation',async()=>{
 const f=providerLoadDb(),reader=vi.fn(quote),runtime=new ProviderLoadRuntime(f.db,reader);
 await expect(runtime.configure({...config,expectedRevision:1},'admin')).rejects.toMatchObject({stage:'revision',reason:'revision_conflict'});expect(reader).not.toHaveBeenCalled();
});
