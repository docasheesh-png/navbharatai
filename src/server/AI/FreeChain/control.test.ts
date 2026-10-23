import { afterEach, it, expect, vi } from 'vitest';
import { readControls, readControlsForSelection, writeControls, controlsFrom, conversationHash } from './control';
import { freeChainConfig } from './config';
import type { Firestore } from '../../lib/serverDb';
const cfg=()=>freeChainConfig({FREE_CHAIN_ENABLED:'on',FREE_CHAIN_ROLLOUT_PERCENT:'100'});
function fixture(){
 let controls={enabled:true,rolloutPercent:100,disabledProviders:[] as string[]};
 const get=vi.fn(async()=>({data:()=>({controls})}));
 const ref={get,collection:()=>({doc:()=>({action:true})})};
 const db={collection:()=>({doc:()=>ref}),runTransaction:async(fn:any)=>fn({get:async()=>({data:()=>({controls})}),set:(target:unknown,data:any)=>{if(target===ref)controls=data.controls;}})} as unknown as Firestore;
 return {db,get,disable:()=>{controls={...controls,enabled:false};}};
}
afterEach(()=>vi.useRealTimers());
it('coalesces concurrent selection reads without caching a user or inference grant',async()=>{
 const f=fixture();const results=await Promise.all(Array.from({length:1000},()=>readControlsForSelection(f.db,cfg())));expect(f.get).toHaveBeenCalledTimes(1);expect(results.every(r=>r.enabled)).toBe(true);
 f.disable();expect((await readControlsForSelection(f.db,cfg())).enabled).toBe(true);expect((await readControls(f.db,cfg())).enabled).toBe(false);expect(f.get).toHaveBeenCalledTimes(2);
});
it('selection cache expires in one second',async()=>{vi.useFakeTimers();const f=fixture();await readControlsForSelection(f.db,cfg());f.disable();await vi.advanceTimersByTimeAsync(1001);expect((await readControlsForSelection(f.db,cfg())).enabled).toBe(false);});
it('failed selection reads fail closed and coalesce, not a fabricated ON snapshot',async()=>{const f=fixture();f.get.mockRejectedValue(new Error('offline'));const result=await Promise.allSettled(Array.from({length:20},()=>readControlsForSelection(f.db,cfg())));expect(result.every(r=>r.status==='rejected')).toBe(true);expect(f.get).toHaveBeenCalledTimes(1);});
it('a stalled selection lookup has a bounded timeout',async()=>{vi.useFakeTimers();const f=fixture();f.get.mockImplementation(()=>new Promise(()=>{}));const result=readControlsForSelection(f.db,cfg()).catch(e=>e.message);await vi.advanceTimersByTimeAsync(1500);expect(await result).toBe('FREE_CHAIN_CONTROL_UNAVAILABLE');});
it('successful audited compare-and-swap invalidates local selection cache',async()=>{const f=fixture();const previous=await readControlsForSelection(f.db,cfg());await writeControls(f.db,cfg(),{enabled:false,reason:'Stop this test rollout',expectedControls:previous},'admin');expect((await readControlsForSelection(f.db,cfg())).enabled).toBe(false);});
it('rejects stale compare-and-swap and malformed state',async()=>{const f=fixture();await expect(writeControls(f.db,cfg(),{enabled:false,reason:'Stale state test request',expectedControls:{enabled:true,rolloutPercent:0,disabledProviders:[]}},'admin')).rejects.toThrow('FREE_CHAIN_CONTROL_CONFLICT');expect(()=>controlsFrom({enabled:'yes'},cfg())).toThrow();});
it('binds conversation hash to verified identity without retaining raw content',()=>{expect(conversationHash('one','private')).not.toBe(conversationHash('two','private'));expect(conversationHash('one','private')).toMatch(/^[a-f0-9]{64}$/);});
