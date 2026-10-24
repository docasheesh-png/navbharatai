import { describe, expect, it, vi } from 'vitest';

// Accounting boundary tests use only mocked in-process issued proofs; no paid calls.
const proofRegistry = vi.hoisted(() => new WeakSet<object>());
vi.mock('../AI/SurplusRegistry/receiptPolicy', () => ({
  isSurplusReceiptDecision: (value: unknown) => typeof value === 'object' && value !== null && proofRegistry.has(value),
}));
import type { SurplusReceiptDecision } from '../AI/SurplusRegistry/receiptPolicy';
import { createProviderUsageLedger } from './ProviderUsageLedger';
import { realProviderCostUsd, realRateFor, explainRealCostBuild, SurplusAccountingUnavailableError } from './providerRates';
import { billableEntries, splitUnbilledCost } from './unbilledTurns';

function receipt(callId = 'call-1', actualCostUsd: number | null = 0.01, overrides: Record<string, unknown> = {}): SurplusReceiptDecision {
  const proof = Object.freeze({ accountId: 'account', callId, receiptId: `receipt-${callId}`, modelId: 'model', expenseEvidence: 'provider-reported-actual',
    actualCostUsd: actualCostUsd === null ? null : String(actualCostUsd), userChargeUsd: actualCostUsd === null ? 0 : actualCostUsd * 10,
    status: 'settled', ...overrides });
  proofRegistry.add(proof);
  return proof as unknown as SurplusReceiptDecision;
}
const usage = (surplusReceipt?: SurplusReceiptDecision) => ({ inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 30, surplusReceipt });

describe('Surplus receipt ledger: exact indivisible supplier expense', () => {
  it('keeps same-model calls with different actual prices separate', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(receipt('one', 0.01)), 'model');
    ledger.add('SURPLUS', usage(receipt('two', 0.07)), 'model');
    expect(ledger.entries()).toHaveLength(2);
    expect(realProviderCostUsd(ledger.entries())).toBeCloseTo(0.08);
    expect(ledger.callsByProvider?.()).toEqual({ SURPLUS: 2 });
  });
  it('deduplicates repeated callbacks by account, call and receipt identity', () => {
    const ledger = createProviderUsageLedger();
    const proof = receipt();
    ledger.add('SURPLUS', usage(proof), 'model');
    ledger.add('SURPLUS', usage(proof), 'model');
    expect(ledger.total()).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(ledger.entries()).toHaveLength(1);
    expect(realProviderCostUsd(ledger.entries())).toBe(0.01);
  });
  it.each([
    { actualCostUsd: '0.09' }, { receiptId: 'changed' }, { modelId: 'changed' },
  ])('conflicting callback poisons settlement even when caller catches error: %j', (changes) => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(receipt()), 'model');
    expect(() => ledger.add('SURPLUS', usage(receipt('call-1', 0.01, changes)), 'model')).toThrow(SurplusAccountingUnavailableError);
    expect(() => realProviderCostUsd(ledger.entries())).toThrow(SurplusAccountingUnavailableError);
    expect(ledger.total()).toEqual({ inputTokens: 100, outputTokens: 20 });
  });
  it('detects reused receipt ID across distinct calls but permits separate accounts', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(receipt()), 'model');
    ledger.add('SURPLUS', usage(receipt('call-1', 0.01, { accountId: 'other' })), 'model');
    expect(ledger.entries()).toHaveLength(2);
    expect(() => ledger.add('SURPLUS', usage(receipt('call-2', 0.01, { receiptId: 'receipt-call-1' })), 'model')).toThrow();
  });
  it('copies usage and output rows; retains only an immutable issued decision', () => {
    const ledger = createProviderUsageLedger();
    const u = usage(receipt());
    ledger.add('SURPLUS', u, 'model');
    u.inputTokens = 999;
    ledger.entries()[0].usage.inputTokens = 888;
    expect(ledger.entries()[0].usage.inputTokens).toBe(100);
    expect(Object.isFrozen(ledger.entries()[0].surplusReceipt)).toBe(true);
    expect(realProviderCostUsd(ledger.entries())).toBe(0.01);
  });
  it.each([undefined, null, -1, NaN, Infinity])('missing/invalid actual expense %s never receives a static tariff or zero', (cost) => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(cost === undefined ? undefined : receipt('one', cost)), 'model');
    expect(() => realProviderCostUsd(ledger.entries())).toThrow(SurplusAccountingUnavailableError);
  });
  it('rejects forged/serialized decision objects and model mismatch', () => {
    const proof = receipt();
    for (const candidate of [{ ...proof }, JSON.parse(JSON.stringify(proof)), receipt('two', 0.01, { modelId: 'wrong' })]) {
      const ledger = createProviderUsageLedger();
      ledger.add('SURPLUS', usage(candidate), 'model');
      expect(() => realProviderCostUsd(ledger.entries())).toThrow(SurplusAccountingUnavailableError);
    }
    expect(() => realRateFor('SURPLUS', 'glm-free')).toThrow(SurplusAccountingUnavailableError);
  });
  it.each([{ producedNothing: true }, { discardedOutput: true }])('absorbs a whole call for %j and preserves full expense', (opts) => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(receipt()), 'model', opts);
    const rows = ledger.entries();
    expect(realProviderCostUsd(rows)).toBe(0.01);
    expect(billableEntries(rows)[0].usage).toEqual(rows[0].usage);
    expect(billableEntries(rows)[0].surplusReceipt).toBe(rows[0].surplusReceipt);
    expect(splitUnbilledCost(rows)).toEqual({ realCostUsd: 0.01, billableCostUsd: 0, absorbedCostUsd: 0.01 });
  });
  it('absorbs barren phase whole receipt, not other phases or legacy entries', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(receipt('one', 0.01)), 'model', { phase: 'review' });
    ledger.add('SURPLUS', usage(receipt('two', 0.07)), 'model', { phase: 'build' });
    const split = splitUnbilledCost(ledger.entries(), undefined, new Set(['review']));
    expect(split.realCostUsd).toBeCloseTo(0.08);
    expect(split.billableCostUsd).toBe(0.07);
    expect(split.absorbedCostUsd).toBeCloseTo(0.01);
  });
  it('late partial discard conservatively absorbs whole matching calls without proportional money', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(receipt('one', 0.01)), 'model');
    ledger.add('SURPLUS', usage(receipt('two', 0.07)), 'model');
    ledger.discardOutput('SURPLUS', 'model', 1);
    expect(splitUnbilledCost(ledger.entries()).billableCostUsd).toBe(0);
    expect(realProviderCostUsd(ledger.entries())).toBeCloseTo(0.08);
    ledger.discardOutput('SURPLUS', 'model', 1);
    expect(realProviderCostUsd(ledger.entries())).toBeCloseTo(0.08);
  });
  it('supplier cost card uses receipts, including a verified actual zero', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', usage(receipt('one', 0)), 'model');
    ledger.add('SURPLUS', usage(receipt('two', 0.07)), 'model');
    expect(explainRealCostBuild(ledger.entries(), { inputTokens: 0, outputTokens: 0 }, 85).perProvider)
      .toEqual([{ provider: 'SURPLUS', costUsd: 0.07 }]);
  });
});
