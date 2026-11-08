import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ observeBudget: vi.fn(), setBudget: vi.fn(), execute: vi.fn(), registry: vi.fn(), reserve: vi.fn(), paid: vi.fn(), settle: vi.fn(), cooldown: vi.fn(), clearCooldown: vi.fn(), controls: vi.fn(), db: vi.fn(), strict: vi.fn(), maintenance: vi.fn(), set: vi.fn(), get: vi.fn(), quota: vi.fn(), spend: vi.fn(), cacheGet: vi.fn(), cachePut: vi.fn(), events: vi.fn(), where: vi.fn(), select: vi.fn(), limit: vi.fn() }));
vi.mock('../../lib/serverDb', () => ({ getServerDb: m.db }));
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: m.maintenance }));
vi.mock('../inferencePolicy', () => ({ strictFreeRequired: m.strict }));
vi.mock('./control', () => ({ readControls: m.controls, readControlsForSelection: m.controls, writeControls: vi.fn(), controlRef: () => ({ collection: () => ({ doc: () => ({ set: m.set, get: m.get }), where: m.where, select: m.select, limit: m.limit, get: m.events }) }) }));
vi.mock('./cache', async original => ({ ...(await original<typeof import('./cache')>()), FreeChainCache: class { get=m.cacheGet; put=m.cachePut; } }));
vi.mock('./store', () => ({ FreeChainStore: class { observePaidBudgetPolicy = m.observeBudget; setPaidBudgetPolicy = m.setBudget; reserveQuota = m.reserve; reservePaid = m.paid; settlePaid = m.settle; cooldown = m.cooldown; clearCooldown = m.clearCooldown; quotaSnapshot = m.quota; spendSnapshot = m.spend; } }));
vi.mock('./providers/openAiCompatProvider', async original => ({
 ...await original<typeof import('./providers/openAiCompatProvider')>(),
 OpenAiCompatProvider: class { constructor(readonly config: unknown) {} executeTurn(input: unknown) { return m.execute(input, this.config); } },
}));
vi.mock('./providers/openRouterRegistryRung', () => ({ runRegistryRung: m.registry }));
vi.mock('../Router/AIRouter', () => ({ acquireSlot: () => true, releaseSlot: vi.fn(), recordProviderLatency: vi.fn() }));
vi.mock('./telemetry', () => ({ logFreeChain: vi.fn() }));
import { buildFreeChainRouter, maybeFreeChain, freeChainAdminView, freeChainAdminMetrics, controlFreeChainBudget, durationMs, shouldPersistFreeChainEvent, type FreeChainInput } from './runtime';
import { FreeRoutingError } from '../LiveRegistry/dispatcher';
import { DEFAULT_ORDER, freeChainConfig } from './config';
import { applySwitchedOff, __resetProviderSwitchesForTests } from '../../lib/providerSwitches';
import { getBreaker, resetAllBreakers } from '../Router/CircuitBreaker';
import { FreeChainProviderError } from './providers/openAiCompatProvider';
import { FreeChainConfigurationError, freeChainConfigurationErrorResponse, isFreeChainConfigurationErrorResponse, isFreeChainAdminView, isFreeChainAdminMetrics } from '../../../lib/freeChatChainView';
import type { ChatReplyLanguage } from '../../../lib/chatReplyLanguage';
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
 vi.clearAllMocks(); m.where.mockReturnThis(); m.select.mockReturnThis(); m.limit.mockReturnThis(); m.events.mockResolvedValue({ docs: [] }); resetAllBreakers(); m.cacheGet.mockResolvedValue(null); m.cachePut.mockResolvedValue(undefined);
 m.paid.mockReset(); m.settle.mockReset(); m.observeBudget.mockImplementation(async (cap: number) => ({ capNanoUsd: cap, revision: 1 }));
 m.controls.mockResolvedValue({ enabled: true, rolloutPercent: 100, disabledProviders: [] });
 m.reserve.mockResolvedValue({ allowed: true }); m.set.mockResolvedValue(undefined); m.get.mockResolvedValue({ data: () => undefined });
 m.cooldown.mockResolvedValue(true); m.clearCooldown.mockResolvedValue(true); m.strict.mockReturnValue(false); m.db.mockReturnValue(db); m.maintenance.mockResolvedValue(undefined);
 m.execute.mockImplementation(successful());
 m.quota.mockResolvedValue({ available: true, usage: { rpm: 1, rpd: 2, tpm: 3, tpd: 4, neuronsPerDay: 5 }, dailyResetAt: Date.now()+1000, minuteResetAt: Date.now()+1000, cooldownUntil: 0 });
 m.spend.mockResolvedValue({ available: true, capNanoUsd: 2e9, policyRevision: 3, heldNanoUsd: 0, spentNanoUsd: 0 });
});
afterEach(() => { __resetProviderSwitchesForTests(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('free chat chain central dispatch', () => {
 it('keeps independently reviewed free chat available when paid budget publication fails', async () => {
   m.observeBudget.mockRejectedValue(new Error('synthetic paid-policy outage'));
   const freshDb = {} as typeof db;
   const result = await buildFreeChainRouter(freshDb, config()).route(input());
   expect(result).toMatchObject({ ok: true, provider: 'GROQ' });
   expect(m.paid).not.toHaveBeenCalled(); expect(m.execute).toHaveBeenCalledOnce();
 });
 it('never dispatches paid fallback after failed paid-policy publication', async () => {
   m.observeBudget.mockRejectedValue(new Error('synthetic paid-policy outage'));
   m.execute.mockRejectedValue(new FreeChainProviderError('MODEL_UNAVAILABLE'));
   const result = await buildFreeChainRouter({} as typeof db, config('groq,deepseek')).route(input());
   expect(result.ok).toBe(false); expect(m.execute).toHaveBeenCalledOnce();
   expect(m.paid).not.toHaveBeenCalled();
   expect(result.freeChain?.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'deepseek', reason: 'paid-budget-unavailable', entered: false })]));
 });

 it('retries transient paid authority failure on a later request without disabling free chat', async () => {
   vi.useFakeTimers();
   m.observeBudget.mockRejectedValueOnce(new Error('synthetic paid-policy outage'));
   const router = buildFreeChainRouter({} as typeof db, config('groq'));
   expect(await router.route(input())).toMatchObject({ ok: true, provider: 'GROQ' });
   await vi.advanceTimersByTimeAsync(1001);
   expect(await router.route(input())).toMatchObject({ ok: true, provider: 'GROQ' });
   expect(m.observeBudget).toHaveBeenCalledTimes(2); expect(m.paid).not.toHaveBeenCalled();
 });

 it('blocks Mitrify and every fixed-chain paid rung when paid authority publication fails', async () => {
   m.observeBudget.mockRejectedValue(new Error('synthetic paid-policy outage'));
   m.execute.mockRejectedValue(new FreeChainProviderError('MODEL_UNAVAILABLE'));
   const cfg = config(); cfg.fixedOrder = true; cfg.maxAttempts = 12;
   const result = await buildFreeChainRouter({} as typeof db, cfg).route(input());
   expect(result.ok).toBe(false); expect(m.paid).not.toHaveBeenCalled();
   for (const provider of ['mitrify', 'cheapinf', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']) {
     expect(result.freeChain?.attempts.find(a => a.provider === provider)).toMatchObject({ reason: 'paid-budget-unavailable', entered: false });
   }
   expect(m.execute.mock.calls.every(call => ['glm-4.5-flash', 'glm-4.7-flash', 'openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'].includes(call[1].model))).toBe(true);
 });

 it.each(['hello', 'solve 2 + 2', 'exam notes', 'fever symptoms'])('keeps GLM first for default routing: %s', async message => {
   const cfg = config(DEFAULT_ORDER.join(','));
   const result = await buildFreeChainRouter(db, cfg).route({ ...input(), message });
   expect(result).toMatchObject({ ok: true, model: 'glm-4.5-flash' });
   expect(m.execute).toHaveBeenCalledOnce();
   expect(m.paid).not.toHaveBeenCalled();
 });
 it('falls through in owner order and retains the four-physical-attempt bound', async () => {
   m.execute.mockRejectedValue(new FreeChainProviderError('MODEL_UNAVAILABLE'));
   const result = await buildFreeChainRouter(db, config(DEFAULT_ORDER.join(','))).route(input());
   expect(m.execute.mock.calls.map(call => call[1].model)).toEqual([
     'glm-4.5-flash', 'glm-4.7-flash', 'openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
   ]);
   expect(result.ok).toBe(false);
   expect(m.registry).not.toHaveBeenCalled();
   expect(m.paid).not.toHaveBeenCalled();
 });
 it('skips a switched-off family even with credentials captured before OFF', async () => {
   const cfg = config(DEFAULT_ORDER.join(','));
   applySwitchedOff(['glm']);
   const result = await buildFreeChainRouter(db, cfg).route(input());
   expect(result).toMatchObject({ ok: true, provider: 'GROQ' });
   expect(m.execute).toHaveBeenCalledOnce();
 });
 it('cannot call Gemini from the empty boot switch cache before a successful read', async () => {
   const cfg = freeChainConfig({ FREE_CHAIN_ORDER: 'geminipaid', FREE_CHAIN_GEMINIPAID_API_KEY: 'fake-key', FREE_CHAIN_GEMINIPAID_RATE_VERIFIED_UNTIL: '2099-01-01' });
   const result = await buildFreeChainRouter(db, cfg).route(input());
   expect(result.freeChain?.attempts).toEqual([expect.objectContaining({ reason: 'disabled', entered: false })]);
   expect(m.execute).not.toHaveBeenCalled();
   expect(m.paid).not.toHaveBeenCalled();
 });
 it('retains last Gemini rung but never dispatches it while globally OFF', async () => {
   const cfg = freeChainConfig({ FREE_CHAIN_ORDER: 'geminipaid', FREE_CHAIN_GEMINIPAID_API_KEY: 'fake-key', FREE_CHAIN_GEMINIPAID_RATE_VERIFIED_UNTIL: '2099-01-01' });
   applySwitchedOff(['gemini', 'vertex']);
   const result = await buildFreeChainRouter(db, cfg).route(input());
   expect(DEFAULT_ORDER.at(-1)).toBe('geminipaid');
   expect(result.freeChain?.attempts).toEqual([expect.objectContaining({ provider: 'geminipaid', reason: 'disabled', entered: false })]);
   expect(m.execute).not.toHaveBeenCalled();
   expect(m.paid).not.toHaveBeenCalled();
 });

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
 it.each([false, true])('keeps the explicit script in every provider request, including quality=%s and history trim', async teachingTurn => {
 const history = [{ sender: 'user', text: 'Please explain world trade.' }, { sender: 'ai', text: 'A Roman-script answer.' }, { sender: 'user', text: 'devnaagri me bataao' }, ...Array.from({ length: 10 }, (_, i) => ({ sender: 'user', text: `Follow-up ${i}` }))];
 m.execute.mockRejectedValueOnce(new FreeChainProviderError('RATE_LIMIT')).mockImplementation(successful('A synthetic answer.'));
 const result = await buildFreeChainRouter(db, config('groq,cloudflare')).route({ ...input(), message: 'aur batao', history, context: { ...input().context, teachingTurn } });
 expect(result.ok).toBe(true); expect(m.execute).toHaveBeenCalledTimes(2);
 for (const [request] of m.execute.mock.calls) {
   expect(request.systemPrompt).toContain('Hindi using Devanagari script, not Romanized Hindi or Hinglish');
   expect(request.systemPrompt).not.toContain('Reply in Hinglish using Roman script.');
   expect(request.prompt).not.toContain('devnaagri me bataao'); // policy survives the six-turn history window
 }
 expect(m.paid).not.toHaveBeenCalled(); // no paid translation/rewrite hop
 });
 it('honors a current Roman-script override over an older Devanagari preference', async () => {
 await buildFreeChainRouter(db, config('groq')).route({ ...input(), message: 'Please reply in Hinglish', history: [{ role: 'user', content: 'Answer in Hindi' }] });
 expect(m.execute.mock.calls[0][0].systemPrompt).toContain('Hinglish using Roman script, not Devanagari');
 expect(m.execute.mock.calls[0][0].systemPrompt).not.toContain('Reply in Hindi using Devanagari script');
 });
 it('uses the preference resolved at ingress when the source turn was trimmed already', async () => {
 await buildFreeChainRouter(db, config('groq')).route({ ...input(), message: 'more detail please', context: { ...input().context, replyLanguage: 'hi' } });
 expect(m.execute.mock.calls[0][0].systemPrompt).toContain('Hindi using Devanagari script');
 });
 it.each(['Tamil', 'French'])('honors an explicit %s request instead of the English input language', async language => {
 const cfg = config('groq'); cfg.rungs.find(r => r.id === 'groq')!.languages = ['other'];
 const result = await buildFreeChainRouter(db, cfg).route({ ...input(), message: `Please reply in ${language}`, history: [{ sender: 'user', text: 'Reply in Hindi' }] });
 expect(result.ok).toBe(true); expect(m.execute).toHaveBeenCalledOnce();
 expect(m.execute.mock.calls[0][0].systemPrompt).toContain(`explicit user choice): Reply in ${language}.`);
 expect(m.execute.mock.calls[0][0].systemPrompt).not.toContain('Reply in English.');
 });
 it('keeps detection subordinate even for explicit phrasing outside the deterministic parser', async () => {
 await buildFreeChainRouter(db, config('groq')).route({ ...input(), message: 'For my answers I would prefer the Hindi language.' });
 expect(m.execute.mock.calls[0][0].systemPrompt).toContain('DEFAULT ONLY when this conversation has no explicit reply-language or script request');
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
 await store.setPaidBudgetPolicy({ capNanoUsd: cap * 1e9, expectedRevision: 0, actorUid: 'test-admin', reason: 'Explicit capped policy after uncapped rollout' });
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
 it.each([true, false])('abort during daily reserve closes only a newly dispatchable hold (mayDispatch=%s)', async mayDispatch => {
 const controller = new AbortController();
 const reservation = { id: 'synthetic-held', day: '2026-10-26', uidHash: 'synthetic-owner', maxCostNanoUsd: 315801600, createdAt: 0, mayDispatch };
 m.paid.mockImplementation(async () => { controller.abort(); return reservation; });
 m.settle.mockResolvedValue(true);
 const result = await buildFreeChainRouter(db, config('deepseek')).route({ ...input(), signal: controller.signal });
 expect(result.ok).toBe(false); expect(m.execute).not.toHaveBeenCalled(); expect(m.paid).toHaveBeenCalledOnce();
 if (mayDispatch) expect(m.settle).toHaveBeenCalledExactlyOnceWith(reservation, 0);
 else expect(m.settle).not.toHaveBeenCalled();
 });
 it('daily hold stays conservative when cancellation occurs after adapter entry', async () => {
 const controller = new AbortController();
 m.paid.mockResolvedValue({ id: 'synthetic-held', day: '2026-10-26', uidHash: 'synthetic-owner', maxCostNanoUsd: 315801600, createdAt: 0, mayDispatch: true });
 m.execute.mockImplementation(async () => { controller.abort(); throw new FreeChainProviderError('ABORTED'); });
 expect((await buildFreeChainRouter(db, config('deepseek')).route({ ...input(), signal: controller.signal })).ok).toBe(false);
 expect(m.execute).toHaveBeenCalledOnce(); expect(m.settle).not.toHaveBeenCalled();
 });
 it('streams a clear busy response when every rung is unavailable', async () => {
 const cfg=config();cfg.rungs.forEach(r=>{r.reason='unconfigured';});const onChunk=vi.fn();
 const result=await buildFreeChainRouter(db,cfg).route({...input(),onChunk});expect(result.ok).toBe(false);expect(onChunk).toHaveBeenCalledWith(result.content, 'notice');
 });
 it('defaults OFF and strict-free bypasses the chain', async () => {
 vi.stubEnv('FREE_CHAIN_ENABLED','off');expect(await maybeFreeChain(input())).toBeNull();expect(m.db).not.toHaveBeenCalled();
 vi.stubEnv('FREE_CHAIN_ENABLED','on');m.strict.mockReturnValue(true);expect(await maybeFreeChain(input())).toBeNull();expect(m.execute).not.toHaveBeenCalled();
 });
 it('CHEAPERINFERENCE=admin still serves when FREE_CHAIN_ENABLED is off (owner exclusive path)', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  vi.stubEnv('FREE_CHAIN_MONTHLY_CAP_ENABLED', 'off');
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  m.settle.mockResolvedValue(undefined);
  const onChunk = vi.fn();
  const result = await maybeFreeChain({ ...input(), context: { ...input().context, isAdmin: true }, onChunk });
  expect(result?.ok).toBe(true);
  expect(result?.provider).toBe('CHEAPERINFERENCE');
  expect(result?.model).toBe('beam');
  expect(m.execute).toHaveBeenCalledTimes(1);
  expect(onChunk).toHaveBeenCalledWith('answer');
  expect(onChunk).not.toHaveBeenCalledWith(expect.any(String), 'notice');
 });
 it('CHEAPERINFERENCE=admin busy reply shows real reason; ordinary users stay friendly', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', ''); // missing key → early diagnostic
  const adminOnChunk = vi.fn();
  const admin = await maybeFreeChain({
    ...input(),
    message: 'नमस्ते',
    context: { ...input().context, isAdmin: true },
    onChunk: adminOnChunk,
  });
  expect(admin?.ok).toBe(false);
  expect(admin?.content).toContain('अभी जवाब नहीं दे पा रहा');
  expect(admin?.content).toContain('[admin diagnostic]');
  expect(admin?.content).toMatch(/cheapinf-key-missing-or-invalid|keyConfigured=no/);
  expect(admin?.content).not.toMatch(/ci_live_|sk-|Bearer\s+\S{8,}/);
  expect(adminOnChunk).toHaveBeenCalledWith(expect.stringContaining('[admin diagnostic]'), 'notice');

  const userOnChunk = vi.fn();
  // Non-admin with FreeChain OFF does not enter the chain at all when mode=admin.
  const user = await maybeFreeChain({ ...input(), message: 'नमस्ते', onChunk: userOnChunk });
  expect(user).toBeNull();
 });
 it('CHEAPERINFERENCE=admin surfaces provider HTTP failure in busy diagnostic', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  vi.stubEnv('FREE_CHAIN_MONTHLY_CAP_ENABLED', 'off');
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  m.execute.mockRejectedValue(new FreeChainProviderError('AUTH', { status: 401, credentialEnv: 'CHEAPERINFERENCE_API_KEY' }));
  const onChunk = vi.fn();
  const result = await maybeFreeChain({
    ...input(),
    message: 'hello admin',
    context: { ...input().context, isAdmin: true },
    onChunk,
  });
  expect(result?.ok).toBe(false);
  expect(result?.content).toContain('[admin diagnostic]');
  expect(result?.content).toMatch(/auth:http=401|cheapinf:auth/);
  expect(result?.content).not.toContain('ci_live_test_key');
  // Ordinary user content helper: friendly only
  const userResult = await buildFreeChainRouter(db, freeChainConfig({
    FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: 'cheapinf',
    CHEAPERINFERENCE: 'all', CHEAPERINFERENCE_API_KEY: 'ci_live_test_key', FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off',
  })).route({ ...input(), message: 'hello' });
  expect(userResult.ok).toBe(false);
  expect(userResult.content).not.toContain('[admin diagnostic]');
 });
 it('CHEAPERINFERENCE=admin exclusive path answers private/profile turns', async () => {
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  const cfg = freeChainConfig({
    FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: 'cheapinf',
    CHEAPERINFERENCE: 'admin', CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
    FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off', FREE_CHAIN_OUTPUT_CAP_ENABLED: 'off',
  });
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  m.settle.mockResolvedValue(undefined);
  const result = await buildFreeChainRouter(db, cfg).route({
    ...input(),
    context: { ...input().context, isAdmin: true, privateTurn: true, cacheEligible: false },
  });
  expect(result.ok).toBe(true);
  expect(result.provider).toBe('CHEAPERINFERENCE');
  expect(m.execute).toHaveBeenCalledTimes(1);
 });
 it('CHEAPERINFERENCE=admin probes past stale circuit and surfaces upstream HTTP', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  vi.stubEnv('FREE_CHAIN_MONTHLY_CAP_ENABLED', 'off');
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  // Seed a long AUTH-style open (1h) with last reason — this is what live showed as cheapinf:circuit.
  const b = getBreaker('free-chat-chain:cheapinf');
  b.recordFailure(3_600_000, Date.now(), 'auth:http=401');
  expect(b.isBlocking()).toBe(true);
  m.execute.mockRejectedValue(new FreeChainProviderError('QUOTA_EXHAUSTED', { status: 402 }));
  const result = await maybeFreeChain({
    ...input(),
    message: 'probe please',
    context: { ...input().context, isAdmin: true },
  });
  expect(m.execute).toHaveBeenCalledTimes(1);
  expect(result?.ok).toBe(false);
  expect(result?.content).toContain('[admin diagnostic]');
  expect(result?.content).toMatch(/quota_exhausted:http=402|cheapinf:quota_exhausted/);
  expect(result?.content).not.toMatch(/cheapinf:circuit(?!-probe)/);
  // Owner exclusive cooldown is short (≤30s), not 1d.
  const snap = getBreaker('free-chat-chain:cheapinf').snapshot();
  expect(snap.lastOpenReason).toMatch(/quota_exhausted:http=402/);
  expect(snap.openedUntil - Date.now()).toBeLessThanOrEqual(30_000 + 50);
 });
 it('CHEAPERINFERENCE=admin short circuit wait reports last open reason without probing', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  vi.stubEnv('FREE_CHAIN_MONTHLY_CAP_ENABLED', 'off');
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  const b = getBreaker('free-chat-chain:cheapinf');
  b.recordFailure(20_000, Date.now(), 'auth:http=401');
  const result = await maybeFreeChain({
    ...input(),
    message: 'wait',
    context: { ...input().context, isAdmin: true },
  });
  expect(m.execute).not.toHaveBeenCalled();
  expect(result?.ok).toBe(false);
  expect(result?.content).toContain('[admin diagnostic]');
  expect(result?.content).toMatch(/circuit:last=auth:http=401:remain=\d+s/);
 });
 it('CHEAPERINFERENCE=admin probes a short empty_response circuit instead of skipping Beam', async () => {
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  vi.stubEnv('FREE_CHAIN_MONTHLY_CAP_ENABLED', 'off');
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  getBreaker('free-chat-chain:cheapinf').recordFailure(28_000, Date.now(), 'empty_response');
  const result = await maybeFreeChain({
    ...input(),
    message: 'hello again',
    context: { ...input().context, isAdmin: true },
  });
  expect(m.execute).toHaveBeenCalledTimes(1);
  expect(m.execute.mock.calls[0][1]).toMatchObject({ maxOutputTokens: 2048, model: 'beam', extraBody: { reasoning_effort: 'low' } });
  expect(result?.ok).toBe(true);
  expect(result?.provider).toBe('CHEAPERINFERENCE');
  expect(result?.content).not.toMatch(/circuit:last=empty_response/);
 });
 it('CHEAPERINFERENCE=admin waits 60s for first content and labels timeout:first-token', async () => {
  // Keep the real immutable error contract: an unfrozen mock hid a failed metadata assignment.
  expect(Object.isFrozen(new FreeChainProviderError('TIMEOUT'))).toBe(true);
  vi.useFakeTimers();
  vi.stubEnv('FREE_CHAIN_ENABLED', 'off');
  vi.stubEnv('CHEAPERINFERENCE', 'admin');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  vi.stubEnv('FREE_CHAIN_MONTHLY_CAP_ENABLED', 'off');
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  m.execute.mockImplementation(async (arg: { onChunk?: (s: string) => void; signal?: AbortSignal }) => {
    await new Promise<never>((_resolve, reject) => {
      const fail = () => reject(new FreeChainProviderError('ABORTED'));
      if (arg.signal?.aborted) return fail();
      arg.signal?.addEventListener('abort', fail, { once: true });
    });
  });
  const pending = maybeFreeChain({
    ...input(),
    message: 'slow beam',
    context: { ...input().context, isAdmin: true },
  });
  // Old FREE_CHAIN_TTFT_MS=6s would have failed here; exclusive admin must still be waiting.
  await vi.advanceTimersByTimeAsync(7_000);
  expect(m.execute).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(54_000); // 61s total ≥ 60s first-token cap
  const result = await pending;
  expect(result?.ok).toBe(false);
  expect(result?.content).toContain('[admin diagnostic]');
  expect(result?.content).toMatch(/timeout:first-token:60000ms/);
  expect(result?.content).toMatch(/ttftCapMs=60000/);
  expect(result?.content).toMatch(/waitMs=/);
 });

 it('keeps watchdog metadata local to the timed-out attempt and preserves the real error contract', async () => {
  vi.useFakeTimers();
  m.execute.mockImplementationOnce((arg: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    arg.signal?.addEventListener('abort', () => reject(new FreeChainProviderError('ABORTED')), { once: true });
  })).mockRejectedValueOnce(new FreeChainProviderError('NETWORK'));
  const pending = buildFreeChainRouter(db, config('groq,cloudflare')).route(input());
  await vi.advanceTimersByTimeAsync(16_000);
  const result = await pending;
  expect(result.ok).toBe(false);
  expect(result.freeChain?.attempts.map(attempt => attempt.reason)).toEqual(['timeout:first-token:15000ms', 'network']);
  expect(m.execute).toHaveBeenCalledTimes(2);
  expect(m.paid).not.toHaveBeenCalled();
 });

 it('keeps a healthy slow first response alive beyond the former six-second limit', async () => {
  vi.useFakeTimers();
  m.execute.mockImplementationOnce(async (arg, cfg) => {
    await new Promise(resolve => setTimeout(resolve, 12_000));
    return successful('slow but healthy')(arg, cfg);
  });
  const pending = buildFreeChainRouter(db, config()).route(input());
  await vi.advanceTimersByTimeAsync(13_000);
  expect(await pending).toMatchObject({ ok: true, content: 'slow but healthy' });
  expect(m.execute).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
 });
 it('can finish a later eligible fallback after the former ninety-second request limit', async () => {
  vi.useFakeTimers();
  const cfg = config('glm45,glm47,groq,cloudflare,deepseek'); cfg.ttftMs = 30_000;
  m.paid.mockResolvedValue({ id: 'r', day: 'd', uidHash: 'u', maxCostNanoUsd: 1, createdAt: 0, mayDispatch: true });
  for (let n = 0; n < 4; n++) m.execute.mockImplementationOnce((arg: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    arg.signal?.addEventListener('abort', () => reject(new FreeChainProviderError('ABORTED')), { once: true });
  }));
  m.execute.mockImplementation(successful('later answer'));
  const pending = buildFreeChainRouter(db, cfg).route(input());
  await vi.advanceTimersByTimeAsync(121_000);
  expect(await pending).toMatchObject({ ok: true, content: 'later answer' });
  expect(m.execute).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
 });
 it('caps the whole chain at four minutes even with longer per-attempt first-content overrides', async () => {
  vi.useFakeTimers();
  const cfg = config('glm45,glm47,groq,cloudflare'); cfg.ttftMs = 90_000;
  const signals: AbortSignal[] = []; const late: Array<(s: string) => void> = []; const finish: Array<() => void> = [];
  m.execute.mockImplementation((arg: { signal: AbortSignal; onChunk: (s: string) => void }) => {
    signals.push(arg.signal); late.push(arg.onChunk);
    return new Promise(resolve => finish.push(() => resolve({ rateLimitHeaders: {} }))); // deliberately ignores cancellation
  });
  const chunks: string[] = [];
  const pending = buildFreeChainRouter(db, cfg).route({ ...input(), onChunk: c => chunks.push(c) });
  await vi.advanceTimersByTimeAsync(241_000);
  expect((await pending).ok).toBe(false);
  expect(m.execute).toHaveBeenCalledTimes(3);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  const before = [...chunks]; late.forEach(chunk => chunk('late reply'));
  expect(chunks).toEqual(before);
  expect(m.execute.mock.calls[2][1].timeoutMs).toBe(60_000);
  finish.forEach(resolve => resolve()); await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
 });
 it('non-admin chain still skips open circuit without probing', async () => {
  vi.stubEnv('CHEAPERINFERENCE', 'all');
  vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  vi.stubEnv('CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION', 'on');
  const cfg = freeChainConfig({
    FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: 'cheapinf',
    CHEAPERINFERENCE: 'all', CHEAPERINFERENCE_API_KEY: 'ci_live_test_key',
    CHEAPERINFERENCE_KEAK_WRITTEN_PERMISSION: 'on', FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off',
  });
  getBreaker('free-chat-chain:cheapinf').recordFailure(3_600_000, Date.now(), 'auth:http=401');
  const result = await buildFreeChainRouter(db, cfg).route(input());
  expect(m.execute).not.toHaveBeenCalled();
  expect(result.ok).toBe(false);
  expect(result.freeChain?.attempts[0].reason).toMatch(/^circuit:last=auth:http=401/);
  expect(result.content).not.toContain('[admin diagnostic]');
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
 it('bypasses response caching for historical language preferences even on a public corpus prompt', async () => {
  const cfg = config('groq'); cfg.cacheEnabled = true;
  const router = buildFreeChainRouter(db, cfg);
  for (const [index, preference] of ['devnaagri me bataao', 'Reply in English'].entries()) {
   const result = await router.route({ ...input(), message: 'photosynthesis kya hai',
    history: [{ role: 'user', content: preference }],
    context: { ...input().context, uid: `public-user-${index}`, conversationKey: `chat-${index}`, cacheEligible: true } });
   expect(result.ok).toBe(true); expect(result.freeChain?.cacheHit).toBe(false);
  }
  expect(m.cacheGet).not.toHaveBeenCalled(); expect(m.cachePut).not.toHaveBeenCalled();
  expect(m.execute).toHaveBeenCalledTimes(2);
 });
 it.each<[ChatReplyLanguage, ChatReplyLanguage]>([['hi', 'en'], ['hi', 'hinglish'], ['ta', 'fr'], ['hi-latn', 'hinglish']])(
  'separates public response-cache keys for %s and %s across users and conversations', async (firstLanguage, secondLanguage) => {
   const cfg = config('groq'); cfg.cacheEnabled = true;
   cfg.rungs.find(r => r.id === 'groq')!.languages = ['hi', 'hinglish', 'en', 'other'];
   const entries = new Map<string, { content: string; provider: string; model: string }>();
   m.cacheGet.mockImplementation(async key => entries.get(key) ?? null);
   m.cachePut.mockImplementation(async (key, value) => { entries.set(key, value); });
   m.execute.mockImplementationOnce(successful('first requested language answer'))
    .mockImplementationOnce(successful('second requested language answer'));
   const router = buildFreeChainRouter(db, cfg);
   const turn = (replyLanguage: ChatReplyLanguage, identity: string) => router.route({ ...input(), message: 'photosynthesis kya hai',
    context: { ...input().context, uid: identity, conversationKey: `chat-${identity}`, cacheEligible: true, replyLanguage } });
   const first = await turn(firstLanguage, 'first-public-user');
   const second = await turn(secondLanguage, 'second-public-user');
   const repeat = await turn(firstLanguage, 'third-public-user');
   expect(first.content).toBe('first requested language answer'); expect(first.freeChain?.cacheHit).toBe(false);
   expect(second.content).toBe('second requested language answer'); expect(second.freeChain?.cacheHit).toBe(false);
   expect(repeat.content).toBe(first.content); expect(repeat.freeChain?.cacheHit).toBe(true);
   const keys = m.cacheGet.mock.calls.map(([key]) => key);
   expect(keys).toHaveLength(3); expect(keys.every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
   expect(keys[0]).not.toBe(keys[1]); expect(keys[2]).toBe(keys[0]);
   expect(m.cachePut.mock.calls.map(([key]) => key)).toEqual(keys.slice(0, 2));
   expect(m.execute).toHaveBeenCalledTimes(2); expect(m.paid).not.toHaveBeenCalled();
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
 expect(m.quota).toHaveBeenCalledTimes(17);
 expect(m.quota.mock.calls.filter(([scope]) => scope.provider === 'glm')).toHaveLength(1);
 expect(first.providers.find(p => p.id === 'glm47')?.usage).toEqual(first.providers.find(p => p.id === 'glm45')?.usage);
 await freeChainAdminView(); expect(m.quota).toHaveBeenCalledTimes(34); expect(m.controls).toHaveBeenCalledTimes(2); expect(m.spend).toHaveBeenCalledTimes(2);
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
 it('storage failure produces a nonblank stream with no external call',async()=>{vi.stubEnv('FREE_CHAIN_ENABLED','on');m.db.mockReturnValue(null);const onChunk=vi.fn();const result=await maybeFreeChain({...input(),onChunk});expect(onChunk).toHaveBeenCalledWith(result?.content, 'notice');expect(m.execute).not.toHaveBeenCalled();});
 it.each([['2m59.56s',179560],['1h',3600000],['bad',86400000],[undefined,86400000]])('parses reset duration %s', (value,expected)=>{expect(durationMs(value as string|undefined,86400000)).toBe(expected);});
});


describe('admin budget view and explicit CAS mutation', () => {
 const action = { capUsd: 0.29, expectedRevision: 3, reason: 'Deliberate bounded budget change' };
 it('shows actual shared authority rather than a higher local deployment cap, without any observation write', async () => {
  vi.stubEnv('FREE_CHAIN_PAID_DAILY_CAP_USD', '10'); m.spend.mockResolvedValue({ available: true, capNanoUsd: 0, policyRevision: 9, heldNanoUsd: 3e9, spentNanoUsd: 1e9 });
  expect((await freeChainAdminView()).paid).toEqual({ budgetMode: 'capped', policyState: 'initialized', capUsd: 0, configuredCapUsd: 10, policyRevision: 9, reservedUsd: 3, reportedUsd: 1 });
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

describe('CheaperInference supplier-charge settlement', () => {
 function setup() {
  vi.stubEnv('CHEAPERINFERENCE', 'admin'); vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'ci_live_test_key');
  m.paid.mockResolvedValue({ id: 'receipt-hold', day: 'original-day', uidHash: 'u', maxCostNanoUsd: 1000000, createdAt: 0, mayDispatch: true });
  m.settle.mockResolvedValue(true);
  const cfg = freeChainConfig({ FREE_CHAIN_ENABLED: 'on', FREE_CHAIN_ROLLOUT_PERCENT: '100', FREE_CHAIN_ORDER: 'cheapinf', CHEAPERINFERENCE: 'admin', CHEAPERINFERENCE_API_KEY: 'ci_live_test_key', FREE_CHAIN_MONTHLY_CAP_ENABLED: 'off' });
  return () => buildFreeChainRouter(db, cfg).route({ ...input(), context: { ...input().context, isAdmin: true } });
 }
 it.each(['0', '0.001234567', '1.000000001'])('uses actual receipt %s rather than token estimate', async amount => {
  const run = setup();
  m.execute.mockImplementation(async (arg, cfg) => ({ ...await successful()(arg,cfg), supplierChargeUsd: amount }));
  expect((await run()).ok).toBe(true);
  const [whole,fraction=''] = amount.split('.');
  expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ day: 'original-day' }), Number(BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'))));
 });
 it.each([undefined, 'unknown', '9007199254740992', '-1'])('keeps unknown/unrepresentable receipt %s held despite complete tokens', async amount => {
  const run=setup(); m.execute.mockImplementation(async (arg,cfg) => ({ ...await successful()(arg,cfg), supplierChargeUsd: amount }));
  expect((await run()).ok).toBe(true); expect(m.settle).not.toHaveBeenCalled();
 });
 it.each(['TIMEOUT','NETWORK','EMPTY_RESPONSE'] as const)('retains unknown hold on %s', async code => {
  const run=setup(); m.execute.mockRejectedValue(new FreeChainProviderError(code));
  expect((await run()).ok).toBe(false); expect(m.settle).not.toHaveBeenCalled(); expect(m.execute).toHaveBeenCalledOnce();
 });
 it('accounts an evidenced charged failure without retry', async () => {
  const run=setup(); m.execute.mockRejectedValue(new FreeChainProviderError('EMPTY_RESPONSE', { supplierChargeUsd: '0.000004' }));
  expect((await run()).ok).toBe(false); expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.anything(),4000); expect(m.execute).toHaveBeenCalledOnce();
 });
 it('does not dispatch or settle a duplicate admission', async () => {
  const run=setup(); m.paid.mockResolvedValue({ id:'receipt-hold',mayDispatch:false });
  expect((await run()).ok).toBe(false);expect(m.execute).not.toHaveBeenCalled();expect(m.settle).not.toHaveBeenCalled();
 });
});

it.each(['0.000005', undefined])('uses the same supplier evidence for monthly settlement: %s', async amount => {
 vi.stubEnv('CHEAPERINFERENCE','admin');vi.stubEnv('CHEAPERINFERENCE_API_KEY','ci_live_test_key');
 m.paid.mockResolvedValue({id:'monthly-receipt',day:'original-day',uidHash:'u',maxCostNanoUsd:1000000,createdAt:0,mayDispatch:true});m.settle.mockResolvedValue(true);
 m.execute.mockImplementation(async(arg,cfg)=>({...await successful()(arg,cfg),supplierChargeUsd:amount}));
 let record:Record<string,number>={};const writes:Record<string,number>[]=[];
 const ref={collection:(_name:string)=>ref,doc:(_name:string)=>ref};
 const monthDb={doc:(_name:string)=>({policy:true}),collection:(_name:string)=>ref,runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:async(r:any)=>({exists:!r.policy,data:()=>r.policy?undefined:record}),set:(_ref:unknown,data:Record<string,number>)=>{record={...data};writes.push({...data});}})};
 const cfg=freeChainConfig({FREE_CHAIN_ENABLED:'on',FREE_CHAIN_ROLLOUT_PERCENT:'100',FREE_CHAIN_ORDER:'cheapinf',CHEAPERINFERENCE:'admin',CHEAPERINFERENCE_API_KEY:'ci_live_test_key',FREE_CHAIN_MONTHLY_CAP_ENABLED:'on'});
 const result=await buildFreeChainRouter(monthDb as unknown as typeof db,cfg).route({...input(),context:{...input().context,isAdmin:true}});
 expect(result.ok).toBe(true);expect(writes).toHaveLength(2);
 expect(record.spentNanoUsd).toBe(amount===undefined?writes[0].heldNanoUsd:5000);
 expect(record.heldNanoUsd).toBe(0);
 if(amount===undefined)expect(m.settle).not.toHaveBeenCalled();else expect(m.settle).toHaveBeenCalledExactlyOnceWith(expect.anything(),5000);
});

it('does not bench a healthy provider after local quota-lane saturation', async () => {
 const router=buildFreeChainRouter(db,config('groq'));
 m.reserve.mockResolvedValueOnce({allowed:false,reason:'local_capacity',resetAt:Date.now()+60000});
 expect((await router.route(input())).ok).toBe(false);
 expect(m.execute).not.toHaveBeenCalled();expect(m.cooldown).not.toHaveBeenCalled();
 expect(await router.route(input())).toMatchObject({ok:true,provider:'GROQ'});
 expect(m.reserve).toHaveBeenCalledTimes(2);expect(m.execute).toHaveBeenCalledOnce();
});
it('still honors an authoritative RPM reset across subsequent turns', async () => {
 const router=buildFreeChainRouter(db,config('groq'));
 m.reserve.mockResolvedValueOnce({allowed:false,reason:'rpm',resetAt:Date.now()+60000});
 await router.route(input());await router.route(input());
 expect(m.reserve).toHaveBeenCalledOnce();expect(m.execute).not.toHaveBeenCalled();
});
it.each([false,true])('marks token-truncated answers incomplete and never caches or provider-hops (stream=%s)',async streaming=>{
 const cfg=config();cfg.cacheEnabled=true;
 m.execute.mockImplementationOnce(async(arg,adapter)=>({...await successful('partial')(arg,adapter),finishReason:'length'}));
 const chunks:string[]=[];
 const result=await buildFreeChainRouter(db,cfg).route({...input(),message:'what is photosynthesis',context:{...input().context,cacheEligible:true},...(streaming?{onChunk:(s:string)=>chunks.push(s)}:{})});
 expect(result.reason).toBe('stalled');expect(result.freeChain?.attempts[0].reason).toBe('truncated');
 expect(result.content).toContain('partial');if(!streaming)expect(result.content).toContain('interrupted');
 expect(m.execute).toHaveBeenCalledOnce();expect(m.cacheGet).toHaveBeenCalledOnce();expect(m.cachePut).not.toHaveBeenCalled();expect(m.cooldown).not.toHaveBeenCalled();
 if(streaming)expect(chunks).toEqual(['partial']);
});
it('continues caching complete stop-finished responses',async()=>{
 const cfg=config('groq');cfg.cacheEnabled=true;
 m.execute.mockImplementationOnce(async(arg,adapter)=>({...await successful('complete')(arg,adapter),finishReason:'stop'}));
 const result=await buildFreeChainRouter(db,cfg).route({...input(),message:'what is photosynthesis',context:{...input().context,cacheEligible:true}});
 expect(result.reason).not.toBe('stalled');expect(result.freeChain?.attempts[0].reason).toBe('served');expect(m.cachePut).toHaveBeenCalledOnce();
});
it.each([true,false])('retains paid accounting for length-finished responses (reported usage=%s)',async reported=>{
 const cfg=config('deepseek');cfg.deepseekPrices={input:0.3,output:1.2};
 const reservation={id:'length-paid',day:'d',uidHash:'u',maxCostNanoUsd:100000,createdAt:0,mayDispatch:true};m.paid.mockResolvedValue(reservation);
 m.execute.mockImplementationOnce(async(arg,adapter)=>({...await successful('partial')(arg,adapter),finishReason:'length',completeUsage:reported,...(!reported?{usage:undefined}:{})}));
 const result=await buildFreeChainRouter(db,cfg).route(input());expect(result.reason).toBe('stalled');expect(m.execute).toHaveBeenCalledOnce();
 if(reported)expect(m.settle).toHaveBeenCalledExactlyOnceWith(reservation,5400);else expect(m.settle).not.toHaveBeenCalled();
 expect(m.cachePut).not.toHaveBeenCalled();expect(m.cooldown).not.toHaveBeenCalled();
});
it.each(['released','cancelled','disabled'] as const)('waits only for pre-reservation provider capacity: %s',async mode=>{
 const cfg=config('glm45');cfg.concurrency.glm45=1;
 let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});
 m.execute.mockImplementationOnce(async(arg,adapter)=>{await hold;return successful('first')(arg,adapter);});
 const router=buildFreeChainRouter(db,cfg);
 const first=router.route({...input(),context:{...input().context,uid:'first'}});
 await vi.waitFor(()=>expect(m.execute).toHaveBeenCalledOnce());
 const abort=new AbortController();let settled=false;
 const second=router.route({...input(),signal:abort.signal,context:{...input().context,uid:'second'}}).then(r=>{settled=true;return r;});
 await new Promise(r=>setTimeout(r,10));expect(settled).toBe(false);expect(m.reserve).toHaveBeenCalledOnce();
 if(mode==='cancelled')abort.abort();if(mode==='disabled')applySwitchedOff(['glm']);
 release();await first;const result=await second;
 if(mode==='released'){expect(result.ok).toBe(true);expect(m.reserve).toHaveBeenCalledTimes(2);expect(m.execute).toHaveBeenCalledTimes(2);}
 else{expect(result.ok).toBe(false);expect(m.reserve).toHaveBeenCalledOnce();expect(m.execute).toHaveBeenCalledOnce();}
});

 describe('admin configuration error contract', () => {
  it.each(['groq,unknown-secret-value', 'groq,groq', 'llama8b,groq'])('rejects invalid order without normalization or storage/inference %s', async order => {
   vi.stubEnv('FREE_CHAIN_ORDER', order);
   await expect(freeChainAdminView()).rejects.toBeInstanceOf(FreeChainConfigurationError);
   expect(freeChainConfig().order.join(',')).toBe(order);
   const wire=JSON.parse(JSON.stringify(freeChainConfigurationErrorResponse()));
   expect(isFreeChainConfigurationErrorResponse(wire)).toBe(true);expect(isFreeChainAdminView(wire)).toBe(false);
   expect(JSON.stringify(wire)).not.toContain(order);
   for (const f of [m.db,m.controls,m.quota,m.spend,m.execute,m.registry,m.setBudget,m.observeBudget,m.set]) expect(f).not.toHaveBeenCalled();
  });
  it('serializes a valid OFF snapshot without treating OFF or missing policy as corruption', async () => {
   vi.stubEnv('FREE_CHAIN_ENABLED','off');vi.stubEnv('FREE_CHAIN_ORDER','groq,cloudflare');
   m.controls.mockResolvedValue({enabled:false,rolloutPercent:0,disabledProviders:['gemini','geminipaid']});
   m.spend.mockResolvedValue({available:false,capNanoUsd:null,policyRevision:null,heldNanoUsd:0,spentNanoUsd:0});
   const wire=JSON.parse(JSON.stringify(await freeChainAdminView()));
   expect(isFreeChainAdminView(wire)).toBe(true);expect(wire.enabled).toBe(false);expect(wire.runtimeEnabled).toBe(false);
   expect(wire.providers.find((p:any)=>p.id==='gemini').disabled).toBe(true);
   expect(m.execute).not.toHaveBeenCalled();expect(m.setBudget).not.toHaveBeenCalled();expect(m.observeBudget).not.toHaveBeenCalled();
  });
 });
