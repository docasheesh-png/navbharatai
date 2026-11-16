import * as masterPlan from './masterPlan';
import * as qubax from '../../lib/qubax';
import { withFixedTextChainScope } from '../fixedTextChain';
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
import { chatAvailabilityMessage } from '../../lib/chatAvailabilityMessage';
import { buildFreeChainRouter, busyMessage, orderForUser, type FreeChainInput } from './runtime';
import { freeChainConfig } from './config';
import * as mitrify from '../../lib/mitrify';
import { resetAllBreakers } from '../Router/CircuitBreaker';
import { FreeChainProviderError } from './providers/openAiCompatProvider';
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const VERIFIED = '2099-01-01';
function tiered(order: string, extra: Record<string, string> = {}) {
 return freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: order,
  FREE_CHAIN_GLM_API_KEY: 'single-fake-key', FREE_CHAIN_GLM_FREE_VERIFIED_UNTIL: VERIFIED, FREE_CHAIN_GROQ_API_KEY: 'fake-local-key', FREE_CHAIN_GROQ_FREE_VERIFIED_UNTIL: VERIFIED,
  FREE_CHAIN_CF_API_TOKEN: 'fake-local-key', FREE_CHAIN_CF_FREE_VERIFIED_UNTIL: VERIFIED, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  FREE_CHAIN_GLMX_API_KEY: 'fake-local-key', FREE_CHAIN_GLMX_RATE_VERIFIED_UNTIL: VERIFIED,
  FREE_CHAIN_DEEPINFRA_API_KEY: 'fake-local-key', FREE_CHAIN_DEEPINFRA_RATE_VERIFIED_UNTIL: VERIFIED,
  FREE_CHAIN_OPENAI_API_KEY: 'fake-local-key', FREE_CHAIN_OPENAI_RATE_VERIFIED_UNTIL: VERIFIED,
  FREE_CHAIN_DI_LLAMA8B_RATE_VERIFIED_UNTIL: VERIFIED, FREE_CHAIN_DI_DSV4_RATE_VERIFIED_UNTIL: VERIFIED, FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off', ...extra });
}
describe('owner tiered free chat module (Tier 1 → Tier 2 → Tier 3)', () => {
 it('default order is free-first and every paid rung sits after every free rung', () => {
  const cfg = freeChainConfig({});
  const firstPaid = cfg.order.findIndex(id => ['cheapinf', 'llama8b', 'dsv4flash', 'glmflashx', 'gpt5nano', 'geminipaid', 'deepseek'].includes(id));
  expect(cfg.order.slice(0, firstPaid)).toEqual(['glm45', 'glm47', 'groq', 'cloudflare', 'openrouter']);
  expect(cfg.order.slice(firstPaid)).toEqual(['cheapinf', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']);
  expect(cfg.maxAttempts).toBe(cfg.order.length); expect(cfg.stickySpread).toBe(false);
  expect(cfg.rungs.find(r => r.id === 'gemini')?.model).toBe('gemini-2.5-flash-lite');
 });
 it('rejects a configured order that promotes any paid rung above a free one', () => {
  expect(freeChainConfig({ FREE_CHAIN_ORDER: 'groq,gpt5nano,cloudflare' }).errors).toContain('FREE_CHAIN_ORDER');
  expect(freeChainConfig({ FREE_CHAIN_ORDER: 'groq,cloudflare,gpt5nano,deepseek' }).errors).not.toContain('FREE_CHAIN_ORDER');
 });
 it('terms-blocked and unverified providers are registered but never dispatch without written approval', async () => {
  const keys = { FREE_CHAIN_NVIDIA_API_KEY: 'k', FREE_CHAIN_MODELSCOPE_API_KEY: 'k', FREE_CHAIN_LLM7_API_KEY: 'k', FREE_CHAIN_BLUESMINDS_API_KEY: 'k', FREE_CHAIN_REQUESTY_API_KEY: 'k', FREE_CHAIN_LLM7_FREE_VERIFIED_UNTIL: VERIFIED };
  const cfg = tiered('nvidia,modelscope,llm7,bluesminds,requesty', keys);
  expect(Object.fromEntries(cfg.rungs.filter(r => cfg.order.includes(r.id)).map(r => [r.id, r.reason]))).toEqual({
   nvidia: 'terms-non-production', modelscope: 'terms-non-production', llm7: 'terms-non-production', bluesminds: 'terms-unverified', requesty: 'terms-unverified' });
  const result = await buildFreeChainRouter(db, cfg).route(input());
  expect(m.execute).not.toHaveBeenCalled(); expect(result.ok).toBe(false);
  expect(tiered('llm7', { ...keys, FREE_CHAIN_LLM7_WRITTEN_APPROVAL: 'on' }).rungs.find(r => r.id === 'llm7')?.reason).toBeUndefined();
 });
 it('rejects a comma/space key list: one key per provider account, no free-tier key pooling', () => {
  const cfg = freeChainConfig({ FREE_CHAIN_GROQ_API_KEY: 'key-one,key-two' });
  expect(cfg.errors).toContain('FREE_CHAIN_GROQ_API_KEY'); expect(cfg.rungs.find(r => r.id === 'groq')).toMatchObject({ key: '', configured: false });
 });
 it('paid Tier 3 rungs need an owner rate-card attestation and a price at or above the official list price', () => {
  const noAttest = freeChainConfig({ FREE_CHAIN_OPENAI_API_KEY: 'k' }).rungs.find(r => r.id === 'gpt5nano');
  expect(noAttest?.reason).toBe('rate-card-unverified');
  const lowered = freeChainConfig({ FREE_CHAIN_OPENAI_PRICE_IN_PER_MTOK: '0.01' });
  expect(lowered.errors).toContain('FREE_CHAIN_OPENAI_PRICE_IN_PER_MTOK');
  expect(lowered.rungs.find(r => r.id === 'gpt5nano')).toMatchObject({ priceIn: 0.05, priceOut: 0.40 });
 });
 it('falls to the cheapest paid rung only after free rungs fail, reserving the shared budget first', async () => {
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true }); m.settle.mockResolvedValue(undefined);
  m.execute.mockRejectedValueOnce(new FreeChainProviderError('RATE_LIMIT')).mockRejectedValueOnce(new FreeChainProviderError('SERVER')).mockImplementation(successful('paid answer'));
  const result = await buildFreeChainRouter(db, tiered('groq,cloudflare,glmflashx,llama8b')).route(input());
  expect(result).toMatchObject({ ok: true, provider: 'GLM', model: 'glm-4.7-flashx' });
  expect(m.paid).toHaveBeenCalledTimes(1); expect(m.paid.mock.calls[0][0].requestId).toMatch(/:glmflashx$/);
  expect(m.settle).toHaveBeenCalledTimes(1); expect(result.freeChain?.costUsdEstimate).toBeGreaterThan(0);
 });
 it('a refused paid reservation (daily cap reached) skips the rung without dispatch', async () => {
  m.paid.mockResolvedValue(null);
  const result = await buildFreeChainRouter(db, tiered('llama8b,gpt5nano')).route(input());
  expect(m.execute).not.toHaveBeenCalled(); expect(result.freeChain?.attempts.map(a => a.reason)).toEqual(['budget', 'budget']);
 });
 it('caps physical attempts per turn at FREE_CHAIN_MAX_ATTEMPTS', async () => {
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  const cfg = tiered('glm47,groq,cloudflare,glmflashx,llama8b', { FREE_CHAIN_MAX_ATTEMPTS: '3' });
  const result = await buildFreeChainRouter(db, cfg).route(input());
  expect(m.execute).toHaveBeenCalledTimes(3); expect(result.freeChain?.attempts.at(-1)?.reason).toBe('max-attempts');
 });
 it('reaches paid backup after four eligible free attempts instead of abandoning the chain', async () => {
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  for (let n = 0; n < 4; n++) m.execute.mockRejectedValueOnce(new FreeChainProviderError('SERVER'));
  m.execute.mockImplementation(successful('fifth attempt answer'));
  const cfg = tiered('glm45,glm47,groq,cloudflare,llama8b');
  const chunks: string[] = [];
  const result = await buildFreeChainRouter(db, cfg).route({ ...input(), onChunk: c => chunks.push(c) });
  expect(cfg.maxAttempts).toBe(5);
  expect(result).toMatchObject({ ok: true, provider: 'DEEPINFRA' });
  expect(m.execute).toHaveBeenCalledTimes(5);
  expect(result.freeChain?.fallbacks).toBe(4);
  expect(m.paid).toHaveBeenCalledOnce(); expect(m.settle).toHaveBeenCalledOnce();
  expect(chunks).toEqual(['fifth attempt answer']);
 });
 it('allows the full configured chain while keeping explicit smaller caps and invalid values fail-closed', () => {
  expect(freeChainConfig({}).maxAttempts).toBe(11);
  expect(freeChainConfig({ FREE_CHAIN_MAX_ATTEMPTS: '18' }).maxAttempts).toBe(18);
  expect(freeChainConfig({ FREE_CHAIN_MAX_ATTEMPTS: '3' }).maxAttempts).toBe(3);
  for (const value of ['19', '0', '-1', '2.5', 'Infinity', 'NaN']) {
    expect(freeChainConfig({ FREE_CHAIN_MAX_ATTEMPTS: value }).errors).toContain('FREE_CHAIN_MAX_ATTEMPTS');
  }
  expect(freeChainConfig({}).ttftMs).toBe(15_000);
  expect(freeChainConfig({ FREE_CHAIN_TTFT_MS: '6000' }).ttftMs).toBe(6_000);
 });
 it('429 Retry-After cools the provider for exactly that long, shared across instances', async () => {
  const now = Date.now();
  m.execute.mockRejectedValueOnce(new FreeChainProviderError('RATE_LIMIT', 1_200_000)).mockImplementation(successful());
  await buildFreeChainRouter(db, tiered('groq,cloudflare')).route(input());
  const [account, until] = m.cooldown.mock.calls[0];
  expect(account).toBe('groq'); expect(until).toBeGreaterThanOrEqual(now + 1_200_000);
 });
 it('sticky spread keeps a user on the same free rung and never lifts a paid rung', () => {
  const cfg = tiered('glm47,groq,cloudflare,glmflashx', { FREE_CHAIN_STICKY_SPREAD: 'on' });
  const a = orderForUser(cfg, 'user-a');
  expect(orderForUser(cfg, 'user-a')).toEqual(a); expect(a.at(-1)).toBe('glmflashx'); expect([...a].sort()).toEqual([...cfg.order].sort());
  const leaders = new Set(Array.from({ length: 50 }, (_, i) => orderForUser(cfg, `u${i}`)[0]));
  expect(leaders.size).toBeGreaterThan(1);
  expect(orderForUser(tiered('glm47,groq'), 'user-a')).toEqual(['glm47', 'groq']);
 });
 it('final message after silent fallback is friendly and in the user language', async () => {
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const r = await buildFreeChainRouter(db, tiered('groq')).route({ ...input(), message: 'mujhe ek kahani sunao yaar' });
  expect(r.content).toBe(busyMessage('mujhe ek kahani sunao yaar')); expect(r.content).toContain('thodi der');
  expect(busyMessage('मुझे कहानी सुनाओ')).toContain('कृपया'); expect(busyMessage('Please explain how photosynthesis works in green plants.')).toContain('temporarily unable to respond');
 });
 it('private or health turns never reach a paid third-party rung', async () => {
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  const r = await buildFreeChainRouter(db, tiered('gpt5nano')).route({ ...input(), context: { ...input().context, healthTurn: true } });
  expect(m.execute).not.toHaveBeenCalled(); expect(r.freeChain?.attempts[0].reason).toBe('privacy');
 });
});

describe('master plan routing through the live chain', () => {
 beforeEach(() => { m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true }); m.settle.mockResolvedValue(undefined); });
 it('explicit route-reorder opt-in sends a teaching question to DeepInfra DeepSeek', async () => {
  const result = await buildFreeChainRouter(db, tiered('groq,llama8b,dsv4flash', { FREE_CHAIN_ROUTE_REORDER_ENABLED: 'on' })).route({ ...input(), message: 'NEET exam ka syllabus samjhao' });
  expect(result.freeChain?.route).toBe('quality'); expect(result.freeChain?.rung).toBe('dsv4flash'); expect(m.paid).toHaveBeenCalledOnce();
 });
 it('without the DeepInfra key the quality route falls back to the normal free order (no breakage)', async () => {
  const result = await buildFreeChainRouter(db, tiered('groq,llama8b,dsv4flash', { FREE_CHAIN_DEEPINFRA_API_KEY: '', FREE_CHAIN_ROUTE_REORDER_ENABLED: 'on' })).route({ ...input(), message: 'NEET exam ka syllabus samjhao' });
  expect(result).toMatchObject({ ok: true }); expect(result.freeChain?.rung).toBe('groq'); expect(result.freeChain?.route).toBe('normal');
 });
 it('monthly cap reached skips paid rungs without dispatch', async () => {
  const fail = { collection: () => { throw new Error('down'); } } as unknown as typeof db;
  m.execute.mockRejectedValueOnce(new FreeChainProviderError('RATE_LIMIT'));
  const result = await buildFreeChainRouter(fail, tiered('groq,llama8b', { FREE_CHAIN_MONTHLY_CAP_ENABLED: 'on' })).route(input());
  expect(result.freeChain?.attempts.map(a => a.reason)).toEqual(['rate_limit', 'monthly-budget']); expect(m.paid).not.toHaveBeenCalled();
 });
 it('reply cap sends max 250 output tokens to the 8B rung and disables GLM thinking', async () => {
  await buildFreeChainRouter(db, tiered('llama8b')).route({ ...input(), message: 'tell me about indian history' });
  expect(m.execute.mock.calls[0][1]).toMatchObject({ maxOutputTokens: 250 });
  m.execute.mockClear(); await buildFreeChainRouter(db, tiered('llama8b')).route(input());
  expect(m.execute.mock.calls[0][1]).toMatchObject({ maxOutputTokens: 80 });
  m.execute.mockClear(); await buildFreeChainRouter(db, tiered('glm45')).route(input());
  expect(m.execute.mock.calls[0][1]).toMatchObject({ extraBody: { thinking: { type: 'disabled' } } });
 });
});


describe('exhausted FreeChain notices respect explicit language and do not invent overload', () => {
 it.each([
  { message:'mujhe ek kahani sunao',history:[],carried:'hi' as const,expected:'hi' as const },
  { message:'Reply in Tamil. mujhe madad chahiye',history:[],carried:'en' as const,expected:'ta' as const },
  { message:'More detail please',history:[{sender:'user',text:'Reply in Tamil'}],carried:undefined,expected:'ta' as const },
 ])('uses $expected without changing the unsuccessful outcome',async ({message,history,carried,expected})=>{
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const onChunk=vi.fn();const request={...input(),message,history,onChunk,context:{...input().context,replyLanguage:carried}};
  const result=await buildFreeChainRouter(db,tiered('groq')).route(request);
  expect(result).toMatchObject({ok:false,reason:'all-failed',provider:'NONE'});
  expect(result.content).toBe(chatAvailabilityMessage('temporary',{replyLanguage:expected}));
  expect(onChunk).toHaveBeenLastCalledWith(result.content,'notice');
  expect(result.content).not.toMatch(/provider|API|budget|traffic|CHEAPERINFERENCE/i);
 });
 it('keeps budget exhaustion neutral and uncharged without hiding the internal reason',async()=>{
  m.paid.mockResolvedValue(null);
  const result=await buildFreeChainRouter(db,tiered('llama8b')).route({...input(),context:{...input().context,replyLanguage:'en'}});
  expect(result.content).toBe(chatAvailabilityMessage('temporary'));
  expect(result.freeChain?.attempts.map(a=>a.reason)).toEqual(['budget']);
  expect(result.ok).toBe(false);expect(m.execute).not.toHaveBeenCalled();expect(m.settle).not.toHaveBeenCalled();
 });
});

describe('fixed-order FreeChain opt-in', () => {
 function fixed(extra: Record<string, string> = {}) { return tiered('gpt5nano,groq', { TEXT_CHAIN_POLICY: 'fixed-v1', FREE_CHAIN_STICKY_SPREAD: 'on', FREE_CHAIN_ROUTE_REORDER: 'on', ...extra }); }
 it('ignores competing order/sticky/cache selectors but retains an explicit smaller attempt limit', () => {
  const cfg = fixed(); expect(cfg.order).toEqual(['glm45','glm47','groq','cloudflare','openrouter','cheapinf','llama8b','dsv4flash','gpt5nano','glmflashx','geminipaid']);
  expect(cfg.stickySpread).toBe(false); expect(cfg.features.routeReorder).toBe(false); expect(cfg.cacheEnabled).toBe(false); expect(cfg.maxAttempts).toBe(12);
  expect(fixed({ FREE_CHAIN_MAX_ATTEMPTS: '2' }).maxAttempts).toBe(2);
 });
 it.each([false, true])('falls back to GLM45 then GLM47 when optional suppliers are unavailable, streaming=%s', streaming => {
  m.execute.mockRejectedValueOnce(new FreeChainProviderError('SERVER')).mockImplementation(successful('second answer'));
  const chunks: string[] = [];
  return buildFreeChainRouter(db, fixed()).route({ ...input(), ...(streaming ? { onChunk: (s: string) => chunks.push(s) } : {}) }).then(result => {
   expect(m.execute.mock.calls.map(c => c[1].model)).toEqual(['glm-4.5-flash','glm-4.7-flash']); expect(result.ok).toBe(true);
   if (streaming) expect(chunks).toEqual(['second answer']);
  });
 });
 it('does not let the admin exclusive selector bypass the requested supplier-first order', async () => {
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  await buildFreeChainRouter(db, fixed()).route({ ...input(), context: { ...input().context, isAdmin: true } });
  expect(m.execute.mock.calls[0][1].model).toBe('glm-4.5-flash');
 });
 // Owner t357u: Mitrify is default-on, so with no switch set it is tried; here it has no key and is skipped.
 it('records an unconfigured Mitrify slot and preserves budget denial', async () => {
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER')); m.paid.mockResolvedValue(null);
  const result = await buildFreeChainRouter(db, fixed()).route(input());
  expect(result.freeChain?.attempts).toContainEqual(expect.objectContaining({ provider: 'mitrify', entered: false, reason: 'mitrify-configuration' }));
  expect(result.freeChain?.attempts).toContainEqual(expect.objectContaining({ provider: 'llama8b', entered: false, reason: 'budget' }));
 });
 it.each([false, true])('admitted Mitrify uses the same shared budget and stops the fixed chain, streaming=%s', async streaming => {
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  m.paid.mockResolvedValue({ id: 'mitrify-hold', day: 'd', uidHash: 'u', maxCostNanoUsd: 400, createdAt: 0, mayDispatch: true });
  const admitted = vi.spyOn(mitrify, 'runApprovedMitrifyChain').mockImplementation(async options => {
   expect(options.privateTurn).toBe(false); expect(options.healthTurn).toBe(false);
   expect(options.body).toMatchObject({ stream: true, messages: [{ role: 'system', content: expect.any(String) }, { role: 'user', content: 'hello' }] });
   expect(await options.reserve(400)).not.toBeNull(); options.onChunk?.('approved reply');
   return { kind: 'response', content: 'approved reply', model: 'mitrify/auto-cheap', usage: { inputTokens: 10, outputTokens: 2 } };
  });
  const chunks: string[] = []; const result = await buildFreeChainRouter(db, fixed()).route({ ...input(), ...(streaming ? { onChunk: (s: string) => chunks.push(s) } : {}) });
  expect(result).toMatchObject({ provider: 'MITRIFY', content: 'approved reply', ok: true });
  expect(admitted).toHaveBeenCalledOnce(); expect(m.paid).toHaveBeenCalledOnce();
  expect(m.paid.mock.calls[0][0]).toMatchObject({ uid: 'owner', maxCostNanoUsd: 400, capNanoUsd: fixed().paidCapNanoUsd });
  expect(m.execute).not.toHaveBeenCalled();
  expect(m.settle).not.toHaveBeenCalled(); if (streaming) expect(chunks).toEqual(['approved reply']);
 });
  it('hands the same turn to the next chat provider after three Qubax models fail', async () => {
    vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
    for (let i = 0; i < 4; i++) m.execute.mockRejectedValueOnce(new FreeChainProviderError('SERVER'));
    m.execute.mockImplementation(successful('next provider answer'));
    m.paid.mockResolvedValue({ id: 'later-provider-hold', day: 'd', uidHash: 'u', maxCostNanoUsd: 400, createdAt: 0, mayDispatch: true });
    vi.spyOn(qubax, 'runApprovedQubaxChat').mockResolvedValue({ kind: 'skipped', reason: 'qubax-tries-exhausted' });
    const cfg = fixed({ FREE_CHAIN_MAX_ATTEMPTS: '8' });
    const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, cfg).route(input()));
    expect(result).toMatchObject({ ok: true, provider: 'DEEPINFRA', content: 'next provider answer' });
    const attempts = result.freeChain?.attempts ?? [];
    const index = attempts.findIndex(attempt => attempt.provider === 'qubax');
    expect(attempts[index]).toMatchObject({ reason: 'qubax-tries-exhausted', entered: false });
    expect(attempts.slice(index + 1).some(attempt => attempt.reason === 'served')).toBe(true);
  });
  it('places qualified Qubax after skipped Mitrify and before direct paid providers in Chat', async () => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  m.paid.mockResolvedValue({ id: 'qubax-hold', day: 'd', uidHash: 'u', maxCostNanoUsd: 400, createdAt: 0, mayDispatch: true });
  const calls: string[] = [];
  vi.spyOn(mitrify, 'runApprovedMitrifyChain').mockImplementation(async () => { calls.push('mitrify'); return { kind: 'skipped', reason: 'not-approved' }; });
  vi.spyOn(qubax, 'runApprovedQubaxChat').mockImplementation(async options => {
   calls.push('qubax'); expect(await options.reserve(400)).not.toBeNull(); options.beforeHttpDispatch?.(); await options.onChunk?.('Qubax only answer');
   return { kind: 'response', content: 'Qubax only answer', model: 'reviewed-qubax-model' };
  });
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route(input()));
  expect(result).toMatchObject({ provider: 'QUBAX', content: 'Qubax only answer' }); expect(calls).toEqual(['mitrify', 'qubax']);
  expect(result.freeChain?.attempts.find(a => a.provider === 'qubax')).toMatchObject({ entered: true, reason: 'served' });
  expect(m.paid).toHaveBeenCalledOnce(); expect(m.execute).not.toHaveBeenCalled(); expect(m.settle).not.toHaveBeenCalled();
 });
 it.each(['duplicate', 'error'])('fixed Chat releases only the fresh Mitrify month hold on %s daily admission', async outcome => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const month = '2026-11';
  vi.spyOn(masterPlan, 'reserveMonthly').mockResolvedValue(month); const release = vi.spyOn(masterPlan, 'settleMonthly').mockResolvedValue(undefined);
  if (outcome === 'duplicate') m.paid.mockResolvedValue({ id: 'original-daily-hold', mayDispatch: false }); else m.paid.mockRejectedValue(new Error('uncertain daily storage'));
  const adapter = vi.spyOn(mitrify, 'runApprovedMitrifyChain').mockImplementation(async options => {
   expect(options.maxHttpAttempts).toBe(1); await options.reserve(400); throw new Error('must never reach dispatch');
  });
  const qubaxAdapter = vi.spyOn(qubax, 'runApprovedQubaxChat');
  const cfg = fixed(); cfg.features.monthlyCap = true;
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, cfg).route(input()));
  // Mitrify's own fresh month hold is released first; later rungs then make (and release) their own.
  expect(release.mock.calls[0]).toEqual([db, month, 400, 0]); expect(release.mock.calls.every(call => call[3] === 0)).toBe(true);
  expect(m.settle).not.toHaveBeenCalled();
  expect(result.freeChain?.attempts.find(a => a.provider === 'mitrify')).toMatchObject({ entered: false });
  // Owner t357u: a Mitrify failure with nothing shown hands the turn to the next provider.
  expect(adapter).toHaveBeenCalledOnce(); expect(qubaxAdapter).toHaveBeenCalledOnce();
 });
 it.each([false, true])('fixed Chat counts Mitrify only at its dispatch boundary, entered=%s', async entered => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  // Only Mitrify gets a budget hold; later paid rungs are refused so the count below is Mitrify's alone.
  m.paid.mockResolvedValueOnce({ id: 'mitrify-hold', day: 'd', uidHash: 'u', maxCostNanoUsd: 400, createdAt: 0, mayDispatch: true }).mockResolvedValue(null);
  const adapter = vi.spyOn(mitrify, 'runApprovedMitrifyChain').mockImplementation(async options => {
   expect(options.maxHttpAttempts).toBe(1); const receipt = await options.reserve(400); expect(receipt).not.toBeNull();
   if (entered) options.beforeHttpDispatch?.(); else await receipt!.releaseUndispatched();
   throw new mitrify.MitrifyError(entered ? 'MITRIFY_HTTP_429' : 'MITRIFY_APPROVAL_REVOKED', entered ? 429 : 0, false, entered);
  });
  const qubaxAdapter = vi.spyOn(qubax, 'runApprovedQubaxChat');
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route(input()));
  expect(result.freeChain?.attempts.find(a => a.provider === 'mitrify')).toMatchObject({ entered });
  expect(result.freeChain?.attempts.filter(a => a.entered && a.provider === 'mitrify')).toHaveLength(entered ? 1 : 0);
  // Owner t357u: the turn falls through to the next provider; Mitrify's hold is settled only when undispatched.
  expect(adapter).toHaveBeenCalledOnce(); expect(qubaxAdapter).toHaveBeenCalledOnce();
  expect(m.settle).toHaveBeenCalledTimes(entered ? 0 : 1);
 });
 it.each([429, 503])('fixed Chat never treats Mitrify HTTP%s as a zero-charge retry receipt', async status => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1'); m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  m.paid.mockResolvedValueOnce({ id: 'possibly-spent', mayDispatch: true }).mockResolvedValue(null);
  const adapter = vi.spyOn(mitrify, 'runApprovedMitrifyChain').mockImplementation(async options => {
   await options.reserve(400); options.beforeHttpDispatch?.(); throw new mitrify.MitrifyError(`MITRIFY_HTTP_${status}`, status, false, true);
  });
  const qubaxAdapter = vi.spyOn(qubax, 'runApprovedQubaxChat');
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route(input()));
  // The possibly-spent Mitrify hold is never settled to zero; the turn still falls through (owner t357u).
  expect(result.ok).toBe(false); expect(adapter).toHaveBeenCalledOnce(); expect(qubaxAdapter).toHaveBeenCalledOnce(); expect(m.settle).not.toHaveBeenCalled();
 });
 it.each(['duplicate', 'error'])('releases the fresh Qubax month hold and does not clear the daily hold when reservation is %s', async outcome => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const month = { month: '2026-11', amount: 400 };
  vi.spyOn(masterPlan, 'reserveMonthly').mockResolvedValue(month); const release = vi.spyOn(masterPlan, 'settleMonthly').mockResolvedValue(undefined);
  if (outcome === 'duplicate') m.paid.mockResolvedValue({ id: 'original', mayDispatch: false }); else m.paid.mockRejectedValue(new Error('uncertain daily storage'));
  vi.spyOn(qubax, 'runApprovedQubaxChat').mockImplementation(async options => { await options.reserve(400); throw new Error('must never reach dispatch'); });
  const cfg = fixed(); cfg.features.monthlyCap = true;
  await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, cfg).route(input()));
  expect(release.mock.calls[0]).toEqual([db, month, 400, 0]);
  expect(release.mock.calls.every(call => call[3] === 0)).toBe(true);
  expect(m.settle).not.toHaveBeenCalled();
 });
 it('an uncertain Qubax attempt still reaches the later rungs', async () => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const adapter = vi.spyOn(qubax, 'runApprovedQubaxChat').mockRejectedValue(new qubax.QubaxError('QUBAX_UNAVAILABLE', 0, false, true));
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route(input()));
  expect(result.ok).toBe(false); expect(m.execute).toHaveBeenCalledTimes(4); expect(adapter).toHaveBeenCalledOnce();
  expect(result.freeChain?.attempts.some(a => a.provider === 'llama8b')).toBe(true);
 });
 it.each(['QUBAX_APPROVAL_REVOKED', 'QUBAX_CANCELLED'])('continues after confirmed undispatched %s without spending a physical attempt', async code => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  for (let i = 0; i < 4; i++) m.execute.mockRejectedValueOnce(new FreeChainProviderError('SERVER'));
  m.execute.mockImplementation(successful('later approved answer'));
  const hold = { id: 'unused-qubax-hold', day: 'd', uidHash: 'u', maxCostNanoUsd: 400, createdAt: 0, mayDispatch: true };
  m.paid.mockResolvedValue(hold);
  vi.spyOn(qubax, 'runApprovedQubaxChat').mockImplementation(async options => {
   const receipt = await options.reserve(400); expect(receipt).not.toBeNull();
   await receipt!.releaseUndispatched(); throw new qubax.QubaxError(code);
  });
  const cfg = fixed({ FREE_CHAIN_MAX_ATTEMPTS: '5' });
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, cfg).route(input()));
  expect(result).toMatchObject({ ok: true, provider: 'DEEPINFRA', content: 'later approved answer' });
  expect(m.execute).toHaveBeenCalledTimes(5); expect(m.paid).toHaveBeenCalledTimes(2);
  expect(m.settle).toHaveBeenCalledWith(hold, 0);
  expect(result.freeChain?.attempts.find(a => a.provider === 'qubax')).toMatchObject({ entered: false, reason: code.toLowerCase() });
  expect(result.freeChain?.attempts.filter(a => a.entered)).toHaveLength(5);
 });
 it.each(['admission-uncertain', 'unknown-wrapped', 'unknown', 'dispatched', 'partial', 'callback-entered'])('continues after Qubax %s when the user was shown no text', async kind => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  vi.spyOn(qubax, 'runApprovedQubaxChat').mockImplementation(async options => {
   if (kind === 'callback-entered') options.beforeHttpDispatch?.();
   if (kind === 'unknown') throw new Error('uncertain admission');
   throw new qubax.QubaxError(kind === 'admission-uncertain' ? 'QUBAX_ADMISSION_UNCERTAIN' : kind === 'unknown-wrapped' ? 'QUBAX_UNAVAILABLE' : 'QUBAX_APPROVAL_REVOKED', 0, kind === 'partial', kind === 'dispatched');
  });
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route(input()));
  expect(result.ok).toBe(false);
  expect(result.freeChain?.attempts.some(a => a.provider === 'llama8b')).toBe(true);
 });
 it('stops when the caller aborts during Qubax', async () => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const controller = new AbortController();
  vi.spyOn(qubax, 'runApprovedQubaxChat').mockImplementation(async () => { controller.abort(); throw new qubax.QubaxError('QUBAX_CANCELLED'); });
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route({ ...input(), signal: controller.signal }));
  expect(result.ok).toBe(false); expect(result.reason).toBe('aborted');
  expect(result.freeChain?.attempts.some(a => a.provider === 'llama8b')).toBe(false);
 });
 it('does not refund a dispatched Qubax hold when the chain continues', async () => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1');
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  m.paid.mockResolvedValueOnce({ id: 'spent-qubax-hold', day: 'd', uidHash: 'u', maxCostNanoUsd: 400, createdAt: 0, mayDispatch: true }).mockResolvedValue(null);
  vi.spyOn(qubax, 'runApprovedQubaxChat').mockImplementation(async options => {
   expect(await options.reserve(400)).not.toBeNull(); options.beforeHttpDispatch?.();
   throw new qubax.QubaxError('QUBAX_UNAVAILABLE', 0, false, true);
  });
  const result = await withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route(input()));
  expect(result.ok).toBe(false); expect(m.settle).not.toHaveBeenCalled();
  expect(result.freeChain?.attempts.find(a => a.provider === 'qubax')).toMatchObject({ entered: true });
  expect(result.freeChain?.attempts.some(a => a.provider === 'llama8b')).toBe(true);
 });
 it('does not enroll nested Builder chat helpers into Qubax', async () => {
  vi.stubEnv('TEXT_CHAIN_POLICY', 'fixed-v1'); m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const adapter = vi.spyOn(qubax, 'runApprovedQubaxChat');
  const result = await withFixedTextChainScope('builder', 'text', () => withFixedTextChainScope('chat', 'text', () => buildFreeChainRouter(db, fixed()).route(input())));
  expect(adapter).not.toHaveBeenCalled();
  expect(result.freeChain?.attempts).toContainEqual(expect.objectContaining({ provider: 'qubax', reason: 'qubax-chat-only', entered: false }));
 });
 it('a Mitrify failure after admission cannot open any subsequent direct rung', async () => {
  m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  m.paid.mockResolvedValue({ id: 'mitrify-hold', day: 'd', uidHash: 'u', maxCostNanoUsd: 400, createdAt: 0, mayDispatch: true });
  vi.spyOn(mitrify, 'runApprovedMitrifyChain').mockImplementation(async options => {
   await options.reserve(400); options.onChunk?.('partial'); throw new mitrify.MitrifyError('MITRIFY_INCOMPLETE_STREAM', 0, true);
  });
  const chunks: string[] = []; const result = await buildFreeChainRouter(db, fixed()).route({ ...input(), onChunk: s => chunks.push(s) });
  expect(result).toMatchObject({ provider: 'MITRIFY', reason: 'stalled' }); expect(chunks).toEqual(['partial']);
  expect(m.execute).not.toHaveBeenCalled(); expect(m.paid).toHaveBeenCalledOnce(); expect(m.settle).not.toHaveBeenCalled();
 });
 it('health classification cannot bypass configuration and reviewed admission', async () => {
  vi.stubEnv('MITRIFY_CHAIN_ENABLED', '1'); m.execute.mockRejectedValue(new FreeChainProviderError('SERVER'));
  const result = await buildFreeChainRouter(db, fixed()).route({ ...input(), context: { ...input().context, healthTurn: true } });
  expect(result.freeChain?.attempts).toContainEqual(expect.objectContaining({ provider: 'mitrify', entered: false, reason: 'mitrify-configuration' }));
  expect(m.paid).not.toHaveBeenCalled();
 });
 it('stops after a paid transport failure with an unresolved charge', async () => {
  m.execute.mockRejectedValue(new FreeChainProviderError('NETWORK'));
  m.paid.mockResolvedValue({ id: 'held', day: 'day', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  const result = await buildFreeChainRouter(db, fixed()).route(input());
  const models = m.execute.mock.calls.map(c => c[1].model);
  expect(models.at(-1)).toBe('meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo');
  expect(models).not.toContain('deepseek-ai/DeepSeek-V4-Flash-0731');
  expect(result.ok).toBe(false); expect(m.paid).toHaveBeenCalledOnce(); expect(m.settle).not.toHaveBeenCalled();
 });
 it('does not retry partial output or cancellation', async () => {
  const chunks: string[] = []; m.execute.mockImplementationOnce(async (arg) => { arg.onChunk('partial'); throw new FreeChainProviderError('SERVER'); });
  const result = await buildFreeChainRouter(db, fixed()).route({ ...input(), onChunk: s => chunks.push(s) });
  expect(result.reason).toBe('stalled'); expect(chunks).toEqual(['partial']); expect(m.execute).toHaveBeenCalledOnce();
  m.execute.mockClear(); const controller = new AbortController(); controller.abort();
  await buildFreeChainRouter(db, fixed()).route({ ...input(), signal: controller.signal }); expect(m.execute).not.toHaveBeenCalled();
 });
});
