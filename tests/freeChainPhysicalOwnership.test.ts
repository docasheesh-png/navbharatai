/** Offline regression: watchdog completion never releases a still-running physical attempt. */
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
import { getProviderStats } from '../src/server/AI/Router/AIRouter';
import { rungInFlight } from '../src/server/AI/FreeChain/masterPlan';
vi.mock('../src/server/AI/InferenceGateway/runtime', () => ({ maybeGatewayText: async () => null }));
vi.mock('../src/server/AI/LiveRegistry/runtime', () => ({ strictFreeText: vi.fn() }));
vi.mock('../src/server/AI/FreeChain/telemetry', () => ({ logFreeChain: vi.fn() }));
import { buildFreeChainRouter, type FreeChainInput } from '../src/server/AI/FreeChain/runtime';
import { freeChainConfig } from '../src/server/AI/FreeChain/config';
import { getBreaker, resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
m.observeBudget.mockImplementation(async (cap: number) => ({ capNanoUsd: cap, revision: 1 }));
const db = {} as Parameters<typeof buildFreeChainRouter>[0];
function config(order = 'groq,cloudflare,deepseek') {
 return freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: order,
 FREE_CHAIN_GLM_API_KEY: 'single-fake-key', FREE_CHAIN_GLM_FREE_VERIFIED_UNTIL: '2099-01-01', FREE_CHAIN_GROQ_API_KEY: 'fake-local-key', FREE_CHAIN_CF_API_TOKEN: 'fake-local-key', FREE_CHAIN_DEEPSEEK_API_KEY: 'fake-local-key',
 FREE_CHAIN_GROQ_FREE_VERIFIED_UNTIL: '2099-01-01', FREE_CHAIN_CF_FREE_VERIFIED_UNTIL: '2099-01-01', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off', FREE_CHAIN_OUTPUT_CAP_ENABLED: 'off' });
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
 m.spend.mockResolvedValue({ available: true, capNanoUsd: 2e9, policyRevision: 3, heldNanoUsd: 0, spentNanoUsd: 0 });
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const flush = async () => { for (let i=0;i<120;i++) await Promise.resolve(); };
describe('FreeChain physical ownership', () => {
 it.each([{ id: 'groq', account: 'groq', cap: 8 }, { id: 'glm45', account: 'glm', cap: 2 }] as const)('$id timeout retains original physical slots and prevents excess dispatch', async ({id,account,cap}) => {
  vi.useFakeTimers();
  const pending: Array<() => void> = [];
  let active=0; let peak=0;
  m.execute.mockImplementation((arg: any, cfg: any) => {
    active++; peak=Math.max(peak,active);
    return new Promise(resolve => pending.push(() => { active--; resolve({content:'late synthetic',provider:cfg.provider,model:cfg.model,latencyMs:1,completeUsage:false,rateLimitHeaders:{}}); }));
  });
  const cfg=config(id);
  const router=buildFreeChainRouter(db,cfg);
  const first=Array.from({length:cap},(_,i)=>router.route({...input(),context:{...input().context,uid:`synthetic-owner-${i}`}}));
  let ninth: Promise<any>|undefined;
  try {
   await flush();
   expect(active).toBe(cap);
   expect(getProviderStats()[account].inFlightByUniverse['free-chat-chain']).toBe(cap);
   await vi.advanceTimersByTimeAsync(cfg.ttftMs+1000); await Promise.all(first);
   expect(m.execute.mock.calls.every(([arg])=>arg.signal.aborted)).toBe(true);
   expect(active).toBe(cap);
   expect.soft(getProviderStats()[account].inFlightByUniverse['free-chat-chain'], 'observer timeout must not erase pending physical SDK calls').toBe(cap);
   if(id==='glm45') expect.soft(rungInFlight(id), 'configured rung ownership also survives timeout').toBe(cap);
   // Allow the existing cooldown to expire naturally; do not bypass routing policy.
   await vi.advanceTimersByTimeAsync(Math.max(0,getBreaker(`free-chat-chain:${id}`).snapshot().openedUntil-Date.now())+1);
   ninth=router.route({...input(),context:{...input().context,uid:"synthetic-ninth"}}); await flush();
   expect.soft(m.execute.mock.calls.length, 'extra dispatch cannot enter while the physical pool is full').toBe(cap);
   expect.soft(peak,'physical count cannot exceed its unchanged cap').toBe(cap);
  } finally {
   for (const resolve of pending.splice(0)) resolve();
   await flush();
   if(ninth) {
    // Bounded capacity waiting now resumes this turn only after the originals physically settle.
    // Its new SDK call must also settle; watchdog expiry alone must never erase its ownership.
    expect(m.execute).toHaveBeenCalledTimes(cap+1);expect(active).toBe(1);expect(peak).toBe(cap);
    expect(getProviderStats()[account].inFlightByUniverse['free-chat-chain']).toBe(1);
    for (const resolve of pending.splice(0)) resolve();
    await flush();await ninth;
   }
   expect(getProviderStats()[account].inFlightByUniverse['free-chat-chain']).toBe(0);
   if(id==='glm45') expect(rungInFlight(id)).toBe(0);
  }
 });
 it('late rejection releases only its own slot while a successor remains active', async () => {
  vi.useFakeTimers();
  let rejectOld!: (error: Error)=>void;
  let resolveNew!: (result: any)=>void;
  let nextChunk!: (text: string)=>void;
  m.execute.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectOld=reject;}))
    .mockImplementationOnce((arg: any)=>{nextChunk=arg.onChunk;return new Promise(resolve=>{resolveNew=resolve;});});
  const cfg=config('groq'); const router=buildFreeChainRouter(db,cfg);
  const old=router.route({...input(),context:{...input().context,uid:'old-owner'}});
  await flush(); await vi.advanceTimersByTimeAsync(cfg.ttftMs+1000); await old;
  expect(getProviderStats().groq.inFlight).toBe(1);
  await vi.advanceTimersByTimeAsync(Math.max(0,getBreaker('free-chat-chain:groq').snapshot().openedUntil-Date.now())+1);
  const next=router.route({...input(),context:{...input().context,uid:'next-owner'}}); await flush();
  expect(getProviderStats().groq.inFlight).toBe(2);
  rejectOld(new Error('late transport rejection')); await flush();
  expect(getProviderStats().groq.inFlight).toBe(1);
  expect(m.execute.mock.calls[1][0].signal.aborted).toBe(false);
  nextChunk('synthetic answer'); resolveNew({content:'synthetic answer',provider:'GROQ',model:'synthetic',latencyMs:1,completeUsage:false,rateLimitHeaders:{}});
  expect((await next).ok).toBe(true);
  expect(getProviderStats().groq.inFlight).toBe(0); expect(vi.getTimerCount()).toBe(0);
 });
 it('synchronous SDK throw releases both account and configured rung ownership exactly once', async () => {
  vi.useFakeTimers(); m.execute.mockImplementation(()=>{throw new Error('synchronous SDK failure');});
  expect((await buildFreeChainRouter(db,config('glm45')).route(input())).ok).toBe(false);
  expect(m.execute).toHaveBeenCalledOnce(); expect(getProviderStats().glm.inFlight).toBe(0);
  expect(rungInFlight('glm45')).toBe(0); expect(vi.getTimerCount()).toBe(0);
 });
 it('pre-dispatch quota refusal returns acquired capacity without entering the SDK', async () => {
  m.reserve.mockResolvedValue({allowed:false,reason:'quota'});
  expect((await buildFreeChainRouter(db,config('glm45')).route(input())).ok).toBe(false);
  expect(m.execute).not.toHaveBeenCalled(); expect(getProviderStats().glm.inFlight).toBe(0); expect(rungInFlight('glm45')).toBe(0);
 });
 it('partial idle timeout does not start another rung or release the still-pending original', async () => {
  vi.useFakeTimers(); let reject!: (error:Error)=>void;
  m.execute.mockImplementation((arg:any)=>{arg.onChunk('synthetic partial');return new Promise((_resolve,r)=>{reject=r;});});
  const result=buildFreeChainRouter(db,config('groq,cloudflare')).route({...input(),onChunk:()=>{}});
  await flush(); await vi.advanceTimersByTimeAsync(31_000);
  expect((await result).reason).toBe('stalled'); expect(m.execute).toHaveBeenCalledOnce(); expect(getProviderStats().groq.inFlight).toBe(1);
  reject(new Error('late cancelled transport')); await flush();
  expect(getProviderStats().groq.inFlight).toBe(0); expect(vi.getTimerCount()).toBe(0);
 });

});
