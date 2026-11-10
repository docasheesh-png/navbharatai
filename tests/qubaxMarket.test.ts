import { describe, expect, it } from 'vitest';
import { canonicalModelLabel, dueQubaxProbe, emptyProbeLedger, qubaxModelOverride, qubaxRequestCeilingNanoUsd, rankQubaxMarkets, type QubaxObservedPrice, type QubaxProbeLedger } from '../src/server/lib/qubaxMarket';
import { qubaxProbeAnswerSane, qubaxProbePrompt } from '../src/server/lib/qubaxProbe';

const NOW = Date.parse('2026-11-10T02:00:00Z');
const row = (sourceModelLabel: string, inputNanoUsd: number | null, outputNanoUsd: number | null, contextTokens: number | null = 8_000, discountHundredths: number | null = 9_900, requests24h: number | null = 100): QubaxObservedPrice => ({
  sourceModelLabel, modality: 'text', contextTokens, contextBand: 'unspecified', serviceTier: 'standard', currency: 'USD', billingBasis: 'per-million-tokens',
  inputNanoUsd, outputNanoUsd, cacheReadNanoUsd: null, cacheWrite30mNanoUsd: null, cacheWrite12hNanoUsd: null, cacheStorage: 'unknown',
  discountHundredths, requests24h, revision: null, tokenizer: null, sku: null, region: null, allFeesIncluded: null,
});
function ledger(ids: string[], latency: Record<string, number> = {}, success = 2): QubaxProbeLedger {
  const base = emptyProbeLedger(NOW);
  for (const id of ids) base.models[id] = { attempts: success, successes: success, hindi: { ok: true, latencyMs: latency[id] ?? 100, atMs: NOW - 1_000 }, english: { ok: true, latencyMs: latency[id] ?? 100, atMs: NOW - 1_000 } };
  return base;
}
const plan = (qubax: QubaxObservedPrice[], models: QubaxProbeLedger | null, pin = '') => rankQubaxMarkets({
  rows: qubax, expiresAtMs: NOW + 60_000, ledger: models, now: NOW,
  override: pin ? { mode: 'pinned', modelId: pin } : { mode: 'auto' },
});

describe('Qubax discount, then probe performance, then the cheaper model', () => {
  it('uses the Qubax discount and ignores a nearby name', () => {
    expect(canonicalModelLabel('GPT-5.4 (<272K context length)')).toBe('gpt-5.4');
    expect(canonicalModelLabel('gpt-4o-mini')).not.toBe(canonicalModelLabel('gpt-4o'));
    const qubax = [
      row('glm-5.3', 400, 800, 8_000, 9_500, 10),
      row('gpt-4o-mini', 100, 200, 8_000, 9_900, 10),
      row('nearby-model', 100, 200, 8_000, 8_900, 10_000),
    ];
    const ranked = plan(qubax, ledger(['glm-5.3', 'gpt-4o-mini', 'nearby-model'], { 'glm-5.3': 50, 'gpt-4o-mini': 400 }));
    expect(ranked.eligible.map(item => item.modelId)).toEqual(['glm-5.3', 'gpt-4o-mini']);
    expect(ranked.eligible[0].discountBps).toBeGreaterThanOrEqual(9_000);
    expect(ranked.backup).toBeNull();
  });
  it('keeps a model under 90% out of the ranking', () => {
    expect(plan([row('gpt-4o-mini', 100, 101, 8_000, 8_999, 100)], ledger(['gpt-4o-mini'])).eligible).toEqual([]);
  });
  it('does not pick an unused model until a probe passes', () => {
    const unused = row('gpt-oss-20b', 100, 100, 8_000, 9_995, 0);
    const used = row('gemini-3-5-flash', 11_200_000, 67_400_000, 1_000_000, 9_925, 35_946);
    expect(plan([unused, used], emptyProbeLedger(NOW)).eligible.map(item => item.modelId)).toEqual(['gemini-3-5-flash']);
    expect(plan([unused], ledger(['gpt-oss-20b'])).eligible.map(item => item.modelId)).toEqual(['gpt-oss-20b']);
  });
  it('ranks a higher-success model ahead of a cheaper one, and the cheaper one on a tie', () => {
    const models = ledger(['gpt-4o-mini', 'glm-5.3'], { 'gpt-4o-mini': 50, 'glm-5.3': 900 }, 4);
    models.models['glm-5.3'].successes = 4;
    models.models['gpt-4o-mini'].successes = 3;
    const ranked = plan([row('gpt-4o-mini', 10, 10), row('glm-5.3', 400, 800)], models);
    expect(ranked.eligible.map(item => item.modelId)).toEqual(['glm-5.3', 'gpt-4o-mini']);
    const tied = ledger(['cheap', 'dear'], { cheap: 100, dear: 100 });
    expect(plan([row('dear', 100, 900), row('cheap', 100, 100)], tied).eligible.map(item => item.modelId)).toEqual(['cheap', 'dear']);
  });
  it('excludes a model whose one try would exceed the two-cent cap', () => {
    const expensive = row('huge', 1_000_000_000, 100_000_000_000, 8_000, 9_900, 50);
    expect(plan([expensive], ledger(['huge'])).eligible).toEqual([]);
  });
  it('uses the pinned model only when nothing clears 90%', () => {
    const qubax = [row('backup-model', 900, 900, 8_000, 1_000, 5), row('gpt-4o', 900, 900, 8_000, 1_000, 5)];
    const models = ledger(['backup-model', 'gpt-4o']);
    expect(plan(qubax, models, 'backup-model').backup?.modelId).toBe('backup-model');
    expect(plan(qubax, models, 'backup-model').eligible).toEqual([]);
    const qualified = [row('backup-model', 900, 900, 8_000, 1_000, 5), row('gpt-4o', 100, 100, 8_000, 9_500, 5)];
    expect(plan(qualified, models, 'backup-model').eligible[0].modelId).toBe('gpt-4o');
    expect(plan(qualified, models, 'backup-model').backup).toBeNull();
  });
  it('probes a discounted model before one under 90%', () => {
    const qubax = [row('cheap-unproven', 1, 1, 8_000, 5_000, 9), row('glm-5.3', 400, 800, 8_000, 9_500, 3)];
    expect(dueQubaxProbe(qubax, [], emptyProbeLedger(NOW), NOW)?.modelId).toBe('glm-5.3');
  });
  it('accepts a probe only when the unique code comes back intact', () => {
    const prompt = qubaxProbePrompt('en', 'QXabc123');
    expect(prompt).toContain('QXabc123');
    expect(qubaxProbePrompt('hi', 'QXabc123')).toContain('QXabc123');
    expect(qubaxProbeAnswerSane('कोड QXabc123', 'QXabc123', 'hi')).toBe(true);
    expect(qubaxProbeAnswerSane('code QXabc123', 'QXabc123', 'en')).toBe(true);
    expect(qubaxProbeAnswerSane('QXabc123', 'QXabc123', 'hi')).toBe(false);
    expect(qubaxProbeAnswerSane('कोड QXabc123', 'QXabc123', 'en')).toBe(false);
    expect(qubaxProbeAnswerSane('hello', 'QXabc123')).toBe(false);
    expect(qubaxProbeAnswerSane('', 'QXabc123')).toBe(false);
  });
  it('uses the built-in two-cent cap unless the operator sets another value', () => {
    expect(qubaxRequestCeilingNanoUsd({ QUBAX_ENABLED: '1', QUBAX_API_KEY: 'synthetic' })).toBe(20_000_000);
    expect(qubaxRequestCeilingNanoUsd({ QUBAX_ENABLED: '1', QUBAX_API_KEY: 'synthetic', QUBAX_MAX_USD_PER_REQUEST: '0.05' })).toBe(50_000_000);
    expect(qubaxRequestCeilingNanoUsd({ QUBAX_ENABLED: '1', QUBAX_API_KEY: 'synthetic', QUBAX_MAX_USD_PER_REQUEST: '1.01' })).toBeNull();
    expect(qubaxModelOverride({})).toEqual({ mode: 'auto' });
    expect(qubaxModelOverride({ QUBAX_MODEL: 'has space' })).toEqual({ mode: 'invalid' });
  });
});
