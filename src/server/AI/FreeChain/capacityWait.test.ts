import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { capacityRevision, notifyCapacityReleased, waitForCapacity } from './capacityWait';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('wakes after physical release and cleans timers/listeners',async()=>{
 const waiting=waitForCapacity(capacityRevision(),Date.now()+5000);notifyCapacityReleased();expect(await waiting).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('does not miss a release between scan and listener registration',async()=>{
 const observed=capacityRevision();notifyCapacityReleased();expect(await waitForCapacity(observed,Date.now()+5000)).toBe(true);
});
it('bounds waiting requests and expires without manufacturing capacity',async()=>{
 const deadline=Date.now()+50;const waiting=Array.from({length:64},()=>waitForCapacity(capacityRevision(),deadline));
 expect(await waitForCapacity(capacityRevision(),deadline)).toBe(false);await vi.advanceTimersByTimeAsync(50);expect((await Promise.all(waiting)).every(x=>!x)).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('cancels on disconnect and rejects an expired deadline',async()=>{
 const abort=new AbortController();const waiting=waitForCapacity(capacityRevision(),Date.now()+5000,abort.signal);abort.abort();expect(await waiting).toBe(false);
 expect(await waitForCapacity(capacityRevision(),Date.now())).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
