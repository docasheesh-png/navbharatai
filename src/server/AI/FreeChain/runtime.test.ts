import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ observeBudget: vi.fn(), setBudget: vi.fn(), execute: vi.fn(), registry: vi.fn(), reserve: vi.fn(), paid: vi.fn(), settle: vi.fn(), cooldown: vi.fn(), controls: vi.fn(), db: vi.fn(), strict: vi.fn(), maintenance: vi.fn(), set: vi.fn(), get: vi.fn(), quota: vi.fn(), spend: vi.fn(), cacheGet: vi.fn(), cachePut: vi.fn(), events: vi.fn(), where: vi.fn(), select: vi.fn(), limit: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: m.db }));
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: m.maintenance }));
vi.mock('../inferencePolicy', () => ({ strictFreeRequired: m.strict }));
vi.mock('./control', () => ({ readControls: m.controls, readControlsForSelection: m.controls, writeControls: vi.fn(), controlRef: () => ({ collection: () => ({ doc: () => ({ set: m.set, get: m.get }), where: m.where, select: m.select, limit: m.limit, get: m.events }) }) }));
vi.mock('./cache', async original => ({ ...(await original<typeof import('./cache')>()), FreeChainCache: class { get=m.cacheGet; put=m.cachePut; } }));
vi.mock('./store', () => ({ FreeChainStore: class { observePaidBudgetPolicy = m.observeBudget; setPaidBudgetPolicy = m.setBudget; reserveQuota = m.reserve; reservePaid = m.paid; settlePaid = m.settle; cooldown = m.cooldown; quotaSnapshot = m.quota; spendSnapshot = m.spend; } }));
vi.mock('./providers/openAiCompatProvider', () => ({
 OpenAiCompatProvider: class { constructor(readonly config: unknown) {} executeTurn(input: unknown) { return m.execute(input, this.config); } },
 FreeChainProviderError: class extends Error { constructor(readonly code: string, readonly retryAfterMs?: number) { super(code); } },
}));
vi.mock('./providers/openRouterRegistryRung', () => ({ runRegistryRung: m.registry }));
vi.mock('../Router/AIRouter', () => ({ acquireSlot: () => true, releaseSlot: vi.fn(), recordProviderLatency: vi.fn() }));
vi.mock('./telemetry', () => ({ logFreeChain: vi.fn() }));
import { buildFreeChainRouter, maybeFreeChain, freeChainAdminView, freeChainAdminMetrics, controlFreeChainBudget, durationMs, shouldPersistFreeChainEvent, type FreeChainInput } from './runtime';
import { FreeRoutingError } from '../LiveRegistry/dispatcher';
import { freeChainConfig } from './config';
import { resetAllBreakers } from '../Router/CircuitBreaker';
import { FreeChainProviderError } from './providers/openAiCompatProvider';
import { isFreeChainAdminView, isFreeChainAdminMetrics } from '../../../lib/freeChatChainView';
m.observeBudget.mockImplementation(async (cap: number) => ({ capNanoUsd: cap, revision: 1 }));
const db = {} as Parameters<typeof buildFreeChainRouter>[0];
function config(order = 'groq,cloudflare,deepseek') {
 return freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: order,
 FREE_CHAIN_GLM_API_KEY: 'single-fake-key', FREE_CHAIN_GLM_FREE_VERIFIED_UNTIL: '2099-01-01', FREE_CHAIN_GROQ_API_KEY: 'fake-local-key', FREE_CHAIN_CF_API_TOKEN: 'fake-local-key', FREE_CHAIN_DEEPSEEK_API_KEY: 'fake-local-key',
 FREE_CHAIN_GROQ_FREE_VERIFIED_UNTIL: '2099-01-01', FREE_CHAIN_CF_FREE_VERIFIED_UNTIL: '2099-01-01', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) });
}
const input = (): FreeChainInput => ({ message: 'hello', history: [], context: { uid: 'owner', conversationKey: 'hash', privateTurn: false, healthTurn: false, cacheEligible: false } });
function successful(content = 'answer') { return async (arg: { onChunk: (s: string) => void }, cfg: { provider: string; model: string }) => { arg.onChunk(content); return { content, provider: cfg.provider, model: cfg.model, latencyMs: 1, completeUsage: true, usage: { inputTokens: 10, outputTokens: 2 }, rateLimitHeaders: {} }; }; }
beforeEach(() => {
 vi.clearAllMocks(); m.where.mockReturnThis(); m.select.mockReturnThis(); m.limit.mockReturnThis(); m.events.mockResolvedValue({ docs: [] }); resetAllBreakers(); m.cacheGet.mockResolvedValue(null); m.cachePut.mockResolvedValue(undefined);
 m.paid.mockReset(); m.settle.mockReset(); m.observeBudget.mockImplementation(async (cap: number) => ({ capNanoUsd: cap, revision: 1 }));
 m.controls.mockResolvedValue({ enabled: true, rolloutPercent: 100, disabledProviders: [] });
 m.reserve.mockResolvedValue({ allowed: true }); m.set.mockResolvedValue(undefined); m.get.mockResolvedValue({ data: () => undefined });
 m.cooldown.mockResolvedValue(true); m.strict.mockReturnValue(false); m.db.mockReturnValue(db); m.maintenance.mockResolvedValue(undefined);
 m.execute.mockImplementation(successful());
 m.quota.mockResolvedValue({ available: true, usage: { rpm: 1, rpd: 2, tpm: 3, tpd: 4, neuronsPerDay: 5 }, dailyResetAt: Date.now()+1000, minuteResetAt: Date.now()+1000, cooldownUntil: 0 });
 m.spend.mockResolvedValue({ available: true, capNanoUsd: 2e9, policyRevision: 3, heldNanoUsd: 0, spentNanoUsd: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('free chat chain central dispatch', () => {
 it('serves first healthy rung and exposes no secret in telemetry', async () => {
 const result = await buildFreeChainRouter(db, config()).route(input());
 expect(result.provider).toBe('GROQ'); expect(result.ok).toBe(true); expect(m.execute).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(result.freeChain)).not.toContain('fake-local-key'); expect(m.paid).not.toHaveBeenCalled();
 });
 it('falls through before first text on retryable failure', async () => {
 m.execute.mockRejectedValueOnce(new FreeChainProviderError('RATE_LIMIT')).mockImplementation(successful('second'));
 const chunks: string[]=[]; const result = await buildFreeChainRouter(db, config()).route({ ...input(), onChunk: s=>chunks.push(s) });
 expect(result.provider).toBe('CLOUDFLARE'); expect(chunks).toEqual(['second']); expect(result.freeChain?.fallbacks).toBe(1); expect(m.cooldown).toHaveBeenCalled();
 });
 it('does not switch provider after text was committed', async () => {
 m.execute.mockImplementationOnce(async (arg) => { arg.onChunk('partial'); throw new FreeChainProviderError('NETWORK'); });
 const chunks: string[]=[]; const result = await buildFreeChainRouter(db, config()).route({ ...input(), onChunk:s=>chunks.push(s) });
 expect(m.execute).toHaveBeenCalledTimes(1); expect(result.reason).toBe('stalled'); expect(chunks).toEqual(['partial']);
 });
 it('explains incomplete non-stream responses rather than claiming a full answer', async () => {
 m.execute.mockImplementationOnce(async arg => { arg.onChunk('partial'); throw new FreeChainProviderError('NETWORK'); });
 expect((await buildFreeChainRouter(db, config()).route(input())).content).toContain('interrupted');
 });
 it.each(['SAFETY_REFUSAL','INVALID_REQUEST'])('does not provider-hop on %s', async code => {
 m.execute.mockRejectedValue(new FreeChainProviderError(code)); await buildFreeChainRouter(db, config()).route(input()); expect(m.execute).toHaveBeenCalledTimes(1);
 });
 it('skips exhausted quota without dispatch', async () => {
 m.reserve.mockResolvedValue({ allowed: false, reason: 'quota' });
 const result = await buildFreeChainRouter(db, config()).route(input()); expect(result.ok).toBe(false); expect(m.execute).not.toHaveBeenCalled();
 });
 it('blocks an unverified DeepSeek model without quota, reservation or dispatch', async () => {
 const cfg = config('deepseek'); cfg.rungs.find(r => r.id === 'deepseek')!.model = 'deepseek-v4-pro';
 const result = await buildFreeChainRouter(db, cfg).route(input());
 expect(result.freeChain?.attempts[0].reason).toBe('rate-card-unverified'); expect(m.execute).not.toHaveBeenCalled(); expect(m.paid).not.toHaveBeenCalled();
 expect(m.reserve).not.toHaveBeenCalled();
 });
 it.each([
 ['underpriced input', 0.299999999, 1.2], ['underpriced output', 0.3, 1.199999999],
 ['zero rates', 0, 0], ['over ceiling', 0.95, 4.000000001], ['non-finite input', Number.NaN, 1.2],
 ['non-finite output', 0.3, Number.POSITIVE_INFINITY], ['unrepresentable precision', 0.3000000001, 1.2],
 ] as const)('blocks %s before reserving or dispatching DeepSeek', async (_label, priceIn, priceOut) => {
 const cfg = config('deepseek'); cfg.deepseekPrices.input = priceIn; cfg.deepseekPrices.output = priceOut;
 const result = await buildFreeChainRouter(db, cfg).route(input());
 expect(result.freeChain?.attempts[0].reason).toBe('rate-card-unverified');
 expect(m.reserve).not.toHaveBeenCalled(); expect(m.paid).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
 });
 it('allows a conservative reservation profile exactly at the unchanged ceiling', async () => {
 const cfg = config('deepseek'); cfg.deepseekPrices.input = 0.95; cfg.deepseekPrices.output = 4;
 m.paid.mockResolvedValue(null);
 const result = await buildFreeChainRouter(db, cfg).route(input());
 expect(result.freeChain?.attempts[0].reason).toBe('budget'); expect(m.paid).toHaveBeenCalledOnce();
 expect(m.paid.mock.calls[0][0].maxCostNanoUsd).toBe(1_000_243_200); expect(m.execute).not.toHaveBeenCalled();
 });
 it.each([0, 10])('uses the real shared budget to admit or deny DeepSeek at a $%s cap', async cap => {
 const real = await vi.importActual<typeof import('./store')>('./store'); const docs = new Map<string, unknown>();
 const database = { doc: (path: string) => ({ path }), runTransaction: async (fn: any) => fn({
 get: async (ref: any) => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
 set: (ref: any, value: unknown) => docs.set(ref.path, value),
 }) };
 const store = new real.FreeChainStore(database as any);
 m.observeBudget.mockImplementation(value => store.observePaidBudgetPolicy(value));
 m.paid.mockImplementation(value => store.reservePaid(value));
 m.settle.mockImplementation((reservation, actual) => store.settlePaid(reservation, actual));
 const cfg = config('deepseek'); cfg.paidCapNanoUsd = cap * 1_000_000_000;
 const result = await buildFreeChainRouter(database as any, cfg).route(input());
 expect(m.paid).toHaveBeenCalledWith(expect.objectContaining({ capNanoUsd: cap * 1_000_000_000, maxCostNanoUsd: 315_801_600 }));
 const snapshot = await store.spendSnapshot();
 if (cap === 0) {
 expect(result.ok).toBe(false); expect(result.freeChain?.attempts[0].reason).toBe('budget');
 expect(m.execute).not.toHaveBeenCalled(); expect(m.settle).not.toHaveBeenCalled(); expect(snapshot.spentNanoUsd).toBe(0);
 } else {
 expect(result.ok).toBe(true); expect(result.provider).toBe('DEEPSEEK'); expect(result.model).toBe('deepseek-flash');
 expect(m.execute).toHaveBeenCalledOnce(); expect(m.settle).toHaveBeenCalledWith(expect.objectContaining({ mayDispatch: true }), 5400);
 expect(snapshot.spentNanoUsd).toBe(5400); expect(snapshot.heldNanoUsd).toBe(0);
 }
 });
 it('runtime OFF mid-turn prevents another external call', async () => {
 m.controls.mockResolvedValueOnce({ enabled:true, rolloutPercent:100,disabledProviders:[] }).mockResolvedValue({enabled:false,rolloutPercent:100,disabledProviders:[]});
 m.execute.mockRejectedValueOnce(new FreeChainProviderError('NETWORK'));
 const result = await buildFreeChainRouter(db, config()).route(input()); expect(result.ok).toBe(false); expect(m.execute).toHaveBeenCalledTimes(1);
 });
 it('abort before dispatch makes zero calls and emits no busy text', async () => {
 const controller=new AbortController();controller.abort();const onChunk=vi.fn();
 const result=await buildFreeChainRouter(db,config()).route({...input(),signal:controller.signal,onChunk});expect(result.reason).toBe('aborted');expect(m.execute).not.toHaveBeenCalled();expect(onChunk).not.toHaveBeenCalled();
 });
 it('streams a clear busy response when every rung is unavailable', async () => {
 const cfg=config();cfg.rungs.forEach(r=>{r.reason='unconfigured';});const onChunk=vi.fn();
 const result=await buildFreeChainRouter(db,cfg).route({...input(),onChunk});expect(result.ok).toBe(false);expect(onChunk).toHaveBeenCalledWith(result.content);
 });
 it('defaults OFF and strict-free bypasses the chain', async () => {
 vi.stubEnv('FREE_CHAIN_ENABLED','off');expect(await maybeFreeChain(input())).toBeNull();expect(m.db).not.toHaveBeenCalled();
 vi.stubEnv('FREE_CHAIN_ENABLED','on');m.strict.mockReturnValue(true);expect(await maybeFreeChain(input())).toBeNull();expect(m.execute).not.toHaveBeenCalled();
 });
 it('OpenRouter account admission works with the real quota validator and transaction store', async () => {
 const real = await vi.importActual<typeof import('./store')>('./store');
 const docs=new Map<string,unknown>();
 const database={doc:(path:string)=>({path}),runTransaction:async(fn:any)=>fn({get:async(ref:any)=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),set:(ref:any,value:unknown)=>docs.set(ref.path,value)})};
 const store=new real.FreeChainStore(database as any);
 m.reserve.mockImplementation((value)=>store.reserveQuota(value));
 const cfg=config('openrouter');cfg.openRouterModels=['approved/model:free'];const rung=cfg.rungs.find(r=>r.id==='openrouter')!;rung.reason=undefined;
 m.registry.mockImplementation(async arg=>{arg.onChunk('registry answer');return {content:'registry answer',provider:'OPENROUTER',model:'approved/model:free',latencyMs:1};});
 const result=await buildFreeChainRouter(db,cfg).route(input());
 expect(result.ok).toBe(true);expect(result.model).toBe('approved/model:free');expect(m.registry).toHaveBeenCalledTimes(1);expect(docs.size).toBeGreaterThan(0);
 });
 it.each(['SAFETY_REFUSAL','INVALID_FREE_REQUEST','INVALID_OUTPUT_LIMIT','REQUEST_ABORTED','FREE_BILLING_ANOMALY'])('registry %s is terminal even when reordered first',async code=>{
 const cfg=config('openrouter,groq');cfg.openRouterModels=['approved/model:free'];cfg.rungs.find(r=>r.id==='openrouter')!.reason=undefined;
 m.registry.mockRejectedValue(new FreeRoutingError(code));const result=await buildFreeChainRouter(db,cfg).route(input());expect(result.ok).toBe(false);expect(m.registry).toHaveBeenCalledTimes(1);expect(m.execute).not.toHaveBeenCalled();
 });
 it('invalid enabled configuration fails closed rather than legacy fallback',async()=>{vi.stubEnv('FREE_CHAIN_ENABLED','on');vi.stubEnv('FREE_CHAIN_ORDER','deepseek,groq');const result=await maybeFreeChain(input());expect(result?.ok).toBe(false);expect(m.execute).not.toHaveBeenCalled();});
 it('Gemini refuses non-public prompts even after privacy approval',async()=>{const cfg=config('gemini');const rung=cfg.rungs.find(r=>r.id==='gemini')!;rung.reason=undefined;rung.verifiedUntil=Date.parse('2099-01-01');const result=await buildFreeChainRouter(db,cfg).route(input());expect(result.freeChain?.attempts[0].reason).toBe('privacy-public-corpus-only');expect(m.execute).not.toHaveBeenCalled();});
 it('tries GLM 4.5 after a model-specific 4.7 failure, not a second account',async()=>{
 const cfg=config('glm47,glm45,groq');for(const r of cfg.rungs.filter(r=>r.id.startsWith('glm'))){r.reason=undefined;r.key='single-fake-key';}
 m.execute.mockRejectedValueOnce(new FreeChainProviderError('MODEL_UNAVAILABLE')).mockImplementation(successful());
 const result=await buildFreeChainRouter(db,cfg).route(input());expect(result.model).toBe('glm-4.5-flash');expect(m.execute).toHaveBeenCalledTimes(2);expect(m.cooldown).not.toHaveBeenCalled();
 });
 it('account quota failure skips both GLM models using real shared-store admission',async()=>{
 const real=await vi.importActual<typeof import('./store')>('./store');const docs=new Map<string,unknown>();
 const database={doc:(path:string)=>({path}),runTransaction:async(fn:any)=>fn({get:async(ref:any)=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),set:(ref:any,value:unknown)=>docs.set(ref.path,value)})};
 const store=new real.FreeChainStore(database as any);m.reserve.mockImplementation(v=>store.reserveQuota(v));m.cooldown.mockImplementation((p,t)=>store.cooldown(p,t));
 const cfg=config('glm47,glm45,groq');for(const r of cfg.rungs.filter(r=>r.id.startsWith('glm'))){r.reason=undefined;r.key='single-fake-key';r.rpm=100;r.rpd=1000;r.tpm=100000;r.tpd=1000000;}
 m.execute.mockRejectedValueOnce(new FreeChainProviderError('QUOTA_EXHAUSTED')).mockImplementation(successful());
 const result=await buildFreeChainRouter(db,cfg).route(input());expect(result.provider).toBe('GROQ');expect(m.execute).toHaveBeenCalledTimes(2);expect(m.execute.mock.calls.map(c=>c[1].model)).toEqual(['glm-4.7-flash','openai/gpt-oss-120b']);expect(m.cooldown.mock.calls[0][0]).toBe('glm');
 });
 it('does not replay cached OpenRouter answers after registry model decisions change',async()=>{
 const cfg=config('groq');cfg.cacheEnabled=true;m.cacheGet.mockResolvedValue({content:'obsolete',provider:'OPENROUTER',model:'old/model:free'});
 const result=await buildFreeChainRouter(db,cfg).route({...input(),message:'what is photosynthesis',context:{...input().context,cacheEligible:true}});
 expect(result.provider).toBe('GROQ');expect(result.freeChain?.cacheHit).toBe(false);expect(m.execute).toHaveBeenCalledOnce();
 });
 it('does not confuse two GLM model identities when one cached model is disabled',async()=>{
 const cfg=config('glm47,glm45');cfg.cacheEnabled=true;cfg.rungs.filter(r=>r.id.startsWith('glm')).forEach(r=>{r.reason=undefined;r.key='single-key';});
 m.controls.mockResolvedValue({enabled:true,rolloutPercent:100,disabledProviders:['glm45']});m.cacheGet.mockResolvedValue({content:'old',provider:'GLM',model:'glm-4.5-flash'});
 const result=await buildFreeChainRouter(db,cfg).route({...input(),message:'what is photosynthesis',context:{...input().context,cacheEligible:true}});
 expect(result.model).toBe('glm-4.7-flash');expect(result.freeChain?.cacheHit).toBe(false);
 });
 it('rechecks deployment OFF after waiting without any second physical call',async()=>{
 const cfg=config('groq');cfg.queue.maxActive=1;let enabled=true;let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});
 m.execute.mockImplementationOnce(async(arg,provider)=>{await hold;return successful()(arg,provider);});
 const router=buildFreeChainRouter(db,cfg,()=>({...cfg,enabled}));const first=router.route(input());await vi.waitFor(()=>expect(m.execute).toHaveBeenCalledTimes(1));
 const second=router.route({...input(),context:{...input().context,uid:'second-user'}});enabled=false;release();
 expect((await first).ok).toBe(true);expect((await second).ok).toBe(false);expect(m.execute).toHaveBeenCalledTimes(1);
 });
 it('persists only the declared 1-in-64 detail sample rather than every rejected turn',()=>{
 let count=0;for(let i=0;i<10000;i++)if(shouldPersistFreeChainEvent(`00000000-0000-0000-0000-${i.toString(16).padStart(12,'0')}`))count++;
 expect(count).toBe(157);
 });
 it('admin view agrees with the shared frontend contract', async () => { expect(isFreeChainAdminView(await freeChainAdminView())).toBe(true); });
 it('status never scans event history and reuses the Flash account quota only within each response', async () => {
 const first = await freeChainAdminView();
 expect(first).not.toHaveProperty('metrics'); expect(m.events).not.toHaveBeenCalled(); expect(m.where).not.toHaveBeenCalled();
 expect(m.quota).toHaveBeenCalledTimes(6);
 expect(m.quota.mock.calls.filter(([scope]) => scope.provider === 'glm')).toHaveLength(1);
 expect(first.providers.find(p => p.id === 'glm47')?.usage).toEqual(first.providers.find(p => p.id === 'glm45')?.usage);
 await freeChainAdminView(); expect(m.quota).toHaveBeenCalledTimes(12); expect(m.controls).toHaveBeenCalledTimes(2); expect(m.spend).toHaveBeenCalledTimes(2);
 });
 it('explicit metrics are time-filtered and projected with a hard 4096-document query limit', async () => {
 vi.useFakeTimers(); vi.setSystemTime(100_000_000);
 const docs = [{ at: 99_000_000, rung: 'glm47', latencyMs: 10, fallbacks: 0, cacheHit: false },
 { at: 99_000_100, rung: 'groq', latencyMs: 30, fallbacks: 1, cacheHit: true }, { at: 1, latencyMs: 999 }, { at: 100_000_001, latencyMs: 999 }];
 m.events.mockResolvedValue({ docs: docs.map(data => ({ data: () => data })) });
 const metrics = await freeChainAdminMetrics();
 expect(isFreeChainAdminMetrics(metrics)).toBe(true); expect(metrics).toMatchObject({ observedAt: 100_000_000, scanLimit: 4096, sampleCount: 2, complete: false, fallbackRate: .5, cacheHitRate: .5, p50Ms: 10, shareByProvider: { glm47: .5, groq: .5 } });
 expect(m.where.mock.calls).toEqual([['at', '>', 13_600_000], ['at', '<=', 100_000_000]]);
 expect(m.select).toHaveBeenCalledWith('at', 'rung', 'latencyMs', 'fallbacks', 'cacheHit'); expect(m.limit).toHaveBeenCalledWith(4096); expect(m.events).toHaveBeenCalledOnce();
 expect(m.quota).not.toHaveBeenCalled(); expect(m.controls).not.toHaveBeenCalled(); expect(m.spend).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
 });
 it('an empty observed sample has null rates and no manufactured zero latency', async () => {
 expect(await freeChainAdminMetrics()).toMatchObject({ sampleCount: 0, fallbackRate: null, cacheHitRate: null, p50Ms: null, p95Ms: null, complete: false });
 });
 it('failed metrics reads fail closed without unbounded retry or synthetic success', async () => {
 m.events.mockRejectedValue(new Error('store unavailable'));
 await expect(freeChainAdminMetrics()).rejects.toThrow('store unavailable'); expect(m.events).toHaveBeenCalledOnce();
 m.db.mockReturnValue(null); await expect(freeChainAdminMetrics()).rejects.toThrow('FREE_CHAIN_STORE_UNAVAILABLE'); expect(m.events).toHaveBeenCalledOnce();
 });
 it('storage failure produces a nonblank stream with no external call',async()=>{vi.stubEnv('FREE_CHAIN_ENABLED','on');m.db.mockReturnValue(null);const onChunk=vi.fn();const result=await maybeFreeChain({...input(),onChunk});expect(onChunk).toHaveBeenCalledWith(result?.content);expect(m.execute).not.toHaveBeenCalled();});
 it.each([['2m59.56s',179560],['1h',3600000],['bad',86400000],[undefined,86400000]])('parses reset duration %s', (value,expected)=>{expect(durationMs(value as string|undefined,86400000)).toBe(expected);});
});


describe('admin budget view and explicit CAS mutation', () => {
 const action = { capUsd: 0.29, expectedRevision: 3, reason: 'Deliberate bounded budget change' };
 it('shows actual shared authority rather than a higher local deployment cap, without any observation write', async () => {
  vi.stubEnv('FREE_CHAIN_PAID_DAILY_CAP_USD', '10'); m.spend.mockResolvedValue({ available: true, capNanoUsd: 0, policyRevision: 9, heldNanoUsd: 3e9, spentNanoUsd: 1e9 });
  expect((await freeChainAdminView()).paid).toEqual({ policyState: 'initialized', capUsd: 0, configuredCapUsd: 10, policyRevision: 9, reservedUsd: 3, reportedUsd: 1 });
  expect(m.spend).toHaveBeenCalledWith(expect.any(Number)); expect(m.observeBudget).not.toHaveBeenCalled(); expect(m.setBudget).not.toHaveBeenCalled();
 });
 it('missing authority stays unavailable rather than using the configured allowance', async () => {
  m.spend.mockResolvedValue({ available: false, capNanoUsd: null, policyRevision: null, heldNanoUsd: 0, spentNanoUsd: 0 });
  expect((await freeChainAdminView()).paid).toMatchObject({ policyState: 'uninitialized', capUsd: null, policyRevision: null, reservedUsd: null, reportedUsd: null });
 });
 it('converts cents exactly, uses verified actor and never observes configuration as a side effect', async () => {
  m.setBudget.mockResolvedValue({ ok: true, policy: { capNanoUsd: 290000000, revision: 4 } });
  expect(await controlFreeChainBudget(action, 'verified-owner')).toEqual({ ok: true, capUsd: 0.29, policyRevision: 4 });
  expect(m.setBudget).toHaveBeenCalledWith({ capNanoUsd: 290000000, expectedRevision: 3, actorUid: 'verified-owner', reason: action.reason });
  expect(m.observeBudget).not.toHaveBeenCalled(); expect(m.reserve).not.toHaveBeenCalled(); expect(m.execute).not.toHaveBeenCalled();
 });
 it('refuses caps above this deployment limit even below the owner ceiling', async () => {
  vi.stubEnv('FREE_CHAIN_PAID_DAILY_CAP_USD', '0');
  await expect(controlFreeChainBudget(action, 'verified-owner')).rejects.toThrow('FREE_CHAIN_BUDGET_INVALID_INPUT'); expect(m.setBudget).not.toHaveBeenCalled();
 });
 it.each(['conflict', 'invalid_input', 'policy_corrupt', 'unavailable'])('maps storage %s without retry', async reason => {
  m.setBudget.mockResolvedValue({ ok: false, reason });
  await expect(controlFreeChainBudget(action, 'verified-owner')).rejects.toThrow(reason === 'conflict' ? 'FREE_CHAIN_BUDGET_CONFLICT' : reason === 'invalid_input' ? 'FREE_CHAIN_BUDGET_INVALID_INPUT' : 'FREE_CHAIN_BUDGET_UNAVAILABLE'); expect(m.setBudget).toHaveBeenCalledOnce();
 });
});


describe('first-use authority is not inferred from failed reads', () => {
 it('storage failure cannot become a revision-zero admin snapshot', async () => {
  m.spend.mockRejectedValue(new Error('Unavailable policy read'));
  await expect(freeChainAdminView()).rejects.toThrow('Unavailable policy read'); expect(m.observeBudget).not.toHaveBeenCalled(); expect(m.setBudget).not.toHaveBeenCalled();
 });
 it('verified initialization passes expectedRevision zero only after explicit budget action', async () => {
  m.setBudget.mockResolvedValue({ ok: true, policy: { capNanoUsd: 0, revision: 1 } });
  expect(await controlFreeChainBudget({ capUsd: 0, expectedRevision: 0, reason: 'Initialize with paid fallback disabled' }, 'verified-owner')).toEqual({ ok: true, capUsd: 0, policyRevision: 1 });
  expect(m.setBudget).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0, capNanoUsd: 0 }));
 });
});
