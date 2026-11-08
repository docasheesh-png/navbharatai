import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Request } from 'express';
vi.mock('../../lib/authMiddleware',()=>({verifyFirebaseToken:async()=> 'verified-user'}));
vi.mock('../../lib/serverDb',()=>({getServerDb:()=>null}));
vi.mock('../../lib/aiMaintenance',()=>({assertAiAvailable:async()=>{}}));
import { freeChainAdmissionQueue, MAX_QUEUED_PAYLOAD_BYTES } from '../FreeChain/admissionQueue';
import { runWithAuthenticatedInferenceGatewayRequest, runWithInferenceGatewayContext, runWithInferenceGatewayEntryAdmission, maybeGatewayText } from './runtime';
const releases:Array<()=>void>=[];
beforeEach(async()=>{
 vi.stubEnv('INFERENCE_GATEWAY_ENABLED','on');vi.stubEnv('INFERENCE_GATEWAY_ROLLOUT_MODE','all');vi.stubEnv('INFERENCE_GATEWAY_SURFACES','chat');
 for(let i=0;i<8;i++){const lease=await freeChainAdmissionQueue.acquire({uid:`holder-${i}`});expect(lease.admitted).toBe(true);if(lease.admitted)releases.push(lease.release);}
});
afterEach(()=>{for(const release of releases.splice(0))release();vi.unstubAllEnvs();expect(freeChainAdmissionQueue.snapshot()).toMatchObject({active:0,queued:0});});
function trusted<T>(body:unknown,fn:()=>Promise<T>){return runWithAuthenticatedInferenceGatewayRequest({body} as Request,()=>runWithInferenceGatewayContext({principalId:'verified-user',tenantId:'verified-user',surface:'chat',policyKey:'chat:text',qualityTier:'standard',dataClass:'public',funding:'platform-free-fallback',mode:'free-first-authorized-paid',deadlineAtMs:Date.now()+90000},fn));}
it('refuses oversized retained ingress before prompt assembly',async()=>{
 const handler=vi.fn(async()=>undefined);
 await expect(trusted({message:'x'.repeat(MAX_QUEUED_PAYLOAD_BYTES)},()=>runWithInferenceGatewayEntryAdmission(handler))).rejects.toMatchObject({reason:'admission-capacity'});
 expect(handler).not.toHaveBeenCalled();expect(freeChainAdmissionQueue.snapshot().queued).toBe(0);
});
it('refuses oversized direct invocation including its system prompt',async()=>{
 await expect(trusted({},()=>maybeGatewayText({prompt:'question',systemPrompt:'x'.repeat(MAX_QUEUED_PAYLOAD_BYTES)}))).rejects.toMatchObject({reason:'admission-capacity'});
 expect(freeChainAdmissionQueue.snapshot().queued).toBe(0);
});
it.each(['ingress','direct'] as const)('shares the aggregate byte budget with other queued work: %s',async path=>{
 const abort=new AbortController();const waiting=freeChainAdmissionQueue.acquire({uid:'other-waiter',signal:abort.signal,payloadBytes:9*1024*1024});
 const content='x'.repeat(8*1024*1024);
 try {
  const run=path==='ingress'?trusted({message:content},()=>runWithInferenceGatewayEntryAdmission(async()=>undefined)):trusted({},()=>maybeGatewayText({prompt:content}));
  await expect(run).rejects.toMatchObject({reason:'admission-capacity'});expect(freeChainAdmissionQueue.snapshot().queued).toBe(1);
 } finally {abort.abort();await waiting;}
 expect(freeChainAdmissionQueue.snapshot().queued).toBe(0);
});
