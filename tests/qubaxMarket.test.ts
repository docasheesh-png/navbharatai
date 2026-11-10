import { describe, expect, it } from 'vitest';
import { canonicalModelLabel, dueQubaxProbe, emptyProbeLedger, qubaxModelOverride, qubaxRequestCeilingNanoUsd, rankQubaxMarkets, type QubaxObservedPrice, type QubaxProbeLedger } from '../src/server/lib/qubaxMarket';
import { qubaxProbeAnswerSane, qubaxProbePrompt } from '../src/server/lib/qubaxProbe';

const NOW = Date.parse('2026-11-10T02:00:00Z');
const row = (sourceModelLabel: string, inputNanoUsd: number | null, outputNanoUsd: number | null, contextTokens: number | null = 8_000): QubaxObservedPrice => ({
  sourceModelLabel, modality: 'text', contextTokens, contextBand: 'unspecified', serviceTier: 'standard', currency: 'USD', billingBasis: 'per-million-tokens',
  inputNanoUsd, outputNanoUsd, cacheReadNanoUsd: null, cacheWrite30mNanoUsd: null, cacheWrite12hNanoUsd: null, cacheStorage: 'unknown',
  revision: null, tokenizer: null, sku: null, region: null, allFeesIncluded: null,
});
function ledger(ids: string[], latency: Record<string, number> = {}, success = 2): QubaxProbeLedger {
  const base = emptyProbeLedger(NOW);
  for (const id of ids) base.models[id] = { attempts: success, successes: success, hindi: { ok: true, latencyMs: latency[id] ?? 100, atMs: NOW - 1_000 }, english: { ok: true, latencyMs: latency[id] ?? 100, atMs: NOW - 1_000 } };
  return base;
}
const plan = (qubax: QubaxObservedPrice[], official: QubaxObservedPrice[], models: QubaxProbeLedger, pin = '') => rankQubaxMarkets({
  rows: qubax, officialRows: official, expiresAtMs: NOW + 60_000, ledger: models, now: NOW,
  override: pin ? { mode: 'pinned', modelId: pin } : { mode: 'auto' },
});

describe('same-model 90% discount, then probe performance', () => {
  it('matches the official label exactly and ignores a nearby name and a self-reported discount', () => {
    expect(canonicalModelLabel('GPT-5.4 (<272K context length)')).toBe('gpt-5.4');
    expect(canonicalModelLabel('gpt-4o-mini')).not.toBe(canonicalModelLabel('gpt-4o'));
    const official = [row('gpt-4o-mini', 1_000, 2_000), row('gpt-4o', 10_000, 20_000), row('GLM-5.3', 5_000, 10_000)];
    const qubax = [row('gpt-4o-mini', 100, 200), row('gpt-4o', 9_000, 19_000), row('glm-5.3', 400, 800)];
    const ranked = plan(qubax, official, ledger(['gpt-4o-mini', 'gpt-4o', 'glm-5.3'], { 'glm-5.3': 50, 'gpt-4o-mini': 400 }));
    expect(ranked.eligible.map(item => item.modelId)).toEqual(['glm-5.3', 'gpt-4o-mini']);
    expect(ranked.eligible[0].discountBps).toBeGreaterThanOrEqual(9_000);
    expect(ranked.backup).toBeNull();
  });
  it('keeps a model that is only 89% cheaper out of the performance ranking', () => {
    const official = [row('gpt-4o-mini', 1_000, 1_000)];
    const ranked = plan([row('gpt-4o-mini', 100, 101)], official, ledger(['gpt-4o-mini']));
    expect(ranked.eligible).toEqual([]);
  });
  it('ranks a slower higher-success model ahead of a cheaper faster one', () => {
    const official = [row('gpt-4o-mini', 1_000, 2_000), row('glm-5.3', 5_000, 10_000)];
    const models = ledger(['gpt-4o-mini', 'glm-5.3'], { 'gpt-4o-mini': 50, 'glm-5.3': 900 }, 4);
    models.models['glm-5.3'].successes = 4;
    models.models['gpt-4o-mini'].successes = 3;
    const ranked = plan([row('gpt-4o-mini', 10, 10), row('glm-5.3', 400, 800)], official, models);
    expect(ranked.eligible.map(item => item.modelId)).toEqual(['glm-5.3', 'gpt-4o-mini']);
  });
  it('uses the pinned model only when nothing clears the official discount', () => {
    const official = [row('gpt-4o', 1_000, 1_000)];
    const qubax = [row('backup-model', 900, 900), row('gpt-4o', 900, 900)];
    const models = ledger(['backup-model', 'gpt-4o']);
    expect(plan(qubax, official, models, 'backup-model').backup?.modelId).toBe('backup-model');
    expect(plan(qubax, official, models, 'backup-model').eligible).toEqual([]);
    const qualified = [row('backup-model', 900, 900), row('gpt-4o', 100, 100)];
    expect(plan(qualified, official, models, 'backup-model').eligible[0].modelId).toBe('gpt-4o');
    expect(plan(qualified, official, models, 'backup-model').backup).toBeNull();
  });
  it('probes an eligible model before a cheaper model that cannot clear 90%', () => {
    const official = [row('glm-5.3', 5_000, 10_000), row('gpt-4o-mini', 100, 100)];
    const qubax = [row('cheap-unproven', 1, 1), row('glm-5.3', 400, 800), row('gpt-4o-mini', 90, 90)];
    expect(dueQubaxProbe(qubax, official, emptyProbeLedger(NOW), NOW)?.modelId).toBe('glm-5.3');
  });
  it('accepts a probe only when the unique code comes back intact', () => {
    const prompt = qubaxProbePrompt('en', 'QXabc123');
    expect(prompt).toContain('QXabc123');
    expect(qubaxProbePrompt('hi', 'QXabc123')).toContain('QXabc123');
    expect(qubaxProbeAnswerSane('QXabc123', 'QXabc123')).toBe(true);
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
