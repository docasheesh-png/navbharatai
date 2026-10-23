import { describe, expect, it, vi } from 'vitest';
import { runWithFreeAnswerContext, assertFreeAnswerDispatch, currentFreeAnswerSignal } from './freeAnswerQuotaContext';
import { assertNoUnclaimedGatewayDispatch } from '../AI/InferenceGateway/dispatchBoundary';
import { AIRouter } from '../AI/Router/AIRouter';
function provider(name: string, execute: ReturnType<typeof vi.fn>, lastResort=false) { return {name,priority:lastResort ? 9:1,lastResort,healthCheck:async()=>true,execute} as any; }
describe('Free logical turn dispatch fencing',()=>{
 it('preserves context across asynchronous continuations and is absent outside it',async()=>{
 const controller=new AbortController(); const guard=()=>controller.signal.throwIfAborted();
 await runWithFreeAnswerContext({signal:controller.signal,assertActive:guard},async()=>{await Promise.resolve();expect(currentFreeAnswerSignal()).toBe(controller.signal);controller.abort();expect(()=>assertNoUnclaimedGatewayDispatch('embedding')).toThrow();});
 expect(currentFreeAnswerSignal()).toBeUndefined();expect(()=>assertFreeAnswerDispatch()).not.toThrow();
 });
 it.each(['route','routeRaced'] as const)('fences legacy %s fallback after first provider outlives owner',async(method)=>{
 const controller=new AbortController();let live=true;const first=vi.fn(async()=>{live=false;throw new Error('provider failed after expiry');});const next=vi.fn(async()=>({content:'must never run',provider:'NEXT',model:'test',latencyMs:1}));
 const router=new AIRouter('free');router.registerProvider(provider(`FIRST-${method}`,first));router.registerProvider(provider(`NEXT-${method}`,next,true));
 await runWithFreeAnswerContext({signal:controller.signal,assertActive:()=>{if(!live)throw new Error('expired owner');}},async()=>{await router[method]('hello').catch(()=>{});});
 expect(first).toHaveBeenCalledOnce();expect(next).not.toHaveBeenCalled();
 });
});
