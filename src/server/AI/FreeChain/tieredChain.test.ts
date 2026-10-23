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
import { buildFreeChainRouter, busyMessage, orderForUser, type FreeChainInput } from './runtime';
import { freeChainConfig } from './config';
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
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

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
  const firstPaid = cfg.order.findIndex(id => ['llama8b', 'dsv4flash', 'glmflashx', 'gpt5nano', 'geminipaid', 'deepseek'].includes(id));
  expect(cfg.order.slice(0, firstPaid)).toEqual(['glm45', 'glm47', 'groq', 'cloudflare', 'openrouter']);
  expect(cfg.order.slice(firstPaid)).toEqual(['llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']);
  expect(cfg.maxAttempts).toBe(4); expect(cfg.stickySpread).toBe(false);
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
  expect(busyMessage('मुझे कहानी सुनाओ')).toContain('कृपया'); expect(busyMessage('Please explain how photosynthesis works in green plants.')).toContain('temporarily busy');
 });
 it('private or health turns never reach a paid third-party rung', async () => {
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  const r = await buildFreeChainRouter(db, tiered('gpt5nano')).route({ ...input(), context: { ...input().context, healthTurn: true } });
  expect(m.execute).not.toHaveBeenCalled(); expect(r.freeChain?.attempts[0].reason).toBe('privacy');
 });
});

describe('master plan routing through the live chain', () => {
 beforeEach(() => { m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true }); m.settle.mockResolvedValue(undefined); });
 it('a teaching question goes straight to DeepInfra DeepSeek', async () => {
  const result = await buildFreeChainRouter(db, tiered('groq,llama8b,dsv4flash')).route({ ...input(), message: 'NEET exam ka syllabus samjhao' });
  expect(result.freeChain?.route).toBe('quality'); expect(result.freeChain?.rung).toBe('dsv4flash'); expect(m.paid).toHaveBeenCalledOnce();
 });
 it('without the DeepInfra key the quality route falls back to the normal free order (no breakage)', async () => {
  const result = await buildFreeChainRouter(db, tiered('groq,llama8b,dsv4flash', { FREE_CHAIN_DEEPINFRA_API_KEY: '' })).route({ ...input(), message: 'NEET exam ka syllabus samjhao' });
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
