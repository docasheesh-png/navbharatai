import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FreeChainAdmissionQueue, DEFAULT_ADMISSION_QUEUE_LIMITS, freeChainAdmissionQueue, type AdmissionRequest, type AdmissionResult } from './admissionQueue';
function granted(result: AdmissionResult) { if (!result.admitted) throw new Error(`Unexpected ${result.reason}`); return result; }
const request = (uid: string, extra: Partial<AdmissionRequest> = {}): AdmissionRequest => ({ uid, maxActive: 1, maxQueued: 4, maxWaitMs: 1000, ...extra });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T12:00:00Z')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('bounded process-local free-chat turn admission', () => {
 it('has conservative frozen defaults and a reusable singleton', () => { expect(DEFAULT_ADMISSION_QUEUE_LIMITS).toEqual({maxActive:8,maxQueued:64,maxWaitMs:5000,perUserActive:1,perUserQueued:1});expect(Object.isFrozen(DEFAULT_ADMISSION_QUEUE_LIMITS)).toBe(true);expect(freeChainAdmissionQueue).toBeInstanceOf(FreeChainAdmissionQueue); });
 it('grants immediately, frees all user state, and release is idempotent', async () => { const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a')));expect(a.waitedMs).toBe(0);expect(q.snapshot()).toEqual({active:1,queued:0,activeUsers:1,queuedUsers:0});a.release();a.release();expect(q.snapshot()).toEqual({active:0,queued:0,activeUsers:0,queuedUsers:0}); });
 it('queues and grants FIFO when a slot is released', async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a')));const b=q.acquire(request('b'));const c=q.acquire(request('c'));await vi.advanceTimersByTimeAsync(50);a.release();const second=granted(await b);expect(second.waitedMs).toBe(50);expect(q.snapshot().queued).toBe(1);second.release();granted(await c).release();expect(vi.getTimerCount()).toBe(0);});
 it('rejects overflow without creating another timer or retained user',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a',{maxQueued:1})));const b=q.acquire(request('b',{maxQueued:1}));expect(await q.acquire(request('c',{maxQueued:1}))).toMatchObject({admitted:false,reason:'queue-full'});expect(q.snapshot()).toEqual({active:1,queued:1,activeUsers:1,queuedUsers:1});expect(vi.getTimerCount()).toBe(1);a.release();granted(await b).release();});
 it('allows one waiting turn per active user, then rejects monopolization',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a')));const next=q.acquire(request('a'));expect(await q.acquire(request('a'))).toMatchObject({admitted:false,reason:'user-limit'});a.release();granted(await next).release();});
 it('does not head-of-line block other users behind a busy user',async()=>{const q=new FreeChainAdmissionQueue();const limits={maxActive:2};const a=granted(await q.acquire(request('a',limits)));const b=granted(await q.acquire(request('b',limits)));const nextA=q.acquire(request('a',limits));const c=q.acquire(request('c',limits));b.release();const admittedC=granted(await c);expect(q.snapshot()).toEqual({active:2,queued:1,activeUsers:2,queuedUsers:1});a.release();granted(await nextA).release();admittedC.release();});
 it('expires a waiter, releases its identity, and does not leak timers',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a')));const b=q.acquire(request('b'));await vi.advanceTimersByTimeAsync(1000);expect(await b).toEqual({admitted:false,reason:'timeout',waitedMs:1000});expect(q.snapshot().queuedUsers).toBe(0);expect(vi.getTimerCount()).toBe(0);a.release();});
 it('removes abort listeners on cancellation',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a')));const controller=new AbortController();const remove=vi.spyOn(controller.signal,'removeEventListener');const b=q.acquire(request('b',{signal:controller.signal}));controller.abort();expect(await b).toMatchObject({admitted:false,reason:'aborted'});expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));expect(q.snapshot().queued).toBe(0);expect(vi.getTimerCount()).toBe(0);a.release();});
 it('aborted input is never queued or granted',async()=>{const q=new FreeChainAdmissionQueue();const controller=new AbortController();controller.abort();expect(await q.acquire(request('a',{signal:controller.signal}))).toMatchObject({admitted:false,reason:'aborted'});expect(q.snapshot().active).toBe(0);});
 it('does not free an active turn merely because its signal aborts',async()=>{const q=new FreeChainAdmissionQueue();const controller=new AbortController();const a=granted(await q.acquire(request('a',{signal:controller.signal})));controller.abort();expect(q.snapshot().active).toBe(1);a.release();expect(q.snapshot().active).toBe(0);});
 it('removes abort listener when granting and ignores later abort',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a')));const controller=new AbortController();const remove=vi.spyOn(controller.signal,'removeEventListener');const b=q.acquire(request('b',{signal:controller.signal}));a.release();const admitted=granted(await b);expect(remove).toHaveBeenCalled();controller.abort();expect(q.snapshot().active).toBe(1);admitted.release();});
 it('checks the deadline at grant time even when timers have not run',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a')));const b=q.acquire(request('b'));vi.setSystemTime(Date.now()+1001);a.release();expect(await b).toMatchObject({admitted:false,reason:'timeout'});expect(q.snapshot().active).toBe(0);});
 it('zero wait gives a cheap capacity denial with no retained promise',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a',{maxWaitMs:0})));expect(await q.acquire(request('b',{maxWaitMs:0}))).toMatchObject({admitted:false,reason:'capacity'});expect(vi.getTimerCount()).toBe(0);a.release();});
 it('zero per-user queue denies an extra same-user turn',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a',{perUserQueued:0})));expect(await q.acquire(request('a',{perUserQueued:0}))).toMatchObject({admitted:false,reason:'user-limit'});a.release();});
 it.each([{maxActive:0},{maxActive:65},{maxQueued:1025},{maxQueued:-1},{maxWaitMs:10001},{maxWaitMs:NaN},{perUserActive:0},{perUserActive:2},{perUserQueued:17},{maxActive:1.5},{uid:''},{uid:' '.repeat(3)},{uid:'x'.repeat(513)}])('invalid server configuration fails closed %j',async extra=>{const q=new FreeChainAdmissionQueue();expect(await q.acquire(request('a',extra))).toMatchObject({admitted:false,reason:'capacity'});expect(q.snapshot().active).toBe(0);expect(vi.getTimerCount()).toBe(0);});
 it('new tighter config governs queued grants without revoking active turns',async()=>{const q=new FreeChainAdmissionQueue();const a=granted(await q.acquire(request('a',{maxActive:2})));const b=granted(await q.acquire(request('b',{maxActive:2})));const c=q.acquire(request('c',{maxActive:1}));a.release();expect(q.snapshot()).toMatchObject({active:1,queued:1});b.release();granted(await c).release();});
 it('supports disabling the waiting queue without disabling immediate service', async () => {
  const q = new FreeChainAdmissionQueue();
  const a = granted(await q.acquire(request('a', { maxQueued: 0 })));
  expect(await q.acquire(request('b', { maxQueued: 0 }))).toMatchObject({ admitted: false, reason: 'queue-full' });
  expect(vi.getTimerCount()).toBe(0);
  a.release();
 });
 it('abort, timeout and repeated release cannot resolve or release the same waiter twice', async () => {
  const q = new FreeChainAdmissionQueue();
  const a = granted(await q.acquire(request('a')));
  const controller = new AbortController();
  const b = q.acquire(request('b', { signal: controller.signal }));
  controller.abort();
  a.release();
  a.release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(await b).toMatchObject({ admitted: false, reason: 'aborted' });
  expect(q.snapshot()).toEqual({ active: 0, queued: 0, activeUsers: 0, queuedUsers: 0 });
  expect(vi.getTimerCount()).toBe(0);
 });
 it('timeout removes its abort listener and later cancellation cannot affect active work', async () => {
  const q = new FreeChainAdmissionQueue();
  const a = granted(await q.acquire(request('a')));
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const b = q.acquire(request('b', { signal: controller.signal }));
  await vi.advanceTimersByTimeAsync(1000);
  expect(await b).toMatchObject({ admitted: false, reason: 'timeout' });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  controller.abort();
  expect(q.snapshot().active).toBe(1);
  a.release();
 });
 it('bounds a 10,000 distinct-user burst to 8 active and 64 queued',async()=>{const q=new FreeChainAdmissionQueue();const pending=Array.from({length:10000},(_,i)=>q.acquire({uid:`user-${i}`}));expect(q.snapshot()).toEqual({active:8,queued:64,activeUsers:8,queuedUsers:64});expect(vi.getTimerCount()).toBe(64);const first=await Promise.all(pending.slice(0,8));const overflow=await Promise.all(pending.slice(72));expect(overflow.every(r=>!r.admitted&&r.reason==='queue-full')).toBe(true);await vi.advanceTimersByTimeAsync(DEFAULT_ADMISSION_QUEUE_LIMITS.maxWaitMs);expect((await Promise.all(pending.slice(8,72))).every(r=>!r.admitted&&r.reason==='timeout')).toBe(true);first.forEach(r=>granted(r).release());expect(q.snapshot()).toEqual({active:0,queued:0,activeUsers:0,queuedUsers:0});expect(vi.getTimerCount()).toBe(0);});
 it('a 10,000 same-user burst retains only one active and one waiting',async()=>{const q=new FreeChainAdmissionQueue();const pending=Array.from({length:10000},()=>q.acquire({uid:'same-user'}));expect(q.snapshot()).toEqual({active:1,queued:1,activeUsers:1,queuedUsers:1});expect((await Promise.all(pending.slice(2))).every(r=>!r.admitted&&r.reason==='user-limit')).toBe(true);granted(await pending[0]).release();granted(await pending[1]).release();expect(q.snapshot().queuedUsers).toBe(0);});
});
