import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
const m=vi.hoisted(()=>({verify:vi.fn(),db:vi.fn(),controls:vi.fn(),acquire:vi.fn(),release:vi.fn(),strict:vi.fn(),log:vi.fn(),write:vi.fn(),collection:vi.fn(),eventSet:vi.fn(),eventRef:vi.fn(),uuid:vi.fn(),providerSlot:vi.fn()}));
vi.mock('node:crypto',async original=>({...await original<typeof import('node:crypto')>(),randomUUID:m.uuid}));
vi.mock('../../lib/authMiddleware',()=>({verifyFirebaseToken:m.verify}));
vi.mock('../../lib/serverDb',()=>({getServerDb:m.db}));
vi.mock('../inferencePolicy',()=>({strictFreeRequired:m.strict}));
vi.mock('./control',()=>({readControlsForSelection:m.controls,readControls:m.controls,writeControls:vi.fn(),controlRef:m.eventRef,conversationHash:()=> 'hash'}));
vi.mock('../Router/AIRouter',()=>({acquireSlot:m.providerSlot,releaseSlot:vi.fn(),recordProviderLatency:vi.fn()}));
// Replace only queue execution; config must still consume the real shared admission limits.
vi.mock('./admissionQueue',async original=>({...await original<typeof import('./admissionQueue')>(),freeChainAdmissionQueue:{acquire:m.acquire}}));
vi.mock('./telemetry',()=>({logFreeChain:m.log}));
import { withFreeChainEntryAdmission, entryAdmissionFor, isEntryAdmission } from './entryAdmission';
import { freeChainRequestContext } from './requestContext';
import { maybeFreeChain } from './runtime';
const req=(body:unknown={message:'hello'})=>({body}) as Request;
function response(){const res=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,writableFinished:false,headersSent:false,setHeader:vi.fn(),flushHeaders:vi.fn(),write:vi.fn(),end:vi.fn(),json:vi.fn()});return res as unknown as Response;}
beforeEach(()=>{vi.clearAllMocks();m.uuid.mockReturnValue('00000000-0000-0000-0000-000000000001');m.eventSet.mockResolvedValue(undefined);m.eventRef.mockReturnValue({collection:()=>({doc:()=>({set:m.eventSet})})});vi.stubEnv('FREE_CHAIN_ENABLED','on');m.strict.mockReturnValue(false);m.verify.mockResolvedValue('server-uid');m.write.mockResolvedValue({});m.collection.mockReturnValue({add:m.write});m.db.mockReturnValue({collection:m.collection});m.controls.mockResolvedValue({enabled:true,rolloutPercent:100,disabledProviders:[]});m.acquire.mockResolvedValue({admitted:true,waitedMs:3,release:m.release});});
afterEach(()=>vi.unstubAllEnvs());
it('OFF retains handler behavior without authentication or store/queue work',async()=>{vi.stubEnv('FREE_CHAIN_ENABLED','off');const handler=vi.fn(async()=>42);expect(await withFreeChainEntryAdmission(req(),response(),handler)).toBe(42);expect(m.verify).not.toHaveBeenCalled();expect(m.db).not.toHaveBeenCalled();expect(m.acquire).not.toHaveBeenCalled();});
it('strict-free keeps its existing route without new admission',async()=>{m.strict.mockReturnValue(true);const handler=vi.fn(async()=>42);await withFreeChainEntryAdmission(req(),response(),handler);expect(handler).toHaveBeenCalledOnce();expect(m.verify).not.toHaveBeenCalled();});
it.each([{message:'hello',fileAttachments:[{type:'image/png'}]},{message:'x'.repeat(100001)},{message:''},{message:5},{}])('leaves attachment and invalid input paths unchanged',async body=>{const handler=vi.fn(async()=>42);await withFreeChainEntryAdmission(req(body),response(),handler);expect(handler).toHaveBeenCalledOnce();expect(m.verify).not.toHaveBeenCalled();});
it('anonymous requests cannot use a body UID to acquire authenticated capacity',async()=>{m.verify.mockResolvedValue(null);const handler=vi.fn(async()=>42);await withFreeChainEntryAdmission(req({message:'hello',uid:'forged'}),response(),handler);expect(handler).toHaveBeenCalledOnce();expect(m.acquire).not.toHaveBeenCalled();});
it('unselected authenticated requests retain their old handler',async()=>{m.controls.mockResolvedValue({enabled:true,rolloutPercent:0,disabledProviders:[]});const handler=vi.fn(async()=>42);await withFreeChainEntryAdmission(req(),response(),handler);expect(handler).toHaveBeenCalledOnce();expect(m.acquire).not.toHaveBeenCalled();});
it('issues only a live request-bound immutable grant and releases after handler',async()=>{const request=req({message:'hello',entryAdmission:{uid:'server-uid',waitedMs:3}});let captured:unknown;const handler=vi.fn(async()=>{captured=entryAdmissionFor(request);expect(isEntryAdmission(captured,'server-uid')).toBe(true);expect(isEntryAdmission(captured,'other')).toBe(false);expect(Object.isFrozen(captured)).toBe(true);return 42;});await withFreeChainEntryAdmission(request,response(),handler);expect(isEntryAdmission(captured,'server-uid')).toBe(false);expect(entryAdmissionFor(request)).toBeUndefined();expect(m.release).toHaveBeenCalledOnce();expect(isEntryAdmission(request.body.entryAdmission,'server-uid')).toBe(false);});
it('cleans up a thrown handler and never releases another request grant',async()=>{const request=req(),res=response();let grant:unknown;await expect(withFreeChainEntryAdmission(request,res,async()=>{grant=entryAdmissionFor(request);throw new Error('handler failed');})).rejects.toThrow('handler failed');expect(m.release).toHaveBeenCalledOnce();expect(isEntryAdmission(grant,'server-uid')).toBe(false);expect(res.listenerCount('close')).toBe(0);});
it('request context reuses only the wrapper verified identity, not body uid',async()=>{const request=req({message:'hello',uid:'forged'});await withFreeChainEntryAdmission(request,response(),async()=>{const context=await freeChainRequestContext(request,{tier:'navbharat',message:'hello',history:[],attachments:0,hasProfile:false,hasMemory:false,grounded:false});expect(context?.uid).toBe('server-uid');expect(isEntryAdmission(context?.entryAdmission,'server-uid')).toBe(true);});expect(m.verify).toHaveBeenCalledOnce();});
it.each(['queue-full','timeout','user-limit','capacity'] as const)('returns normal busy JSON for %s without entering handler',async reason=>{m.acquire.mockResolvedValue({admitted:false,reason,waitedMs:9});const res=response(),handler=vi.fn(async()=>42);await withFreeChainEntryAdmission(req(),res,handler);expect(handler).not.toHaveBeenCalled();expect(res.json).toHaveBeenCalledWith({reply:expect.stringContaining('temporarily busy')});expect(m.release).not.toHaveBeenCalled();expect(m.log).toHaveBeenCalledWith(expect.objectContaining({provider:'NONE',costUsdEstimate:null,admissionReason:reason}));});
it('busy streams retain a content chunk and [DONE] instead of blank output',async()=>{m.acquire.mockResolvedValue({admitted:false,reason:'queue-full',waitedMs:0});const res=response();await withFreeChainEntryAdmission(req({message:'hello',stream:true}),res,async()=>42);expect(res.setHeader).toHaveBeenCalledWith('Content-Type','text/event-stream');expect(res.write).toHaveBeenNthCalledWith(1,expect.stringContaining('temporarily busy'));expect(res.write).toHaveBeenNthCalledWith(2,'data: [DONE]\n\n');expect(res.end).toHaveBeenCalledOnce();});
it('disconnect while waiting aborts admission and cleans listener without writing',async()=>{const res=response(),handler=vi.fn(async()=>42);m.acquire.mockImplementation(({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({admitted:false,reason:'aborted',waitedMs:2}))));const promise=withFreeChainEntryAdmission(req(),res,handler);await vi.waitFor(()=>expect(m.acquire).toHaveBeenCalledOnce());res.emit('close');await promise;expect(handler).not.toHaveBeenCalled();expect(res.write).not.toHaveBeenCalled();expect(res.json).not.toHaveBeenCalled();expect(res.listenerCount('close')).toBe(0);});
it('already closed clients do not enter authentication or work',async()=>{const res=response();Object.assign(res,{destroyed:true});await withFreeChainEntryAdmission(req(),res,async()=>42);expect(m.verify).not.toHaveBeenCalled();});
it.each(['store','controls','config'])('enabled scope fails closed on %s failure',async kind=>{if(kind==='store')m.db.mockReturnValue(null);if(kind==='controls')m.controls.mockRejectedValue(new Error('offline'));if(kind==='config')vi.stubEnv('FREE_CHAIN_ORDER','deepseek,groq');const handler=vi.fn(async()=>42),res=response();await withFreeChainEntryAdmission(req(),res,handler);expect(handler).not.toHaveBeenCalled();expect(res.json).toHaveBeenCalledWith({reply:expect.stringContaining('temporarily busy')});});
it('rechecks strict policy after queueing and releases without entering legacy handler',async()=>{m.acquire.mockImplementation(async()=>{m.strict.mockReturnValue(true);return {admitted:true,waitedMs:3,release:m.release};});const handler=vi.fn(async()=>42);await withFreeChainEntryAdmission(req(),response(),handler);expect(handler).not.toHaveBeenCalled();expect(m.release).toHaveBeenCalledOnce();});

it('keeps one unsampled no-provider usage row for every rejected turn',async()=>{m.acquire.mockResolvedValue({admitted:false,reason:'queue-full',waitedMs:9});await Promise.all(Array.from({length:12},()=>withFreeChainEntryAdmission(req({message:'hello',uid:'forged',stream:true}),response(),async()=>42)));expect(m.write).toHaveBeenCalledTimes(12);const row=m.write.mock.calls[0][0];expect(row).toMatchObject({userId:'server-uid',tier:'navbharat',streamed:true,usageMeasured:false,ok:false,failureReason:'queue-full',freeChain:{provider:'NONE',admissionReason:'queue-full'}});expect(row).not.toHaveProperty('inputTokens');expect(row).not.toHaveProperty('outputTokens');expect(row).toMatchObject({providerName:'NONE',modelName:'none'});expect(row).not.toHaveProperty('estimated_provider_cost');});

it.each(['environment-off','control-off','rollout-removed'] as const)('an admitted request cannot escape to legacy after %s during prompt assembly',async change=>{
 const request=req({message:'hello',uid:'forged'}),res=response();
 await withFreeChainEntryAdmission(request,res,async()=>{
  // Simulates awaited prompt/memory assembly after the early queue was admitted.
  await Promise.resolve();
  if(change==='environment-off')vi.stubEnv('FREE_CHAIN_ENABLED','off');
  else m.controls.mockResolvedValue({enabled:change!=='control-off',rolloutPercent:change==='rollout-removed'?0:100,disabledProviders:[]});
  const context=await freeChainRequestContext(request,{tier:'navbharat',message:'hello',history:[],attachments:0,hasProfile:false,hasMemory:false,grounded:false});
  expect(context).toBeDefined();expect(isEntryAdmission(context?.entryAdmission,'server-uid')).toBe(true);
  const onChunk=vi.fn();
  const result=await maybeFreeChain({message:'hello',history:[],context:context!,onChunk});
  expect(result).not.toBeNull();expect(result).toMatchObject({ok:false,provider:'NONE'});
  expect(onChunk).toHaveBeenCalledWith(expect.stringContaining('temporarily busy'), 'notice');
 });
 expect(m.acquire).toHaveBeenCalledOnce();expect(m.release).toHaveBeenCalledOnce();
});
it('a late strict-free switch still selects the existing strict verified path, not the new paid chain',async()=>{
 const request=req();
 await withFreeChainEntryAdmission(request,response(),async()=>{
  m.strict.mockReturnValue(true);
  const context=await freeChainRequestContext(request,{tier:'navbharat',message:'hello',history:[],attachments:0,hasProfile:false,hasMemory:false,grounded:false});
  expect(isEntryAdmission(context?.entryAdmission,'server-uid')).toBe(true);
  expect(await maybeFreeChain({message:'hello',history:[],context:context!})).toBeNull();
 });
 expect(m.release).toHaveBeenCalledOnce();
});
it('an unissued grant cannot change flag-OFF legacy selection',async()=>{
 vi.stubEnv('FREE_CHAIN_ENABLED','off');
 const forged={uid:'server-uid',waitedMs:0,signal:new AbortController().signal};
 expect(await maybeFreeChain({message:'hello',history:[],context:{uid:'server-uid',conversationKey:'hash',privateTurn:false,healthTurn:false,cacheEligible:false,entryAdmission:forged}})).toBeNull();
});
it('disconnect during admitted prompt assembly returns aborted without legacy or emitted output',async()=>{
 const request=req(),res=response();
 await withFreeChainEntryAdmission(request,res,async()=>{
  res.emit('close');
  const context=await freeChainRequestContext(request,{tier:'navbharat',message:'hello',history:[],attachments:0,hasProfile:false,hasMemory:false,grounded:false});
  const onChunk=vi.fn();
  expect(await maybeFreeChain({message:'hello',history:[],context:context!,onChunk})).toMatchObject({ok:false,reason:'aborted',content:''});
  expect(onChunk).not.toHaveBeenCalled();expect(m.providerSlot).not.toHaveBeenCalled();
 });
 expect(m.release).toHaveBeenCalledOnce();expect(res.listenerCount('close')).toBe(0);
});

it('samples early rejections into the shared ring but never samples per-turn usage rows',async()=>{
 m.acquire.mockResolvedValue({admitted:false,reason:'queue-full',waitedMs:1});
 m.uuid.mockReturnValueOnce('00000000-0000-0000-0000-000000000040').mockReturnValueOnce('00000000-0000-0000-0000-000000000041');
 await withFreeChainEntryAdmission(req(),response(),async()=>42);
 await withFreeChainEntryAdmission(req(),response(),async()=>42);
 expect(m.eventSet).toHaveBeenCalledOnce();expect(m.eventSet).toHaveBeenCalledWith(expect.objectContaining({admissionReason:'queue-full',samplingProbability:1/64,ok:false}));
 expect(m.write).toHaveBeenCalledTimes(2);
});
