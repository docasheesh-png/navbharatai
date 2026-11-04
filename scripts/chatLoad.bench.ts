/** Offline burst experiment: real routing/admission, synthetic provider latency and mocked persistence. */
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ observeBudget: vi.fn(), setBudget: vi.fn(), execute: vi.fn(), registry: vi.fn(), reserve: vi.fn(), paid: vi.fn(), settle: vi.fn(), cooldown: vi.fn(), clearCooldown: vi.fn(), controls: vi.fn(), db: vi.fn(), strict: vi.fn(), maintenance: vi.fn(), set: vi.fn(), get: vi.fn(), quota: vi.fn(), spend: vi.fn(), cacheGet: vi.fn(), cachePut: vi.fn(), events: vi.fn(), where: vi.fn(), select: vi.fn(), limit: vi.fn() }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: m.db }));
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: m.maintenance }));
vi.mock('../src/server/AI/inferencePolicy', () => ({ strictFreeRequired: m.strict }));
vi.mock('../src/server/AI/FreeChain/control', () => ({ readControls: m.controls, readControlsForSelection: m.controls, writeControls: vi.fn(), controlRef: () => ({ collection: () => ({ doc: () => ({ set: m.set, get: m.get }), where: m.where, select: m.select, limit: m.limit, get: m.events }) }) }));
vi.mock('../src/server/AI/FreeChain/cache', async original => ({ ...(await original<typeof import('../src/server/AI/FreeChain/cache')>()), FreeChainCache: class { get=m.cacheGet; put=m.cachePut; } }));
vi.mock('../src/server/AI/FreeChain/store', () => ({ FreeChainStore: class { observePaidBudgetPolicy = m.observeBudget; setPaidBudgetPolicy = m.setBudget; reserveQuota = m.reserve; reservePaid = m.paid; settlePaid = m.settle; cooldown = m.cooldown; clearCooldown = m.clearCooldown; quotaSnapshot = m.quota; spendSnapshot = m.spend; } }));
vi.mock('../src/server/AI/FreeChain/providers/openAiCompatProvider', async original => ({
 ...await original<typeof import('../src/server/AI/FreeChain/providers/openAiCompatProvider')>(),
 OpenAiCompatProvider: class { constructor(readonly config: unknown) {} executeTurn(input: unknown) { return m.execute(input, this.config); } },
}));
vi.mock('../src/server/AI/FreeChain/providers/openRouterRegistryRung', () => ({ runRegistryRung: m.registry }));
vi.mock('../src/server/AI/InferenceGateway/runtime', () => ({ maybeGatewayText: async () => null }));
vi.mock('../src/server/AI/LiveRegistry/runtime', () => ({ strictFreeText: vi.fn() }));
vi.mock('../src/server/AI/FreeChain/telemetry', () => ({ logFreeChain: vi.fn() }));
import { buildFreeChainRouter, type FreeChainInput } from '../src/server/AI/FreeChain/runtime';
import { freeChainConfig } from '../src/server/AI/FreeChain/config';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
m.observeBudget.mockImplementation(async (cap: number) => ({ capNanoUsd: cap, revision: 1 }));
const db = {} as Parameters<typeof buildFreeChainRouter>[0];
function config(order = 'groq,cloudflare,deepseek') {
 return freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_CACHE_ENABLED: 'off', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: order,
 FREE_CHAIN_GLM_API_KEY: 'single-fake-key', FREE_CHAIN_GLM_FREE_VERIFIED_UNTIL: '2099-01-01', FREE_CHAIN_GROQ_API_KEY: 'fake-local-key', FREE_CHAIN_CF_API_TOKEN: 'fake-local-key', FREE_CHAIN_DEEPSEEK_API_KEY: 'fake-local-key',
 FREE_CHAIN_GROQ_FREE_VERIFIED_UNTIL: '2099-01-01', FREE_CHAIN_CF_FREE_VERIFIED_UNTIL: '2099-01-01', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) });
}
const input = (): FreeChainInput => ({ message: 'hello', history: [], context: { uid: 'owner', conversationKey: 'hash', privateTurn: false, healthTurn: false, cacheEligible: false } });
function successful(content = 'answer') { return async (arg: { onChunk: (s: string) => void }, cfg: { provider: string; model: string }) => { arg.onChunk(content); return { content, provider: cfg.provider, model: cfg.model, latencyMs: 1, completeUsage: true, usage: { inputTokens: 10, outputTokens: 2 }, rateLimitHeaders: {} }; }; }
beforeEach(() => {
 vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK PROHIBITED'); }));
 vi.clearAllMocks(); m.where.mockReturnThis(); m.select.mockReturnThis(); m.limit.mockReturnThis(); m.events.mockResolvedValue({ docs: [] }); resetAllBreakers(); m.cacheGet.mockResolvedValue(null); m.cachePut.mockResolvedValue(undefined);
 m.paid.mockReset(); m.settle.mockReset(); m.observeBudget.mockImplementation(async (cap: number) => ({ capNanoUsd: cap, revision: 1 }));
 m.controls.mockResolvedValue({ enabled: true, rolloutPercent: 100, disabledProviders: [] });
 m.reserve.mockResolvedValue({ allowed: true }); m.set.mockResolvedValue(undefined); m.get.mockResolvedValue({ data: () => undefined });
 m.cooldown.mockResolvedValue(true); m.clearCooldown.mockResolvedValue(true); m.strict.mockReturnValue(false); m.db.mockReturnValue(db); m.maintenance.mockResolvedValue(undefined);
 m.execute.mockImplementation(successful());
 m.quota.mockResolvedValue({ available: true, usage: { rpm: 1, rpd: 2, tpm: 3, tpd: 4, neuronsPerDay: 5 }, dailyResetAt: Date.now()+1000, minuteResetAt: Date.now()+1000, cooldownUntil: 0 });
 m.spend.mockResolvedValue({ available: true, capNanoUsd: 2e9, policyRevision: 3, heldNanoUsd: 0, spentNanoUsd: 0});
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });


import { writeFileSync } from 'node:fs';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { applySwitchedOff, __resetProviderSwitchesForTests, switchedOffProviderFor } from '../src/server/lib/providerSwitches';
import { FreeChainProviderError } from '../src/server/AI/FreeChain/providers/openAiCompatProvider';
import { freeChainAdmissionQueue } from '../src/server/AI/FreeChain/admissionQueue';
const reports: any[] = [];
const pct = (xs: number[], n: number) => xs.length ? [...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*n/100)-1)] : null;
const bump = (o: Record<string,number>, k: string) => { o[k]=(o[k]??0)+1; };
const cases: Array<{name:string;vus:number;n:number;users?:number;turnsPerUser?:number;overlap?:boolean;legacy?:boolean;largePayload?:boolean;delayMs?:number;failGlm?:boolean;quotaRefusal?:boolean;sameUser?:boolean;googleOnly?:boolean}> = [
 {name:'users-1000-four-turns',vus:1000,n:4000,users:1000,turnsPerUser:4},
 {name:'users-1000-four-overlap',vus:4000,n:4000,users:1000,turnsPerUser:4,overlap:true},
 {name:'users-1000-four-turns-slow',vus:1000,n:4000,users:1000,turnsPerUser:4,delayMs:1000},
 {name:'users-1000-four-overlap-slow',vus:4000,n:4000,users:1000,turnsPerUser:4,overlap:true,delayMs:1000},
 {name:'baseline-1024',vus:1024,n:1024,legacy:true},
 {name:'burst-1024',vus:1024,n:1024},
 {name:'overload-2048',vus:2048,n:2048},
 {name:'glm-failure-1024',vus:1024,n:1024,failGlm:true},
 {name:'slow-provider-1024',vus:1024,n:1024,delayMs:1000},
 {name:'large-payload-1024',vus:1024,n:1024,largePayload:true},
 {name:'quota-refusal-1024',vus:1024,n:1024,quotaRefusal:true},
 {name:'same-user-1024',vus:1024,n:1024,sameUser:true},
 {name:'disabled-google-1024',vus:1024,n:1024,googleOnly:true},
];
describe('bounded offline real FreeChain runtime load experiment', () => {
 for (const scenario of cases) it(scenario.name, async () => {
  __resetProviderSwitchesForTests({});
  applySwitchedOff(['gemini','vertex'], {});
  // Explicit synthetic credentials, no process.env credentials, no real paid/store access.
  const cfg=config(); cfg.order=freeChainConfig({}).order; if(scenario.legacy)cfg.queue.maxQueued=64;
  if(scenario.googleOnly) {
   for(const r of cfg.rungs) if(r.id==='geminipaid') {r.reason=undefined;r.configured=true;r.key='synthetic-only';}
   applySwitchedOff(['gemini','vertex','glm','groq','cloudflare'], {});
  }
  expect(cfg.errors).toEqual([]);
  m.paid.mockResolvedValue({mayDispatch:false});
  if(scenario.quotaRefusal) m.reserve.mockResolvedValue({allowed:false,reason:'rpm'});
  let physical=0, peak=0, sequence=0;
  const current:Record<string,number>={}, peakByModel:Record<string,number>={}, dispatch:Record<string,number>={};
  m.execute.mockImplementation(async (arg:any, adapter:any) => {
   const model=adapter.model; bump(dispatch,model); bump(current,model);
   peakByModel[model]=Math.max(peakByModel[model]??0,current[model]); peak=Math.max(peak,++physical);
   try {
    await new Promise(resolve=>setTimeout(resolve,scenario.delayMs??25));
    if(scenario.failGlm && adapter.provider==='GLM') throw new FreeChainProviderError('SERVER',{status:503});
    const marker=[...String(arg.prompt).matchAll(/LOAD_REQUEST_\d+/g)].at(-1)?.[0]??'missing-id';
    const content=`Synthetic response ${marker}`;arg.onChunk?.(content);
    return {content,provider:adapter.provider,model,latencyMs:25,completeUsage:true,usage:{inputTokens:10,outputTokens:5},rateLimitHeaders:{}};
   } finally {physical--;current[model]--;}
  });
  const router=buildFreeChainRouter(db,cfg);
  const latency:number[]=[], successfulLatency:number[]=[], ttft:number[]=[], wait:number[]=[];
  const reasons:Record<string,number>={}, skipReasons:Record<string,number>={}, models:Record<string,number>={};
  let ok=0, thrown=0, cacheHits=0, fallbackTurns=0, capacitySkipTurns=0, orderViolations=0, googleEntries=0, maxEntered=0;
  const userOutcomes=new Map<string,{ok:number;failed:number;started:number;ended:number}>();let logicalActive=0,peakLogical=0;
  const initialMemory=process.memoryUsage();let peakRss=initialMemory.rss,peakHeap=initialMemory.heapUsed;
  const sampleMemory=()=>{const v=process.memoryUsage();peakRss=Math.max(peakRss,v.rss);peakHeap=Math.max(peakHeap,v.heapUsed);};
  const memoryTimer=setInterval(sampleMemory,10);const eventLoop=monitorEventLoopDelay({resolution:10});eventLoop.enable();
  const initialCpu=process.cpuUsage();const started=performance.now();
  await Promise.all(Array.from({length:scenario.vus}, async (_,worker)=>{
   let turns=0;const history:Array<{role:string;content:string}>=[];
   while(sequence<scenario.n && (!scenario.users || turns<(scenario.overlap?1:scenario.turnsPerUser!))) {
    turns++;const index=sequence++, t=performance.now(); let first=true;
    const uid=scenario.sameUser?'one-synthetic-user':scenario.users?`synthetic-user-${scenario.overlap?Math.floor(worker/scenario.turnsPerUser!):worker}`:`synthetic-${index}`;
    const user=userOutcomes.get(uid)??{ok:0,failed:0,started:t,ended:t};userOutcomes.set(uid,user);
    const message=`${index%2?'Explain photosynthesis for class 8.':'hello'} LOAD_REQUEST_${index}`;
    peakLogical=Math.max(peakLogical,++logicalActive);
    try {
     const result=await router.route({...input(),...(scenario.largePayload?{systemPrompt:'synthetic-context '.repeat(8192)}:{}),message,history,
      context:{...input().context,uid,conversationKey:uid},
      onChunk:(_text:string,kind?:string)=>{if(first&&kind!=='notice'){ttft.push(performance.now()-t);first=false;}}});
     const elapsed=performance.now()-t;latency.push(elapsed);
     if(result.ok){expect(result.content).toBe(`Synthetic response LOAD_REQUEST_${index}`);ok++;user.ok++;successfulLatency.push(elapsed);bump(models,result.model);history.push({role:'user',content:message},{role:'assistant',content:result.content});}else {user.failed++;bump(reasons,result.freeChain?.admissionReason??result.reason??'unknown');}
     const trace=result.freeChain;if(trace?.cacheHit)cacheHits++;
     wait.push(trace?.queueWaitMs??0);
     if((trace?.fallbacks??0)>0)fallbackTurns++;
     const attempts=trace?.attempts??[]; if(scenario.googleOnly)expect(attempts.find((a:any)=>a.provider==='geminipaid')?.reason).toBe('disabled');
     if(attempts.some((a:any)=>['capacity','concurrency'].includes(a.reason)))capacitySkipTurns++;
     let last=-1;
     for(const a of attempts){const rank=cfg.order.indexOf(a.provider as any);if(rank<last)orderViolations++;last=rank;if(!a.entered)bump(skipReasons,a.reason);if(a.entered&&a.provider==='geminipaid')googleEntries++;}
     maxEntered=Math.max(maxEntered,attempts.filter((a:any)=>a.entered).length);
    }catch(e){thrown++;user.failed++;latency.push(performance.now()-t);bump(reasons,String(e));}finally{logicalActive--;user.ended=performance.now();}
   }
  }));
  const durationMs=performance.now()-started;sampleMemory();clearInterval(memoryTimer);eventLoop.disable();const cpu=process.cpuUsage(initialCpu);
  const perUserDistribution:Record<string,number>={};for(const user of userOutcomes.values())bump(perUserDistribution,`ok=${user.ok},failed=${user.failed}`);
  const userDurations=[...userOutcomes.values()].map(u=>u.ended-u.started);
  const usersAllQuestionsAnswered=[...userOutcomes.values()].filter(u=>u.ok===(scenario.turnsPerUser??1)&&u.failed===0).length;
  const report={distinctUsers:userOutcomes.size,usersAllQuestionsAnswered,perUserDistribution,perUserDurationMs:{p95:pct(userDurations,95),p99:pct(userDurations,99)},peakLogical,logicalActiveAfter:logicalActive,cacheEnabled:cfg.cacheEnabled,cacheEligible:false,cacheHits,cacheLookupCalls:m.cacheGet.mock.calls.length,cacheMisses:m.cacheGet.mock.calls.length-cacheHits,providerDispatches:Object.values(dispatch).reduce((a,b)=>a+b,0),resource:{initialMemory,peakRss,peakHeap,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,eventLoopP99Ms:eventLoop.count ? eventLoop.percentile(99)/1e6 : null},name:scenario.name,providerDelayMs:scenario.delayMs??25,workers:scenario.vus,requests:scenario.n,durationMs,ok,notOk:scenario.n-ok,thrown,completedRps:scenario.n*1000/durationMs,successfulRps:ok*1000/durationMs,
   allLatencyMs:{p50:pct(latency,50),p95:pct(latency,95),p99:pct(latency,99),max:Math.max(...latency)},successP95Ms:pct(successfulLatency,95),successP99Ms:pct(successfulLatency,99),ttftP95Ms:pct(ttft,95),queueP95Ms:pct(wait,95),
   peakPhysical:peak,peakByModel,dispatch,models,reasons,skipReasons,fallbackTurns,capacitySkipTurns,orderViolations,googleEntries,maxEntered,queueAfter:freeChainAdmissionQueue.snapshot()};
  reports.push(report);writeFileSync(process.env.CHAT_LOAD_REPORT ?? '/tmp/navbharatai-chat-burst.json',JSON.stringify({codeCommit:process.env.CHAT_LOAD_COMMIT??'working-tree',providerDelayMs:25,scope:'real router and admission/concurrency/breakers; mocked provider, quota/spend store, controls/cache/telemetry; no HTTP/auth/real DB',reports},null,2));
  console.log('LOAD_RESULT',JSON.stringify(report));
  expect(logicalActive).toBe(0);if(scenario.users)expect(userOutcomes.size).toBe(scenario.users);expect(cfg.cacheEnabled).toBe(false);expect(cacheHits).toBe(0);expect(m.cacheGet).not.toHaveBeenCalled();expect(thrown).toBe(0);expect(orderViolations).toBe(0);expect(googleEntries).toBe(0);expect(physical).toBe(0);expect(maxEntered).toBeLessThanOrEqual(4);expect(peak).toBeLessThanOrEqual(8);
  expect(peakByModel['glm-4.5-flash']??0).toBeLessThanOrEqual(2);expect(peakByModel['glm-4.7-flash']??0).toBeLessThanOrEqual(1);
  expect(switchedOffProviderFor('generativelanguage.googleapis.com','/v1beta')).toBe('gemini');
  expect(switchedOffProviderFor('us-central1-aiplatform.googleapis.com','/v1')).toBe('vertex');
  if(scenario.googleOnly)expect(skipReasons.disabled).toBeGreaterThanOrEqual(scenario.n);
  if(scenario.name==='slow-provider-1024'){expect(reasons.timeout).toBeGreaterThan(0);expect(reasons['queue-full']??0).toBe(0);}
  if(scenario.quotaRefusal||scenario.googleOnly){expect(ok).toBe(0);expect(m.execute).not.toHaveBeenCalled();}
  if(scenario.failGlm){expect(ok).toBe(scenario.n);expect(dispatch['openai/gpt-oss-120b']).toBeGreaterThan(0);}
  if(scenario.name==='burst-1024')expect(ok).toBe(scenario.n);
  if(scenario.name==='users-1000-four-turns'){expect(ok).toBe(4000);expect(usersAllQuestionsAnswered).toBe(1000);}
  if(scenario.largePayload)expect(reasons.capacity).toBeGreaterThan(0);
  __resetProviderSwitchesForTests({});
 }, scenario.name==='users-1000-four-turns-slow'?30_000:20_000);
});
