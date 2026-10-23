import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVAL_CONFIRMATION, EVAL_UID, FREE_CHAIN_EVAL_PROMPTS, MAX_RESPONSE_CHARS, liveEvalBlockers, measuredRow, runFreeChainEval } from '../scripts/freeChainEval';
import type { FreeChainInput, FreeChainResult } from '../src/server/AI/FreeChain/runtime';
import { strictFreeRequired } from '../src/server/AI/inferencePolicy';
import { PROVIDER_IDS } from '../src/server/AI/FreeChain/config';

const defaultMocks = vi.hoisted(() => {
  const app = { name: 'synthetic-eval-app' };
  const db = { settings: vi.fn(), terminate: vi.fn(async () => {}) };
  return { app, db, initializeApp: vi.fn(() => app), deleteApp: vi.fn(async () => {}), getFirestore: vi.fn(() => db), setServerDb: vi.fn(), maybeFreeChain: vi.fn(async (_input: FreeChainInput) => null) };
});
vi.mock('firebase-admin/app', () => ({ initializeApp: defaultMocks.initializeApp, deleteApp: defaultMocks.deleteApp }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: defaultMocks.getFirestore }));
vi.mock('../src/server/lib/serverDb', () => ({ setServerDb: defaultMocks.setServerDb }));
vi.mock('../src/server/AI/FreeChain/runtime', () => ({ maybeFreeChain: defaultMocks.maybeFreeChain }));

const authorizedEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development', FREE_CHAIN_EVAL_CONFIRM: EVAL_CONFIRMATION,
  FREE_CHAIN_EVAL_ACCOUNT_SCOPE: 'exclusive-non-production', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FREE_CHAIN_ENABLED: 'true', FREE_CHAIN_ORDER: 'groq,cloudflare,openrouter',
  FREE_CHAIN_PAID_DAILY_CAP_USD: '0', STRICT_FREE_MODULES_ENABLED: 'false',
});
const answer = (over: Partial<FreeChainResult> = {}): FreeChainResult => ({
  ok: true, content: 'A public synthetic answer.', provider: 'GROQ', model: 'openai/gpt-oss-120b', latencyMs: 12, ...over,
});
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK PROHIBITED'); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('public multilingual corpus', () => {
  it('has exactly 30 unique fixed prompts balanced across three languages and four categories', () => {
    expect(FREE_CHAIN_EVAL_PROMPTS).toHaveLength(30);
    expect(new Set(FREE_CHAIN_EVAL_PROMPTS.map(p => p.id)).size).toBe(30);
    for (const lang of ['hi', 'hinglish', 'en']) {
      const rows = FREE_CHAIN_EVAL_PROMPTS.filter(p => p.language === lang);
      expect(rows).toHaveLength(10);
      for (const category of ['summarization', 'factual', 'reasoning']) expect(rows.filter(p => p.category === category)).toHaveLength(3);
      expect(rows.filter(p => p.category === 'refusal')).toHaveLength(1);
    }
    expect(FREE_CHAIN_EVAL_PROMPTS.every(p => p.prompt.length > 10 && p.humanRubric.length > 10 && Object.isFrozen(p))).toBe(true);
    expect(FREE_CHAIN_EVAL_PROMPTS.filter(p => p.language === 'hi').every(p => /[\u0900-\u097f]/u.test(p.prompt))).toBe(true);
    expect(FREE_CHAIN_EVAL_PROMPTS.filter(p => p.language !== 'hi').every(p => !/[\u0900-\u097f]/u.test(p.prompt))).toBe(true);
    expect(FREE_CHAIN_EVAL_PROMPTS.every(p => !/@|https?:\/\//.test(p.prompt))).toBe(true);
  });
});

describe('fail-closed activation', () => {
  it('never initializes runtime, writes results or requests the network by default, even with live approval env', async () => {
    const loadRuntime = vi.fn(); const checkpoint = vi.fn();
    const result = await runFreeChainEval({ env: authorizedEnv() }, { loadRuntime, checkpoint });
    expect(result.mode).toBe('dry-run'); expect(result.status).toBe('planned');
    expect(result.results.every(r => r.status === 'planned' && r.endToEndLatencyMs === null && r.inputTokens === null && r.invoiceCostUsd === null && r.humanReview.qualityScore === null)).toBe(true);
    expect(loadRuntime).not.toHaveBeenCalled(); expect(checkpoint).not.toHaveBeenCalled();
  });
  it('blocks a live flag without explicit transmission approval', async () => {
    const env = authorizedEnv(); delete env.FREE_CHAIN_EVAL_CONFIRM;
    const loadRuntime = vi.fn();
    expect((await runFreeChainEval({ live: true, env }, { loadRuntime })).status).toBe('blocked');
    expect(loadRuntime).not.toHaveBeenCalled();
  });
  it.each([
    { FREE_CHAIN_EVAL_CONFIRM: 'true' }, { FREE_CHAIN_EVAL_ACCOUNT_SCOPE: 'production' },
    { NODE_ENV: 'production' }, { VITEST: 'true' }, { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
    { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:65536' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:0' }, { FIRESTORE_EMULATOR_HOST: 'https://127.0.0.1:8080' },
    { FREE_CHAIN_ENABLED: 'false' }, { FREE_CHAIN_TTFT_MS: 'broken' },
    { FREE_CHAIN_PAID_DAILY_CAP_USD: '2' }, { FREE_CHAIN_ORDER: 'groq,deepseek' },
    { STRICT_FREE_MODULES_ENABLED: 'true' }, { STRICT_FREE_MODULES_ENABLED: undefined },
    { FREE_CHAIN_CACHE_ENABLED: 'true' },
  ])('rejects unsafe live configuration without loading any runtime: %s', async patch => {
    const loadRuntime = vi.fn();
    const result = await runFreeChainEval({ live: true, env: { ...authorizedEnv(), ...patch } }, { loadRuntime });
    expect(result.status).toBe('blocked'); expect(result.blockers.length).toBeGreaterThan(0); expect(loadRuntime).not.toHaveBeenCalled();
  });
  it('allows only valid loopback emulator addresses and does not force any runtime flags', () => {
    const env = authorizedEnv(); const before = { ...env };
    expect(liveEvalBlockers(env)).toEqual([]); expect(env).toEqual(before);
    expect(liveEvalBlockers({ ...env, FIRESTORE_EMULATOR_HOST: '[::1]:8080' })).toEqual([]);
  });
});

describe('measured results, not invented benchmarks', () => {
  it('leaves missing tokens, TTFT, cost, dispatch and human judgments unavailable', () => {
    const row = measuredRow(FREE_CHAIN_EVAL_PROMPTS[0], answer(), 15);
    expect(row.endToEndLatencyMs).toBe(15);
    for (const key of ['inputTokens', 'outputTokens', 'ttftMs', 'runtimeCostUsdEstimate', 'invoiceCostUsd', 'rungAttempts', 'fallbackCount', 'cacheHit'] as const) expect(row[key]).toBeNull();
    expect(row.humanReview).toMatchObject({ qualityScore: null, languageMatches: null, refusalAppropriate: null, status: 'not-scored' });
  });
  it('preserves real reported zeroes and does not calculate token usage from response length', () => {
    const row = measuredRow(FREE_CHAIN_EVAL_PROMPTS[0], answer({ usage: { inputTokens: 0, outputTokens: 7 }, freeChain: {
      requestId: 'synthetic', provider: 'GROQ', model: 'openai/gpt-oss-120b', rung: 'groq', rolloutBucket: 1,
      attempts: [{ provider: 'groq', model: 'openai/gpt-oss-120b', reason: 'served', entered: true }],
      ttftMs: 4, latencyMs: 12, costUsdEstimate: 0, cacheHit: false, fallbacks: 0,
    } }), 15);
    expect(row).toMatchObject({ inputTokens: 0, outputTokens: 7, ttftMs: 4, runtimeCostUsdEstimate: 0, invoiceCostUsd: null, rungAttempts: 1, fallbackCount: 0 });
  });
  it('retains every configured provider attempt rather than hardcoding a five-rung limit', () => {
    const row = measuredRow(FREE_CHAIN_EVAL_PROMPTS[0], answer({ freeChain: {
      requestId: 'synthetic', provider: 'GROQ', model: 'openai/gpt-oss-120b', rung: 'groq', rolloutBucket: 1,
      attempts: PROVIDER_IDS.map(provider => ({ provider, model: `${provider}-test`, reason: 'unconfigured', entered: false })),
      ttftMs: null, latencyMs: 12, costUsdEstimate: null, cacheHit: false, fallbacks: 0,
    } }), 15);
    expect(row.attempts.map(a => a.provider)).toEqual([...PROVIDER_IDS]);
    expect(row.rungAttempts).toBe(0);
  });
  it('rejects invalid measurements and distinguishes refusals/partial streams from transport completion', () => {
    const row = measuredRow(FREE_CHAIN_EVAL_PROMPTS[0], answer({ reason: 'stalled', usage: { inputTokens: NaN, outputTokens: -1 } }), Infinity);
    expect(row.status).toBe('interrupted'); expect(row.inputTokens).toBeNull(); expect(row.outputTokens).toBeNull(); expect(row.endToEndLatencyMs).toBeNull();
    expect(row.humanReview.refusalAppropriate).toBeNull();
    expect(measuredRow(FREE_CHAIN_EVAL_PROMPTS[0], null, 3)).toMatchObject({ status: 'not-selected', provider: null, responseText: null });
    expect(measuredRow(FREE_CHAIN_EVAL_PROMPTS[0], answer({ ok: false, provider: 'NONE', content: 'busy' }), 3)).toMatchObject({ status: 'failed', responseText: null });
  });
  it('bounds and redacts response text and exact configured credentials', () => {
    const secret = 'synthetic-configured-credential';
    const row = measuredRow(FREE_CHAIN_EVAL_PROMPTS[0], answer({ content: `${secret} person@example.test Bearer abc123456789 ${'hello '.repeat(3000)}` }), 1, [secret]);
    expect(row.responseText!.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(row.responseText).not.toContain(secret); expect(row.responseText).not.toContain('person@example.test'); expect(row.responseText).not.toContain('abc123456789');
    expect(row.responseModified).toBe(true);
  });
  it('sends only the fixed public corpus through the provided runtime seam, preserving skipped results', async () => {
    const route = vi.fn(async (_input: FreeChainInput) => null); const close = vi.fn(async () => {}); const checkpoint = vi.fn();
    const result = await runFreeChainEval({ live: true, env: authorizedEnv() }, { loadRuntime: async () => ({ route, close }), checkpoint });
    expect(route).toHaveBeenCalledTimes(30); expect(close).toHaveBeenCalledOnce();
    expect(result.results.every(r => r.status === 'not-selected' && r.inputTokens === null)).toBe(true);
    for (const [index, call] of route.mock.calls.entries()) {
      expect(call[0]).toMatchObject({ message: FREE_CHAIN_EVAL_PROMPTS[index].prompt, history: [], context: { uid: EVAL_UID, privateTurn: false, healthTurn: false, cacheEligible: true } });
    }
    expect(result.status).toBe('finished'); expect(checkpoint).toHaveBeenCalled();
  });
  it('stops on uncertain errors without retrying or persisting an SDK error/body/credential', async () => {
    const route = vi.fn(async () => { throw new Error('SECRET_PROVIDER_ERROR_AND_PROMPT'); }); const close = vi.fn(async () => {});
    const result = await runFreeChainEval({ live: true, env: authorizedEnv() }, { loadRuntime: async () => ({ route, close }) });
    expect(route).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(result.status).toBe('blocked');
    expect(result.results[0].status).toBe('unavailable'); expect(result.results.slice(1).every(r => r.status === 'planned')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SECRET_PROVIDER_ERROR_AND_PROMPT');
  });
});


describe('real runtime entrypoint wiring with offline SDK mocks', () => {
  it('uses an explicitly named demo emulator app and the real free-modules scope, without bypassing maybeFreeChain', async () => {
    for (const [key, value] of Object.entries(authorizedEnv())) vi.stubEnv(key, value);
    vi.stubEnv('VITEST', '');
    vi.stubEnv('FREE_CHAIN_CACHE_ENABLED', 'false');
    defaultMocks.maybeFreeChain.mockImplementation(async () => {
      // This would be false outside the actual request scope, even with the strict flag true.
      expect(strictFreeRequired({ STRICT_FREE_MODULES_ENABLED: 'true' })).toBe(true);
      return null;
    });
    const result = await runFreeChainEval({ live: true });
    expect(result.status).toBe('finished');
    expect(defaultMocks.initializeApp).toHaveBeenCalledWith({ projectId: 'demo-free-chain-eval' }, expect.stringMatching(/^free-chain-eval-/));
    expect(defaultMocks.getFirestore).toHaveBeenCalledWith(defaultMocks.app, '(default)');
    expect(defaultMocks.maybeFreeChain).toHaveBeenCalledTimes(30);
    expect(defaultMocks.setServerDb).toHaveBeenNthCalledWith(1, defaultMocks.db);
    expect(defaultMocks.setServerDb).toHaveBeenLastCalledWith(null);
    expect(defaultMocks.db.terminate).toHaveBeenCalledOnce();
    expect(defaultMocks.deleteApp).toHaveBeenCalledWith(defaultMocks.app);
  });
  it('never initializes even mocked Firebase or the provider runtime on default dry-run', async () => {
    await runFreeChainEval();
    expect(defaultMocks.initializeApp).not.toHaveBeenCalled();
    expect(defaultMocks.getFirestore).not.toHaveBeenCalled();
    expect(defaultMocks.maybeFreeChain).not.toHaveBeenCalled();
  });
});
