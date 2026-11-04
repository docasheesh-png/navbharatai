import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { inQuotaLane } from './quotaLane';
import { FreeChainStore } from './store';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve=r; }); return {resolve,promise}; };
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
it('serializes same-account work but permits different accounts and database instances',async()=>{
 const db={},otherDb={},hold=deferred();let active=0,peak=0,other=0;
 const run=async()=>{peak=Math.max(peak,++active);await hold.promise;active--;};
 const a=inQuotaLane(db,'glm',run),b=inQuotaLane(db,'glm',run);
 await inQuotaLane(db,'groq',async()=>{other++;});await inQuotaLane(otherDb,'glm',async()=>{other++;});
 expect(active).toBe(1);expect(peak).toBe(1);expect(other).toBe(2);
 hold.resolve();await Promise.all([a,b]);expect(active).toBe(0);expect(peak).toBe(1);expect(vi.getTimerCount()).toBe(0);
});
it('bounds waiting work, expires it without releasing a still-running transaction, then recovers',async()=>{
 const db={},hold=deferred();let dispatched=0;
 const first=inQuotaLane(db,'glm',async()=>{dispatched++;await hold.promise;});
 const queued=Array.from({length:1024},()=>inQuotaLane(db,'glm',async()=>{dispatched++;}).then(()=>true,()=>false));
 await expect(inQuotaLane(db,'glm',async()=>{})).rejects.toThrow('admission unavailable');
 expect(vi.getTimerCount()).toBe(1024);
 await vi.advanceTimersByTimeAsync(10000);expect((await Promise.all(queued)).every(v=>!v)).toBe(true);expect(dispatched).toBe(1);
 const last=inQuotaLane(db,'glm',async()=>{dispatched++;});await Promise.resolve();expect(dispatched).toBe(1);
 hold.resolve();await first;await last;expect(dispatched).toBe(2);expect(vi.getTimerCount()).toBe(0);
});
it('checks elapsed deadlines even before timer callbacks run',async()=>{
 const db={},hold=deferred();const first=inQuotaLane(db,'p',()=>hold.promise);
 const run=vi.fn(async()=>{});const queued=inQuotaLane(db,'p',run).catch(()=>null);
 vi.setSystemTime(Date.now()+10001);hold.resolve();await first;await queued;expect(run).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('bounds active lanes and releases a failed physical transaction',async()=>{
 const db={},hold=deferred();const active=Array.from({length:32},(_,i)=>inQuotaLane(db,String(i),()=>hold.promise));
 await expect(inQuotaLane(db,'overflow',async()=>{})).rejects.toThrow();hold.resolve();await Promise.all(active);
 await expect(inQuotaLane(db,'failure',async()=>{throw Error('SDK failure');})).rejects.toThrow('SDK failure');
 await expect(inQuotaLane(db,'failure',async()=>42)).resolves.toBe(42);
});
it('keeps the real shared quota ledger authoritative under a local reservation burst and status read',async()=>{
 const docs=new Map<string,unknown>();let active=0,peak=0;
 const db={doc:(path:string)=>({path}),runTransaction:async(run:any)=>{
  peak=Math.max(peak,++active);
  try {await new Promise(resolve=>setTimeout(resolve,1));return await run({get:async(ref:{path:string})=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),set:(ref:{path:string},value:unknown)=>docs.set(ref.path,value)});}
  finally{active--;}
 }};
 const store=new FreeChainStore(db as any);const input={provider:'synthetic',model:'synthetic',timeZone:'rolling24h',inputTokens:1,outputTokens:1,limits:{rpm:30},safetyMargin:0.9};
 const pending=Array.from({length:100},()=>new FreeChainStore(db as any).reserveQuota(input));
 const status=store.quotaSnapshot(input);await vi.advanceTimersByTimeAsync(200);
 const results=await Promise.all(pending);expect(results.filter(r=>r.allowed)).toHaveLength(27);expect(results.filter(r=>r.reason==='rpm')).toHaveLength(73);
 expect((await status).usage.rpm).toBe(27);expect(peak).toBe(1);expect(active).toBe(0);expect(vi.getTimerCount()).toBe(0);
});

it('reports local admission pressure separately from a database outage',async()=>{
 const hold=deferred();const db={doc:(path:string)=>({path}),runTransaction:async()=>{await hold.promise;return {allowed:true,reason:'allowed',resetAt:Date.now()+60000};}};
 const store=new FreeChainStore(db as any);const input={provider:'local-pressure',model:'synthetic',timeZone:'rolling24h',inputTokens:1,outputTokens:1,limits:{rpm:30}};
 const first=store.reserveQuota(input);const queued=store.reserveQuota(input);
 await vi.advanceTimersByTimeAsync(10000);expect(await queued).toMatchObject({allowed:false,reason:'local_capacity',resetAt:Date.now()});
 hold.resolve();await first;expect(vi.getTimerCount()).toBe(0);
});
