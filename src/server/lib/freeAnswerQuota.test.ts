import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const m = vi.hoisted(() => ({ reserve: vi.fn(), renew: vi.fn(), settle: vi.fn(), status: vi.fn(), identify: vi.fn(), limiter: vi.fn() }));
vi.mock('./freeAnswerQuotaStore', async original => ({ ...await original<typeof import('./freeAnswerQuotaStore')>(), FreeAnswerQuotaStore: class { reserve=m.reserve; renew=m.renew; settle=m.settle; status=m.status; } }));
vi.mock('./authMiddleware', () => ({ verifyFirebaseToken: m.identify, rateLimiter: m.limiter }));
import { FreeAnswerQuotaWindowChangedError } from './freeAnswerQuotaStore';
import { chatAvailabilityMessage } from './chatAvailabilityMessage';
import { consumeChatResponseStream } from '../../lib/chatResponseStream';
import { withFreeAnswerQuota, markFreeAnswer, freeAnswerSignal, registerFreeAnswerQuotaRoutes } from './freeAnswerQuota';
function fixture() { const req: any = { headers: {}, socket: { remoteAddress: '127.0.0.1' } }; const res: any = new EventEmitter(); res.status=vi.fn(() => res); res.json=vi.fn(); res.setHeader=vi.fn(); return {req,res}; }
beforeEach(() => { vi.clearAllMocks(); m.identify.mockResolvedValue('verified'); m.renew.mockResolvedValue(true); m.settle.mockResolvedValue(true); m.limiter.mockImplementation(() => (_req: unknown, _res: unknown, next: () => void) => next()); m.reserve.mockImplementation(async()=>({ allowed:true, reservation:{id:'id',owner:'owner',startedAt:Date.now(),deadlineAt:Date.now()+90000,leaseExpiresAt:Date.now()+30000},status:{} })); });
afterEach(() => { vi.useRealTimers(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
async function flush() { for(let n=0;n<6;n++) await Promise.resolve(); }
describe('shared Free answer request admission', () => {
 it('uses verified identity and ignores body claimed user', async () => {const {req,res}=fixture(); req.body={userId:'victim'}; await withFreeAnswerQuota(req,res,async()=>markFreeAnswer(req)); expect(m.reserve.mock.calls[0][0]).toMatchObject({key:'user:verified',limit:50}); expect(m.settle.mock.calls[0][1]).toBe('answered');});
 it('blocks before handler and never retries paid on exhaustion',async()=>{m.reserve.mockResolvedValue({allowed:false,reason:'daily-limit',status:{}}); const {req,res}=fixture(); const run=vi.fn(); await withFreeAnswerQuota(req,res,run); expect(run).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(429); expect(res.json.mock.calls[0][0].code).toBe('FREE_ANSWER_DAILY_LIMIT');});
 it('restores a connected failed turn but retains abandoned uncertainty',async()=>{const a=fixture(); await withFreeAnswerQuota(a.req,a.res,async()=>{}); expect(m.settle.mock.calls[0][1]).toBe('provider-failed'); const b=fixture(); await withFreeAnswerQuota(b.req,b.res,async()=>{b.res.emit('close'); expect(freeAnswerSignal(b.req)?.aborted).toBe(true);}); expect(m.settle.mock.calls[1][1]).toBe('uncertain');});
 it('counts a partial answer despite later disconnect',async()=>{const {req,res}=fixture(); await withFreeAnswerQuota(req,res,async()=>{markFreeAnswer(req);res.emit('close');}); expect(m.settle.mock.calls[0][1]).toBe('answered');});
 it('fails closed on unavailable storage',async()=>{m.reserve.mockRejectedValue(new Error('offline'));const {req,res}=fixture(); const run=vi.fn();await withFreeAnswerQuota(req,res,run);expect(run).not.toHaveBeenCalled();expect(res.status).toHaveBeenCalledWith(503);});
 it('aborts at the local lease boundary even when renewal never returns', async () => {
  vi.useFakeTimers(); const {req,res}=fixture(); const work=deferred<void>();
  m.renew.mockImplementation(()=>new Promise<boolean>(()=>{}));
  const pending=withFreeAnswerQuota(req,res,()=>work.promise); await flush();
  const signal=freeAnswerSignal(req)!; expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(m.renew).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(true);
  expect(()=>markFreeAnswer(req)).toThrow(); expect(m.settle).not.toHaveBeenCalled();
  work.resolve(); await pending;
  expect(m.settle.mock.calls[0][1]).toBe('uncertain'); expect(vi.getTimerCount()).toBe(0);
 });
 it('does not revive output when a successful renewal response arrives after local expiry', async () => {
  vi.useFakeTimers(); const {req,res}=fixture(); const work=deferred<void>(); const renewal=deferred<boolean>();
  m.renew.mockReturnValue(renewal.promise);
  const pending=withFreeAnswerQuota(req,res,()=>work.promise); await flush(); const signal=freeAnswerSignal(req)!;
  await vi.advanceTimersByTimeAsync(30_001); expect(signal.aborted).toBe(true);
  renewal.resolve(true); await flush();
  expect(signal.aborted).toBe(true); expect(()=>markFreeAnswer(req)).toThrow();
  work.resolve(); await pending; expect(vi.getTimerCount()).toBe(0);
 });
 it('does not recreate timers when a pending renewal resolves after handler cleanup', async () => {
  vi.useFakeTimers(); const {req,res}=fixture(); const work=deferred<void>(); const renewal=deferred<boolean>();
  m.renew.mockReturnValue(renewal.promise);
  const pending=withFreeAnswerQuota(req,res,()=>work.promise); await flush();
  await vi.advanceTimersByTimeAsync(10_000); expect(m.renew).toHaveBeenCalledOnce();
  work.resolve(); await pending;
  expect(freeAnswerSignal(req)).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  renewal.resolve(true); await flush();
  expect(vi.getTimerCount()).toBe(0); expect(m.settle).toHaveBeenCalledOnce();
 });
 it('aborts at ninety seconds even when every renewal succeeds and never settles before upstream ends', async () => {
  vi.useFakeTimers(); const {req,res}=fixture(); const work=deferred<void>();
  const pending=withFreeAnswerQuota(req,res,()=>work.promise); await flush(); const signal=freeAnswerSignal(req)!;
  await vi.advanceTimersByTimeAsync(89_999); expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(signal.aborted).toBe(true);
  expect(m.renew).toHaveBeenCalledTimes(8); expect(m.settle).not.toHaveBeenCalled();
  work.resolve(); await pending;
  expect(m.settle.mock.calls[0][1]).toBe('uncertain'); expect(vi.getTimerCount()).toBe(0);
 });
 it('uses an isolated polling limiter and only verified identity for no-store status', async () => {
  const routes=new Map<string, any[]>(); registerFreeAnswerQuotaRoutes({get:(path:string,...handlers:any[])=>routes.set(path,handlers)} as never);
  expect(m.limiter).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({name:'free-answer-status',durable:false}));
  const handlers=routes.get('/api/free-answers/status')!; const {req,res}=fixture();
  req.body={uid:'victim',userId:'victim',key:'user:victim'}; req.query={uid:'victim'}; req.headers['x-user-id']='victim';
  const status={limit:20,used:3,reserved:1,remaining:16,inProgress:true,day:'2026-10-23',resetsAt:Date.now()+1000}; m.status.mockResolvedValue(status);
  let work:Promise<unknown>|undefined; handlers[0](req,res,()=>{work=handlers[1](req,res);}); await work;
  expect(m.status).toHaveBeenCalledWith({key:'user:verified',limit:50});
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control','no-store'); expect(res.json).toHaveBeenCalledWith(status);
  expect(m.reserve).not.toHaveBeenCalled(); expect(m.settle).not.toHaveBeenCalled();
 });
 it('does not convert forged status account fields into authenticated guest credit', async () => {
  m.identify.mockResolvedValue(null); const routes=new Map<string, any[]>();
  registerFreeAnswerQuotaRoutes({get:(path:string,...handlers:any[])=>routes.set(path,handlers)} as never);
  const {req,res}=fixture(); req.body={userId:'victim'}; req.headers={'x-forwarded-for':'203.0.113.77, 203.0.113.9','x-nb-guest':'22222222-2222-4222-8222-222222222222'};
  await routes.get('/api/free-answers/status')![1](req,res);
  expect(m.status).toHaveBeenCalledWith({key:'guest-device:22222222-2222-4222-8222-222222222222',limit:10,ipKey:'ip:203.0.113.9',guest:true});
 });
});

it('a timed-out durable settlement emits one failure, keeps its original outcome, and ignores late success', async () => {
 vi.useFakeTimers(); const {req,res}=fixture(); const settlement=deferred<boolean>();
 res.headersSent=true; res.writableEnded=false;
 const end=vi.fn((_body: string)=>{res.writableEnded=true;return res;}); res.end=end; res.write=vi.fn(()=>true);
 m.settle.mockReturnValueOnce(settlement.promise);
 const pending=withFreeAnswerQuota(req,res,async()=>{markFreeAnswer(req);res.write('data: {"c":"partial"}\n\n');res.end('data: [DONE]\n\n');});
 await flush(); expect(m.settle).toHaveBeenCalledOnce(); expect(end).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(5_000); await pending;
 expect(end).toHaveBeenCalledOnce();expect(end.mock.calls[0][0]).toContain('FREE_ANSWER_UNAVAILABLE');expect(end.mock.calls[0][0]).not.toContain('[DONE]');
 expect(m.settle.mock.calls[0][1]).toBe('answered');expect(freeAnswerSignal(req)).toBeUndefined();expect(vi.getTimerCount()).toBe(0);
 settlement.resolve(true);await flush();expect(end).toHaveBeenCalledOnce();expect(m.settle).toHaveBeenCalledOnce();
});

it('lets the store sample live authority time instead of pinning reserve, renew or settle to request time', async () => {
 vi.useFakeTimers(); const {req,res}=fixture(); const work=deferred<void>();
 const pending=withFreeAnswerQuota(req,res,()=>work.promise); await flush();
 expect(m.reserve.mock.calls[0]).toHaveLength(2);
 await vi.advanceTimersByTimeAsync(10_000);
 expect(m.renew.mock.calls[0]).toHaveLength(1);
 work.resolve(); await pending;
 expect(m.settle.mock.calls[0]).toHaveLength(2);
});

it('never dispatches when commit or transport delay returns an admission after its lease expired', async () => {
 vi.useFakeTimers(); const {req,res}=fixture(); const startedAt=Date.now(); const admission=deferred<unknown>();
 m.reserve.mockReturnValueOnce(admission.promise); m.settle.mockResolvedValue(false);
 const run=vi.fn(async()=>{}); const pending=withFreeAnswerQuota(req,res,run); await flush();
 expect(m.reserve).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(31_000);
 admission.resolve({allowed:true,reservation:{id:'id',owner:'owner',startedAt,deadlineAt:startedAt+90_000,leaseExpiresAt:startedAt+30_000},status:{}});
 await pending;
 expect(run).not.toHaveBeenCalled(); expect(m.settle).toHaveBeenCalledWith(expect.any(Object),'uncertain');
 expect(res.status).toHaveBeenCalledWith(503); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({code:'FREE_ANSWER_UNAVAILABLE'}));
 expect(freeAnswerSignal(req)).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
});


it('classifies a midnight admission refusal internally without disclosing details or dispatching', async () => {
 const {req,res}=fixture(); const run=vi.fn(async()=>{});
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try {
  m.reserve.mockRejectedValueOnce(new FreeAnswerQuotaWindowChangedError());
  await withFreeAnswerQuota(req,res,run);
  expect(warning).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'free_answer_admission',code:'day_window_changed'}));
  expect(run).not.toHaveBeenCalled(); expect(m.settle).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({code:'FREE_ANSWER_UNAVAILABLE'}));
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('daily quota boundary');
 } finally {warning.mockRestore();}
});


it.each([
 {name:'carried Hindi',replyLanguage:'hi',body:{message:'mujhe ek sawal poochna hai',replyLanguage:'hi'}},
 {name:'carried Tamil',replyLanguage:'ta',body:{message:'mujhe ek sawal poochna hai',replyLanguage:'ta'}},
 {name:'current Tamil override',replyLanguage:'ta',body:{message:'For this answer only, reply in Tamil',replyLanguage:'hi'}},
 {name:'persistent Hindi history',replyLanguage:'hi',body:{message:'What next?',history:[{sender:'user',text:'Reply in Hindi'}]}},
])('keeps a timed-out settlement terminal localized via $name with no successful DONE or replay', async ({replyLanguage,body}) => {
 vi.useFakeTimers(); const {req,res}=fixture(); const settlement=deferred<boolean>();
 req.body=body;
 res.headersSent=true; res.writableEnded=false;
 const end=vi.fn((_body: string)=>{res.writableEnded=true;return res;}); res.end=end; res.write=vi.fn(()=>true);
 m.settle.mockReturnValueOnce(settlement.promise);
 const pending=withFreeAnswerQuota(req,res,async()=>{markFreeAnswer(req);res.write('data: {"c":"partial"}\n\n');res.end('data: [DONE]\n\n');});
 await flush(); expect(m.settle).toHaveBeenCalledOnce(); expect(end).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(5_000); await pending;
 const reply=chatAvailabilityMessage('temporary',{replyLanguage});
 expect(end).toHaveBeenCalledOnce();
 const wire=end.mock.calls[0][0];
 expect(wire).not.toMatch(/\[DONE\]|API|provider|budget|diagnostic|traffic|busy/i);
 expect((await consumeChatResponseStream(new Response(wire).body!,true,vi.fn())).failure)
  .toEqual({code:'FREE_ANSWER_UNAVAILABLE',message:reply,partial:true});
 expect(m.settle.mock.calls[0][1]).toBe('answered');expect(vi.getTimerCount()).toBe(0);
 settlement.resolve(true);await flush();expect(end).toHaveBeenCalledOnce();expect(m.settle).toHaveBeenCalledOnce();
});
