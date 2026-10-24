import { describe, expect, it } from 'vitest';
import { evaluateSurplusReceipt, type SurplusCallBinding, type SurplusReceiptEvidence } from '../AI/SurplusRegistry/receiptPolicy';
import { createProviderUsageLedger } from './ProviderUsageLedger';
import { realProviderCostUsd } from './providerRates';
import { splitUnbilledCost } from './unbilledTurns';

const binding: SurplusCallBinding = { buildId: 'build', accountId: 'account', callId: 'call', modelId: 'model',
  modelVersion: 'v1', endpoint: 'https://api.surplusintelligence.ai/min90/v1', offerId: 'offer', providerId: 'provider', startedAt: 1 };
const evidence: SurplusReceiptEvidence = { ...binding, kind: 'validated-surplus-response', receiptId: 'receipt', requestId: 'request',
  identitySource: 'provider-response-id', currency: 'USD', buyerCostMicro: '12345', costSource: 'usage.buyer_cost_micro', responseComplete: true,
  receivedAt: 2, evidenceSha256: 'a'.repeat(64), additionalCharges: 'none', usage: null };

describe('Actual Surplus policy to ledger proof boundary', () => {
  it('retains a frozen issued expense when the official user-charge ceiling is unknown', () => {
    const proof = evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding,
      receipt: evidence, tariff: null, disposition: 'accepted', now: 3 });
    expect(proof.status).toBe('blocked');
    expect(proof.actualCostUsd).toBe('0.012345');
    expect(proof.userChargeUsd).toBe('0');
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', { inputTokens: 100, outputTokens: 20, surplusReceipt: proof }, 'model');
    expect(realProviderCostUsd(ledger.entries())).toBe(0.012345);
    expect(Object.isFrozen(proof)).toBe(true);
    expect(() => realProviderCostUsd([{ ...ledger.entries()[0], surplusReceipt: { ...proof } }])).toThrow();
  });
  it.each(['partially_discarded', 'discarded', 'failed', 'malformed'] as const)('absorbs %s expense and deduplicates identical callbacks without changing status', (disposition) => {
    const proof = evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding,
      receipt: evidence, tariff: null, disposition, now: 3 });
    expect(proof.status).toBe('absorbed');
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', { inputTokens: 100, outputTokens: 20, surplusReceipt: proof }, 'model');
    expect(splitUnbilledCost(ledger.entries())).toEqual({ realCostUsd: 0.012345, billableCostUsd: 0, absorbedCostUsd: 0.012345 });
    ledger.add('SURPLUS', { inputTokens: 100, outputTokens: 20, surplusReceipt: proof }, 'model');
    const identical = evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding,
      receipt: evidence, tariff: null, disposition, now: 3 });
    ledger.add('SURPLUS', { inputTokens: 100, outputTokens: 20, surplusReceipt: identical }, 'model');
    expect(ledger.entries()).toHaveLength(1);
    expect(ledger.total()).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(ledger.callsByProvider?.()).toEqual({ SURPLUS: 1 });
    expect(splitUnbilledCost(ledger.entries())).toEqual({ realCostUsd: 0.012345, billableCostUsd: 0, absorbedCostUsd: 0.012345 });
    expect(ledger.entries()[0].surplusReceipt).toBe(proof);
    expect(proof.status).toBe('absorbed');
  });
});
