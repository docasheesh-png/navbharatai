import { describe, it, expect, beforeEach } from 'vitest';
import { realRateFor, realProviderCostUsd, realRateCard } from '../providerRates';
import { proChainV2SupplierRate } from './supplierRates';
import { __setQubaxBuilderCatalogForTests, type QubaxCatalogEntry } from './qubaxBuilder';
import { proChainV2ScopeAsk, normaliseScopeAnswer, type ScopeUsageRow, type ScopeClientFactory } from './scopeAsk';
import { ProChainV2Summary, proChainV2EventLine, supplierCallLine } from './telemetry';
import { ProChainV2Build, roleForRunnerOpts } from './buildContext';

const entry = (id: string, rate?: QubaxCatalogEntry['rate']): QubaxCatalogEntry => ({ id, tools: true, ready: true, contextLength: 1_000_000, maxOutput: 131072, ...(rate ? { rate } : {}) });
beforeEach(() => { __setQubaxBuilderCatalogForTests(null); delete process.env.MITRIFY_BUILDER_RATE_IN; delete process.env.MITRIFY_BUILDER_RATE_OUT; });

describe('Pro Chain V2 billing — real supplier rate, labelled estimate otherwise', () => {
  it('Qubax bills at its own catalogue price when known', () => {
    __setQubaxBuilderCatalogForTests(new Map([['glm-5.3', entry('glm-5.3', { inputPerMTok: 0.009, outputPerMTok: 0.15662 })]]));
    expect(realRateFor('ENGINE_QX', 'glm-5.3')).toEqual({ inputPerMTok: 0.009, outputPerMTok: 0.15662 });
    expect(proChainV2SupplierRate('ENGINE_QX', 'glm-5.3')?.source).toBe('catalog');
    const cost = realProviderCostUsd([{ provider: 'ENGINE_QX', model: 'glm-5.3', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }]);
    expect(cost).toBeCloseTo(0.16562, 6);
  });
  it('Qubax with no known price ⇒ conservative card rate (never zero), source "estimated"', () => {
    expect(proChainV2SupplierRate('ENGINE_QX', 'glm-5.3')).toEqual({ source: 'estimated' });
    const r = realRateFor('ENGINE_QX', 'glm-5.3');
    expect(r).toEqual(realRateCard()['glm-5']);
    expect(r.inputPerMTok).toBeGreaterThan(0);
    expect(realRateFor('ENGINE_QX', 'some-unknown-model').inputPerMTok).toBeGreaterThan(0);
  });
  it('Mitrify: configured real rate, else the Surplus-floor estimate (labelled), never zero', () => {
    expect(proChainV2SupplierRate('ENGINE_MF', 'mitrify/auto-cheap')).toEqual({ rate: { inputPerMTok: 0.15, outputPerMTok: 0.5, cacheReadPerMTok: 0.03 }, source: 'estimated' });
    process.env.MITRIFY_BUILDER_RATE_IN = '0.2'; process.env.MITRIFY_BUILDER_RATE_OUT = '0.8';
    expect(realRateFor('ENGINE_MF', 'x')).toEqual({ inputPerMTok: 0.2, outputPerMTok: 0.8 });
    expect(proChainV2SupplierRate('ENGINE_MF#2', 'x')?.source).toBe('configured');
  });
  it('REGRESSION: every other provider prices exactly as before', () => {
    expect(proChainV2SupplierRate('GLM', 'glm-5.3')).toBeNull();
    expect(realRateFor('GLM', 'glm-4.7-flashx')).toEqual(realRateCard()['glm-4.7-flashx']);
    expect(realRateFor('KIMI', 'kimi-k2.7-code')).toEqual(realRateCard()['kimi-k2.7']);
    expect(() => realRateFor('SURPLUS', 'glm-5.3')).toThrow();
    expect(() => realRateFor('ENGINE_R1', 'deepseek-v4.1-flash')).toThrow();
  });
});

describe('Pro Chain V2 scope classifier (Qubax → Mitrify, no GLM)', () => {
  const env = { QUBAX_API_KEY: 'qbx_live_KEYKEYKEYKEY1', MITRIFY_API_KEY: 'mtf_live_KEYKEYKEYKEY2', MITRIFY_BUILDER_MODEL: 'glm-5.3' };
  it('normalises the one word; buffers usage under the right label instead of returning it as GLM usage', async () => {
    const buffer: ScopeUsageRow[] = [];
    const seen: string[] = [];
    const factory: ScopeClientFactory = (_k, base) => async (body) => { seen.push(`${base}|${body.model}`); return { choices: [{ message: { content: 'Complex.' } }], usage: { prompt_tokens: 40, completion_tokens: 1 } }; };
    const ask = proChainV2ScopeAsk({ buffer, env, factory });
    const out = await ask('sys', 'build a todo app', new AbortController().signal);
    expect(out).toEqual({ text: 'complex' });
    expect('usage' in out).toBe(false);
    expect(seen).toEqual(['https://api.qubax.ai/v1|qwen3-235b-a22b-2507']);
    expect(buffer).toEqual([{ provider: 'ENGINE_QX', model: 'qwen3-235b-a22b-2507', estimated: false, usage: { inputTokens: 40, outputTokens: 1 } }]);
  });
  it('Qubax failure ⇒ Mitrify; failure details redacted; no usage ⇒ estimated row', async () => {
    const buffer: ScopeUsageRow[] = [];
    const fails: string[] = [];
    const factory: ScopeClientFactory = (_k, base) => async () => {
      if (base.includes('qubax')) throw Object.assign(new Error('boom qbx_live_KEYKEYKEYKEY1'), { status: 503 });
      return { choices: [{ message: { content: 'simple' } }] };
    };
    const out = await proChainV2ScopeAsk({ buffer, env, factory, onFailure: (p, d) => fails.push(`${p}:${d}`) })('s', 'u', new AbortController().signal);
    expect(out.text).toBe('simple');
    expect(buffer[0]).toMatchObject({ provider: 'ENGINE_MF', estimated: true });
    expect(fails[0]).toContain('ENGINE_QX');
    expect(fails[0]).toContain('503');
    expect(fails.join()).not.toContain('KEYKEYKEY');
  });
  it('nothing configured ⇒ throws (the classifier reports unavailable, as with GLM unset)', async () => {
    await expect(proChainV2ScopeAsk({ buffer: [], env: {} })('s', 'u', new AbortController().signal)).rejects.toThrow('scope classifier unavailable');
    expect(normaliseScopeAnswer('**Strong**')).toBe('strong');
    expect(normaliseScopeAnswer('maybe')).toBe('maybe');
  });
});

describe('Pro Chain V2 report', () => {
  it('summary counts per agent, fallbacks, drops, failures, rate sources and estimated turns', () => {
    const s = new ProChainV2Summary('test-profile');
    s.add({ kind: 'provider-used', agent: 'writer#1', provider: 'ENGINE_QX', fellBackFrom: ['ENGINE_R1'], sticky: false });
    s.addSurplusTurn('builder#1');
    s.add({ kind: 'surplus-dropped', agent: 'writer#1', reason: 'mid_build_transport' });
    s.addCall({ provider: 'ENGINE_R1', ok: false, latencyMs: 5, status: 503 });
    s.addCall({ provider: 'ENGINE_QX', model: 'glm-5.3', ok: true, latencyMs: 9, usageEstimated: true }, 'catalog');
    expect(s.snapshot()).toEqual({
      reason: 'test-profile', agents: { 'writer#1': { ENGINE_QX: 1 }, 'builder#1': { SURPLUS: 1 } }, fallbackTurns: 1, surplusDrops: 1,
      failedCalls: { ENGINE_R1: 1 }, rateSources: { 'ENGINE_QX:glm-5.3': 'catalog' }, usageEstimatedTurns: { ENGINE_QX: 1 },
    });
  });
  it('lines are admin facts; a quiet success writes nothing', () => {
    expect(supplierCallLine({ provider: 'ENGINE_QX', ok: true, latencyMs: 1 })).toBeNull();
    expect(supplierCallLine({ provider: 'ENGINE_MF', ok: false, latencyMs: 12, status: 429, code: 'rate_limit', model: 'm', message: 'slow down' })?.message)
      .toBe('[v2] ENGINE_MF call failed (status=429 · code=rate_limit · latency=12ms · model=m)');
    expect(proChainV2EventLine({ kind: 'provider-used', agent: 'a', provider: 'ENGINE_R1', fellBackFrom: [], sticky: false })).toBeNull();
  });
  it('the build context buffers lines until the report exists, then caps them', () => {
    const b = new ProChainV2Build('test-profile', {});
    for (let i = 0; i < 400; i += 1) b.report({ phase: 'provider', severity: 'info', code: 'X', message: `m${i}`, autoResolved: true });
    const got: string[] = [];
    b.attachReport((l) => got.push(l.message));
    expect(got[0]).toBe('m0');
    expect(got.length).toBe(50); // only the first 50 are buffered before a report exists
    for (let i = 0; i < 400; i += 1) b.report({ phase: 'provider', severity: 'info', code: 'Y', message: `n${i}`, autoResolved: true });
    expect(got.length).toBe(250); // hard cap per build
    expect(roleForRunnerOpts({ plan: true })).toBe('planner');
    expect(roleForRunnerOpts({ heal: true })).toBe('healer');
    expect(roleForRunnerOpts({ afterLeadRung: true, heal: true })).toBe('retry');
    expect(roleForRunnerOpts({ fromProvider: 'CLAUDE' })).toBe('escalation');
    expect(roleForRunnerOpts({})).toBe('builder');
  });
});
