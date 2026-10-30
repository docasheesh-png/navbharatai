import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decideBuildBilledUsd } from '../routes/agentv3';
import { evaluateSurplusReceipt, type SurplusReceiptPolicyInput } from '../AI/SurplusRegistry/receiptPolicy';
import { createProviderUsageLedger } from './ProviderUsageLedger';
import { surplusBuildCharges, sumSurplusDecimalUsd } from './surplusBuildBilling';
import { SurplusAccountingUnavailableError } from './providerRates';
import { settleStopOrFailure, type CancelledBuildFacts } from './cancelledBuildBilling';

// Synthetic evidence only: no provider request, credential, external read, or wallet debit.
function fixture(callId = 'one', micro = '1000'): SurplusReceiptPolicyInput {
  const binding = { buildId: 'build', callId, accountId: 'account', modelId: 'synthetic', modelVersion: 'v1',
    providerId: 'seller', endpoint: 'https://api.surplusintelligence.ai/min90/v1', offerId: null, startedAt: 1000 };
  return { provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now: 1200,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'provider-response-id', receiptId: `receipt-${callId}`,
      requestId: `request-${callId}`, currency: 'USD', buyerCostMicro: micro, costSource: 'usage.buyer_cost_micro',
      responseComplete: true, receivedAt: 1100, evidenceSha256: 'a'.repeat(64), additionalCharges: 'none',
      usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'usage-review',
        tokens: { input: '1000', output: '100', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff', sourceUrl: 'https://official.example/pricing',
      artifactSha256: 'b'.repeat(64), reviewId: 'review', reviewedAt: 900, reviewExpiresAt: 2000,
      effectiveFrom: 800, effectiveUntil: null, observedAt: 850, surplusModelId: 'synthetic', surplusModelVersion: 'v1',
      officialModelId: 'official-synthetic', officialModelVersion: 'v1', modelMappingReviewId: 'model-review',
      usageMappingReviewId: 'usage-review', currency: 'USD', billingBasis: 'tokens-only',
      usdPerMillionTokens: { input: '10', output: '10', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } };
}
function add(ledger: ReturnType<typeof createProviderUsageLedger>, input = fixture(), opts = {}) {
  const surplusReceipt = evaluateSurplusReceipt(input);
  ledger.add('SURPLUS', { inputTokens: 1000, outputTokens: 100, surplusReceipt }, 'synthetic', opts);
  return surplusReceipt;
}
function bill(ledger: ReturnType<typeof createProviderUsageLedger>, vm = 0, barren = new Set<string>()) {
  return decideBuildBilledUsd(ledger, ledger.total(), 'off', null, null, vm, barren);
}

beforeEach(() => {
  vi.stubEnv('UNIFIED_WALLET_MARGIN', '2.5');
  vi.stubEnv('UNIFIED_WALLET_MARGIN_BUILD', '2.5');
  vi.stubEnv('AGENTV3_REALCOST_BILLING', 'on');
  vi.stubEnv('RATE_GLM5_IN', '1.4');
});
afterEach(() => vi.unstubAllEnvs());

describe('actual Builder route Surplus settlement branch', () => {
  it.each([['1000', 0.01], ['2000', 0.02]] as const)('charges flat 10x actual (no tariff cap) for %s micro without applying legacy2.5 again', (cost, expected) => {
    const ledger = createProviderUsageLedger();
    expect(add(ledger, fixture('one', cost)).status).toBe('chargeable');
    const result = bill(ledger);
    expect(result.effectiveBilledUsd).toBe(expected);
    expect(result.realCostUsd).toBe(Number(cost) / 1e6);
    expect(result.absorbedUnbilledUsd).toBe(0);
    expect(result.realCostRemainder).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
  it('preserves legacy model and VM charges separately under2.5 margin', () => {
    const legacy = createProviderUsageLedger();
    legacy.add('GLM', { inputTokens: 1_000_000, outputTokens: 0 }, 'glm-5.3');
    const original = bill(legacy, 0.2);
    expect(original.effectiveBilledUsd).toBeCloseTo(4);
    const mixed = createProviderUsageLedger();
    mixed.add('GLM', { inputTokens: 1_000_000, outputTokens: 0 }, 'glm-5.3');
    add(mixed);
    const result = bill(mixed, 0.2);
    expect(result.effectiveBilledUsd).toBeCloseTo(original.effectiveBilledUsd + 0.01);
    expect(result.realCostUsd).toBeCloseTo(original.realCostUsd + 0.001);
    expect(result.sandboxUsd).toBe(original.sandboxUsd);
    expect(result.reconciledProviderUsage.SURPLUS).toEqual({ inputTokens: 1000, outputTokens: 100 });
  });
  it('keeps different per-call same-model prices and ignores exact duplicate callbacks', () => {
    const ledger = createProviderUsageLedger();
    add(ledger, fixture('one', '1000')); add(ledger, fixture('two', '2000')); add(ledger, fixture('one', '1000'));
    expect(ledger.entries()).toHaveLength(2);
    expect(bill(ledger).effectiveBilledUsd).toBe(0.03);
    expect(bill(ledger).realCostUsd).toBe(0.003);
    expect(surplusBuildCharges([...ledger.entries(), ...ledger.entries()], new Set()).chargeUsd).toBe('0.03');
  });
  it.each(['discarded', 'partially_discarded', 'failed', 'malformed'] as const)('absorbs entire %s call while retaining supplier expense', disposition => {
    const ledger = createProviderUsageLedger(); const input = fixture(); input.disposition = disposition;
    const proof = add(ledger, input); add(ledger, input);
    const result = bill(ledger);
    expect(proof.status).toBe('absorbed');
    expect(result.effectiveBilledUsd).toBe(0);
    expect(result.realCostUsd).toBe(0.001);
    expect(result.absorbedUnbilledUsd).toBe(0.001);
  });
  it('absorbs whole affected receipt for partial late discard, never pro-rata expense', () => {
    const ledger = createProviderUsageLedger(); add(ledger);
    ledger.discardOutput('SURPLUS', 'synthetic', 1);
    expect(bill(ledger)).toMatchObject({ effectiveBilledUsd: 0, realCostUsd: 0.001, absorbedUnbilledUsd: 0.001 });
  });
  it('barren phase absorbs only its entire receipt, leaving other phase charges intact', () => {
    const ledger = createProviderUsageLedger(); add(ledger, fixture('one'), { phase: 'review' }); add(ledger, fixture('two'), { phase: 'build' });
    expect(bill(ledger, 0, new Set(['review']))).toMatchObject({ effectiveBilledUsd: 0.01, realCostUsd: 0.002, absorbedUnbilledUsd: 0.001 });
  });
  it.each(['usage', 'cap', 'receipt'] as const)('missing %s is absorbed at ₹0 (no guess, no tariff) and never crashes a finished build', missing => {
    const ledger = createProviderUsageLedger(); const input = fixture();
    if (missing === 'usage') input.receipt!.usage = null;
    if (missing === 'cap') input.tariff = null;
    if (missing === 'receipt') input.receipt = null;
    expect(add(ledger, input).status).toBe('blocked');
    // z@ live 2026-10-30: this throw used to turn a green, rendered Surplus app into BUILD_EXCEPTION.
    const decided = bill(ledger);
    expect(decided.effectiveBilledUsd).toBe(0);
    expect(decided.absorbedUnbilledUsd).toBe(0);
  });
  it('existing failed-build downstream guard still zeroes a decided Surplus charge', () => {
    const ledger = createProviderUsageLedger(); add(ledger);
    const decided = bill(ledger).effectiveBilledUsd;
    // billCancelled=false means the helper deliberately reads only decidedBilledUsd.
    expect(settleStopOrFailure({ failed: true, facts: { decidedBilledUsd: decided } as CancelledBuildFacts,
      switches: { billCancelled: false, lateStopRules: false } })).toEqual({ kind: 'failed-free', cancelBill: null });
  });
});

describe('exact decimal sum before the final numeric currency boundary', () => {
  it.each([
    [[], '0'], [['0', '0.00'], '0'], [['0.1', '0.2'], '0.3'], [['0.000001', '0.000009'], '0.00001'],
    [['1.999', '0.001'], '2'], [['0.000000000000000000000001', '0.000000000000000000000009'], '0.00000000000000000000001'],
    [['9007199254740993', '1'], '9007199254740994'],
  ] as [string[], string][])('sums %j exactly', (values, expected) => expect(sumSurplusDecimalUsd(values)).toBe(expected));
  it.each(['-1', 'NaN', 'Infinity', '1e-6', '', ' 0.1', '.1', '0.1234567890123456789012345'])('rejects malformed decimal %s', value => {
    expect(() => sumSurplusDecimalUsd([value])).toThrow(SurplusAccountingUnavailableError);
  });
});
