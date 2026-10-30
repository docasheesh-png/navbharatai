import { describe, expect, it } from 'vitest';
import {
  evaluateSurplusReceipt, isSurplusReceiptDecision, isSurplusOfficialTariffApplicable, normalizeSurplusUsage, surplusBuyerCostToUsd,
  SURPLUS_BUILD_POLICY_ID, type SurplusReceiptDecision, type SurplusReceiptPolicyInput,
  type SurplusPriorSettlement, type SurplusTokenCounts,
} from './receiptPolicy';

// Synthetic identities/rates only. These fixtures make no real provider/model claim.
const now = 1_800_000_000_000;
function fixture(): SurplusReceiptPolicyInput {
  const binding = { buildId: 'build-fixture', callId: 'call-fixture', accountId: 'account-fixture',
    modelId: 'synthetic-model', modelVersion: 'synthetic-version-1', providerId: 'synthetic-provider',
    endpoint: 'https://api.surplusintelligence.ai/min90/v1', offerId: null, startedAt: now - 1000 };
  return { provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'provider-response-id', receiptId: 'response-fixture', requestId: 'request-fixture',
      currency: 'USD', buyerCostMicro: 100, costSource: 'usage.buyer_cost_micro', responseComplete: true,
      receivedAt: now - 100, evidenceSha256: 'a'.repeat(64), additionalCharges: 'none',
      usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'usage-review-fixture',
        tokens: { input: '900', output: '80', cacheRead: '100', cacheWrite: '0', reasoning: '20' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff-fixture',
      sourceUrl: 'https://official-provider.example/pricing', artifactSha256: 'b'.repeat(64),
      reviewId: 'review-fixture', reviewedAt: now - 2000, reviewExpiresAt: now + 10000,
      effectiveFrom: now - 10000, effectiveUntil: null, observedAt: now - 3000,
      surplusModelId: binding.modelId, surplusModelVersion: binding.modelVersion,
      officialModelId: 'synthetic-official-model', officialModelVersion: 'synthetic-official-version',
      modelMappingReviewId: 'mapping-review-fixture', usageMappingReviewId: 'usage-review-fixture',
      currency: 'USD', billingBasis: 'tokens-only',
      usdPerMillionTokens: { input: '1', output: '2', cacheRead: '0.1', cacheWrite: '0.5', reasoning: '2' } },
  };
}
function prior(result: SurplusReceiptDecision): SurplusPriorSettlement {
  return { accountingIdentity: result.accountingIdentity!, evidenceFingerprint: result.evidenceFingerprint!,
    policyId: SURPLUS_BUILD_POLICY_ID, actualCostUsd: result.actualCostUsd!, userChargeUsd: result.userChargeUsd };
}
function unsafeEvaluate(input: unknown) { return evaluateSurplusReceipt(input as SurplusReceiptPolicyInput); }

describe('isolated exact Surplus app-builder receipt policy', () => {
  it('charges ten times the provider-reported actual, with an exact same-usage ceiling', () => {
    expect(evaluateSurplusReceipt(fixture())).toMatchObject({ status: 'chargeable', actualCostUsd: '0.0001',
      userChargeUsd: '0.001', officialCeilingUsd: '0.00111', absorbedCostUsd: '0',
      expenseEvidence: 'provider-reported-actual', reason: 'ten_times_verified_actual_cost' });
  });
  it('charges a flat ten times actual even above the official tariff (no cap)', () => {
    const input = fixture(); input.receipt!.buyerCostMicro = '200';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ actualCostUsd: '0.0002', userChargeUsd: '0.002',
      reason: 'ten_times_verified_actual_cost' });
  });
  it('preserves expense and charges ten times cost even when official price is below cost', () => {
    const input = fixture(); input.receipt!.buyerCostMicro = '2000';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ actualCostUsd: '0.002', userChargeUsd: '0.02', absorbedCostUsd: '0', newSupplierExpenseUsd: '0.002' });
  });
  it('never guesses a price or creates a model tariff from marketplace reference data', () => {
    const input = fixture(); input.tariff = null;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'blocked', actualCostUsd: '0.0001', userChargeUsd: '0', officialCeilingUsd: null });
    input.tariff = { direct_input_per_1m: '1', direct_output_per_1m: '2' } as never;
    expect(evaluateSurplusReceipt(input).status).toBe('blocked');
  });
  it('does not require fictional upstream invoice-attestation or settled fields', () => {
    const input = fixture();
    expect('settled' in input.receipt!).toBe(false);
    expect('invoice' in input.receipt!).toBe(false);
    expect(evaluateSurplusReceipt(input).status).toBe('chargeable');
  });
  it('issues immutable process-local trusted decisions, not copyable JSON authority', () => {
    const result = evaluateSurplusReceipt(fixture());
    expect(isSurplusReceiptDecision(result)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(isSurplusReceiptDecision({ ...result })).toBe(false);
    expect(isSurplusReceiptDecision(JSON.parse(JSON.stringify(result)))).toBe(false);
    expect(isSurplusReceiptDecision(null)).toBe(false);
    expect(() => { (result as SurplusReceiptDecision).userChargeUsd = '999'; }).toThrow();
  });
  it.each(['openrouter', 'deepseek', 'anthropic', '', 'Surplus'])('leaves non-Surplus provider %s outside this policy', provider => {
    const input = fixture(); input.provider = provider;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'not_applicable', actualCostUsd: null, newSupplierExpenseUsd: null });
  });
  it.each(['doctor', 'hosting', 'vm', 'free-chat', 'app-builder-proxy', ''])('leaves product %s outside this policy', product => {
    const input = fixture(); input.product = product;
    expect(evaluateSurplusReceipt(input).status).toBe('not_applicable');
  });
  it('does not mutate evidence or input collections', () => {
    const input = fixture(), copy = structuredClone(input);
    evaluateSurplusReceipt(input); expect(input).toEqual(copy);
  });
});

describe('lossless numbers and unknown expense', () => {
  it.each([[0, '0'], [1, '0.000001'], [1000001, '1.000001'], ['9007199254740993', '9007199254.740993'], ['999999999999999999', '999999999999.999999']] as const)('converts integer microUSD %s exactly', (micro, expected) => {
    expect(surplusBuyerCostToUsd(micro)).toBe(expected);
  });
  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, 'NaN', 'Infinity', '1e3', '1.0', '.5', '-1', '+1', '01', ' 1', '', null, undefined, '1000000000000000000'])('rejects invalid, fractional or overflowing microUSD %s', value => {
    expect(surplusBuyerCostToUsd(value)).toBeNull();
    const input = fixture(); input.receipt!.buyerCostMicro = value as never;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'blocked', userChargeUsd: '0', actualCostUsd: null });
  });
  it.each([null, undefined, {}, [], { provider: 'surplus', product: 'app-builder' }])('handles malformed input without inventing expense %s', input => {
    expect(unsafeEvaluate(input).actualCostUsd).toBeNull();
  });
  it.each([null, {}, { buyerCostMicro: 100 }])('missing complete response evidence is unknown, never a free supplier call', receipt => {
    const input = fixture(); input.receipt = receipt as never;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ actualCostUsd: null, userChargeUsd: '0', newSupplierExpenseUsd: null });
  });
  it.each([{ responseComplete: false }, { costSource: 'estimated-token-cost' }, { currency: 'INR' }, { evidenceSha256: '' }, { receivedAt: now + 1 }, { receivedAt: NaN }, { receivedAt: now - 2000 }])('fails closed on incomplete/untrusted expense %j', override => {
    const input = fixture(); Object.assign(input.receipt!, override);
    expect(evaluateSurplusReceipt(input).actualCostUsd).toBeNull();
  });
  it('keeps sub-micro official caps exactly rather than rounding them up', () => {
    const input = fixture(); input.receipt!.buyerCostMicro = 1;
    input.receipt!.usage!.tokens = { input: '1', output: '0', cacheRead: '0', cacheWrite: '0', reasoning: '0' };
    input.tariff!.usdPerMillionTokens = { input: '0.000000000000000000000001', output: '0', cacheRead: '0', cacheWrite: '0', reasoning: '0' };
    expect(evaluateSurplusReceipt(input).userChargeUsd).toBe('0.00001'); // flat 10x actual, tariff no longer caps
  });
  it('rejects a calculated ceiling beyond the accounting bound, without overflow', () => {
    const input = fixture(); input.receipt!.usage!.tokens.input = '999999999999999999';
    input.tariff!.usdPerMillionTokens.input = '999999999999999999';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ reason: 'official_ceiling_exceeds_accounting_bound', userChargeUsd: '0', actualCostUsd: '0.0001' });
  });
  it('does not silently accept floating-point tariff values', () => {
    const input = fixture(); input.tariff!.usdPerMillionTokens.cacheRead = 0.1 as never;
    expect(evaluateSurplusReceipt(input).reason).toBe('missing_or_invalid_official_tariff');
  });
  it('accepts explicit verified zero tariffs and zero actual expense', () => {
    const input = fixture(); input.receipt!.buyerCostMicro = 0;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'chargeable', userChargeUsd: '0', actualCostUsd: '0' });
    input.receipt!.buyerCostMicro = 100;
    for (const key of Object.keys(input.tariff!.usdPerMillionTokens)) input.tariff!.usdPerMillionTokens[key as keyof SurplusTokenCounts] = '0';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ userChargeUsd: '0.001', absorbedCostUsd: '0', officialCeilingUsd: '0' });
  });
});

describe('same-usage mapping, complete dimensions and reviewed tariffs', () => {
  it('partitions cache input and reasoning included in output exactly once', () => {
    const usage = normalizeSurplusUsage({ mappingReviewId: 'usage-review-fixture', inputIncludesCache: true, outputIncludesReasoning: true,
      tokens: { input: '1000', output: '100', cacheRead: '100', cacheWrite: '0', reasoning: '20' } });
    expect(usage?.tokens).toEqual({ input: '900', output: '80', cacheRead: '100', cacheWrite: '0', reasoning: '20' });
    const input = fixture(); input.receipt!.usage = usage;
    expect(evaluateSurplusReceipt(input).officialCeilingUsd).toBe('0.00111');
  });
  it('can preserve explicitly reviewed disjoint counters without subtracting twice', () => {
    const tokens = fixture().receipt!.usage!.tokens;
    expect(normalizeSurplusUsage({ mappingReviewId: 'mapping', inputIncludesCache: false, outputIncludesReasoning: false, tokens })?.tokens).toEqual(tokens);
  });
  it.each([{ input: '50' }, { output: '10' }])('rejects impossible overlapping total counts %j', override => {
    expect(normalizeSurplusUsage({ mappingReviewId: 'mapping', inputIncludesCache: true, outputIncludesReasoning: true,
      tokens: { ...fixture().receipt!.usage!.tokens, ...override } })).toBeNull();
  });
  it('supports a known separate cache-write dimension', () => {
    const input = fixture(); input.receipt!.usage!.tokens.cacheWrite = '100';
    expect(evaluateSurplusReceipt(input).officialCeilingUsd).toBe('0.00116');
  });
  it.each(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const)('requires known %s usage, even if absent might mean zero', dimension => {
    const input = fixture(); delete (input.receipt!.usage!.tokens as Partial<SurplusTokenCounts>)[dimension];
    expect(evaluateSurplusReceipt(input)).toMatchObject({ reason: 'missing_or_ambiguous_usage', userChargeUsd: '0', actualCostUsd: '0.0001' });
  });
  it.each(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const)('requires an explicit tariff classification for %s', dimension => {
    const input = fixture(); delete (input.tariff!.usdPerMillionTokens as Partial<SurplusTokenCounts>)[dimension];
    expect(evaluateSurplusReceipt(input).reason).toBe('missing_or_invalid_official_tariff');
  });
  it.each([NaN, Infinity, -1, 100, '1.5', '1e3', '1000000000000000000', undefined, null])('rejects malformed token count %s', value => {
    const input = fixture(); input.receipt!.usage!.tokens.reasoning = value as never;
    expect(evaluateSurplusReceipt(input).reason).toBe('missing_or_ambiguous_usage');
  });
  it('blocks unknown dimensions, rather than dropping search/media costs', () => {
    const input = fixture(); Object.assign(input.receipt!.usage!.tokens, { media: '3' });
    expect(evaluateSurplusReceipt(input).reason).toBe('missing_or_ambiguous_usage');
  });
  it.each(['present', 'unknown'] as const)('blocks non-token or unknown fees (%s)', additionalCharges => {
    const input = fixture(); input.receipt!.additionalCharges = additionalCharges;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ reason: 'non_token_or_unknown_charges_unsupported', actualCostUsd: '0.0001', userChargeUsd: '0' });
  });
  it('allows explicitly unsupported dimensions only when their known usage is zero', () => {
    const input = fixture(); input.tariff!.usdPerMillionTokens.cacheWrite = 'not-supported';
    expect(evaluateSurplusReceipt(input).status).toBe('chargeable');
    input.receipt!.usage!.tokens.cacheWrite = '1';
    expect(evaluateSurplusReceipt(input).reason).toBe('usage_dimension_unsupported_by_official_tariff');
  });
  it.each([
    { surplusModelId: 'another-model' }, { surplusModelVersion: 'another-version' }, { officialModelId: '' },
    { officialModelVersion: '' }, { modelMappingReviewId: '' }, { usageMappingReviewId: 'another-mapping' },
    { sourceUrl: 'https://www.surplusintelligence.ai/api/markets/synthetic' }, { sourceUrl: 'http://official.example/pricing' },
    { sourceUrl: 'https://user:pass@official.example/pricing' }, { kind: 'market-reference' }, { artifactSha256: 'bad' },
    { reviewedAt: now }, { reviewExpiresAt: now }, { reviewExpiresAt: NaN }, { observedAt: now },
    { effectiveFrom: now }, { effectiveUntil: now - 100 }, { effectiveUntil: now - 20000 },
    { currency: 'INR' }, { billingBasis: 'tokens-and-search' },
  ])('rejects mismatched, unreviewed, stale or inapplicable official evidence %j', override => {
    const input = fixture(); Object.assign(input.tariff!, override);
    expect(evaluateSurplusReceipt(input)).toMatchObject({ reason: 'missing_or_invalid_official_tariff', userChargeUsd: '0', actualCostUsd: '0.0001' });
  });
  it('requires the reviewed tariff to cover the entire call and currently valid review', () => {
    const input = fixture(); input.tariff!.effectiveUntil = now - 50;
    expect(evaluateSurplusReceipt(input).status).toBe('chargeable');
    input.now += 10000;
    expect(evaluateSurplusReceipt(input).status).toBe('blocked');
  });
  it.each(['buildId', 'callId', 'accountId', 'modelId', 'modelVersion', 'providerId', 'endpoint', 'offerId'] as const)('binds receipt to exact requested %s', dimension => {
    const input = fixture(); input.binding[dimension] = 'different';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ reason: 'receipt_call_binding_mismatch', actualCostUsd: '0.0001', userChargeUsd: '0' });
  });
});

describe('failed output and replay cannot hide supplier expense or double charge', () => {
  it.each(['failed', 'malformed', 'discarded', 'partially_discarded'] as const)('absorbs the whole %s call without fabricated proportional allocation', disposition => {
    const input = fixture(); input.disposition = disposition;
    input.receipt!.usage = null; input.tariff = null;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'absorbed', userChargeUsd: '0',
      actualCostUsd: '0.0001', absorbedCostUsd: '0.0001', newSupplierExpenseUsd: '0.0001' });
    if (disposition === 'partially_discarded') expect(evaluateSurplusReceipt(input).reason).toBe('partial_discard_requires_whole_call_absorption');
  });
  it('does not infer accepted output from an unknown disposition', () => {
    const input = fixture(); input.disposition = 'unknown';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ reason: 'output_acceptance_not_verified', actualCostUsd: '0.0001', userChargeUsd: '0' });
  });
  it('retains stable receipt identity and issues zero additional expense/charge for a replay', () => {
    const input = fixture(), first = evaluateSurplusReceipt(input); input.priorSettlements = [prior(first)];
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'duplicate', accountingIdentity: first.accountingIdentity,
      actualCostUsd: '0.0001', newSupplierExpenseUsd: '0', userChargeUsd: '0', priorUserChargeUsd: '0.001', absorbedCostUsd: '0' });
  });
  it('does not charge an absorbed receipt later even if output is now marked accepted', () => {
    const input = fixture(); input.disposition = 'partially_discarded';
    const first = evaluateSurplusReceipt(input); input.priorSettlements = [prior(first)]; input.disposition = 'accepted';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'duplicate', userChargeUsd: '0', priorUserChargeUsd: '0', absorbedCostUsd: '0.0001' });
  });
  it.each(['cost', 'hash', 'usage', 'binding'] as const)('rejects conflicting duplicate %s evidence', changed => {
    const input = fixture(), first = evaluateSurplusReceipt(input); input.priorSettlements = [prior(first)];
    if (changed === 'cost') input.receipt!.buyerCostMicro = 101;
    if (changed === 'hash') input.receipt!.evidenceSha256 = 'c'.repeat(64);
    if (changed === 'usage') input.receipt!.usage!.tokens.input = '901';
    if (changed === 'binding') { input.receipt!.callId = 'new-call'; input.binding.callId = 'new-call'; }
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'conflict', reason: 'conflicting_duplicate_receipt', userChargeUsd: '0', newSupplierExpenseUsd: '0' });
  });
  it('rejects conflicting duplicate ledger records', () => {
    const input = fixture(), first = evaluateSurplusReceipt(input);
    input.priorSettlements = [prior(first), { ...prior(first), userChargeUsd: '0' }];
    expect(evaluateSurplusReceipt(input).status).toBe('conflict');
  });
  it('namespaces identical upstream receipt IDs by supplier account', () => {
    const input = fixture(), first = evaluateSurplusReceipt(input); input.priorSettlements = [prior(first)];
    input.binding.accountId = 'another-account'; input.receipt!.accountId = 'another-account';
    const second = evaluateSurplusReceipt(input);
    expect(second.status).toBe('chargeable'); expect(second.accountingIdentity).not.toBe(first.accountingIdentity);
  });
  it('allows repeated identical prior evidence but never sums it', () => {
    const input = fixture(), first = evaluateSurplusReceipt(input);
    input.priorSettlements = [prior(first), prior(first)];
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'duplicate', newSupplierExpenseUsd: '0', userChargeUsd: '0' });
  });
  it.each([null, {}, [{ accountingIdentity: 'bad' }], Array(4097).fill({})])('fails closed on corrupt or excessive replay evidence', priorSettlements => {
    const input = fixture(); input.priorSettlements = priorSettlements as never;
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'blocked', reason: 'invalid_prior_settlements', userChargeUsd: '0', newSupplierExpenseUsd: null, actualCostUsd: '0.0001' });
  });
});


describe('honest local identities and precision-preserving replay', () => {
  it('labels a unique server dispatch identity without claiming a provider receipt ID', () => {
    const input = fixture(); input.receipt!.identitySource = 'server-dispatch-id';
    input.receipt!.receiptId = input.receipt!.callId; input.receipt!.requestId = input.receipt!.callId;
    const first = evaluateSurplusReceipt(input);
    expect(first).toMatchObject({ status: 'chargeable', identitySource: 'server-dispatch-id', actualCostUsd: '0.0001' });
    input.priorSettlements = [prior(first)];
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'duplicate', newSupplierExpenseUsd: '0' });
  });
  it('preserves actual expense when identity is absent or a local ID is falsely bound', () => {
    for (const overrides of [{ receiptId: null }, { requestId: null }, { identitySource: undefined },
      { identitySource: 'server-dispatch-id', receiptId: 'wrong-dispatch' }]) {
      const input = fixture(); Object.assign(input.receipt!, overrides);
      expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'blocked', actualCostUsd: '0.0001',
        userChargeUsd: '0', accountingIdentity: null, newSupplierExpenseUsd: null });
    }
  });
  it('preserves actual expense when exact model version is unavailable', () => {
    const input = fixture(); input.receipt!.modelVersion = '';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'blocked', actualCostUsd: '0.0001', userChargeUsd: '0', modelVersion: null });
  });
  it('checks prior identity before a caller mismatch so a receipt cannot create more expense', () => {
    const input = fixture(), first = evaluateSurplusReceipt(input); input.priorSettlements = [prior(first)];
    input.binding.callId = 'wrong-caller';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'duplicate', userChargeUsd: '0', newSupplierExpenseUsd: '0' });
  });
  it('accepts its own exact sub-micro charge during replay without precision loss', () => {
    const input = fixture(); input.receipt!.buyerCostMicro = 1;
    input.receipt!.usage!.tokens = { input: '1', output: '0', cacheRead: '0', cacheWrite: '0', reasoning: '0' };
    input.tariff!.usdPerMillionTokens = { input: '0.000000000000000000000001', output: '0', cacheRead: '0', cacheWrite: '0', reasoning: '0' };
    const first = evaluateSurplusReceipt(input); input.priorSettlements = [prior(first)];
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'duplicate', priorUserChargeUsd: first.userChargeUsd, userChargeUsd: '0' });
  });
});


describe('shared real-adapter tariff admission gate', () => {
  const context = () => ({ modelId: fixture().binding.modelId, modelVersion: fixture().binding.modelVersion,
    mappingReviewId: fixture().receipt!.usage!.mappingReviewId, startedAt: now - 1000, receivedAt: now - 1000 });
  it('admits reviewed pre-dispatch context without manufacturing a receipt or charge', () => {
    expect(isSurplusOfficialTariffApplicable(fixture().tariff, context(), now)).toBe(true);
  });
  it('rechecks coverage for actual completion instead of trusting pre-dispatch approval', () => {
    const tariff = fixture().tariff!; tariff.effectiveUntil = now - 500;
    expect(isSurplusOfficialTariffApplicable(tariff, context(), now)).toBe(true);
    expect(isSurplusOfficialTariffApplicable(tariff, { ...context(), receivedAt: now - 100 }, now)).toBe(false);
  });
  it.each([{ modelId: '' }, { modelId: 'wrong' }, { modelVersion: '' }, { modelVersion: 'wrong' },
    { mappingReviewId: 'wrong' }, { mappingReviewId: '' }, { startedAt: NaN }, { receivedAt: Infinity },
    { receivedAt: now - 2000 }, { receivedAt: now + 1 }])('rejects invalid applicability context %j', override => {
    expect(isSurplusOfficialTariffApplicable(fixture().tariff, { ...context(), ...override }, now)).toBe(false);
  });
  it.each([null, {}, [], undefined])('rejects malformed applicability context without throwing %j', malformed => {
    expect(isSurplusOfficialTariffApplicable(fixture().tariff, malformed as never, now)).toBe(false);
  });
  it('shares exact settlement validation of source, review, model, mappings and dimensions', () => {
    for (const override of [{ sourceUrl: 'https://www.surplusintelligence.ai/api/markets/example' },
      { reviewExpiresAt: now }, { surplusModelVersion: 'wrong' }, { usageMappingReviewId: 'wrong' },
      { usdPerMillionTokens: { input: '1', output: '2' } }]) {
      const input = fixture(); Object.assign(input.tariff!, override);
      expect(isSurplusOfficialTariffApplicable(input.tariff, context(), now)).toBe(false);
      expect(evaluateSurplusReceipt(input).reason).toBe('missing_or_invalid_official_tariff');
    }
    expect(isSurplusOfficialTariffApplicable(fixture().tariff, context(), NaN)).toBe(false);
  });
});


describe('absorbed expense retains independently verified comparison evidence', () => {
  it.each(['failed', 'malformed', 'discarded', 'partially_discarded'] as const)('retains the whole-call official ceiling for %s without charging any portion', disposition => {
    const input = fixture(); input.disposition = disposition;
    const decision = evaluateSurplusReceipt(input);
    expect(decision).toMatchObject({ status: 'absorbed', actualCostUsd: '0.0001', newSupplierExpenseUsd: '0.0001',
      userChargeUsd: '0', absorbedCostUsd: '0.0001', officialCeilingUsd: '0.00111',
      tariffSnapshotId: input.tariff!.snapshotId, usageMappingReviewId: input.receipt!.usage!.mappingReviewId });
    expect(decision.reason).toBe(disposition === 'partially_discarded'
      ? 'partial_discard_requires_whole_call_absorption' : `${disposition}_call_absorbed`);
  });
  it.each(['missing-usage', 'malformed-usage', 'missing-tariff', 'malformed-tariff', 'expired-review',
    'unknown-fees', 'unsupported-dimension', 'unbounded-ceiling'] as const)('keeps %s unknown while retaining whole-call absorption', missing => {
    const input = fixture(); input.disposition = 'partially_discarded';
    if (missing === 'missing-usage') input.receipt!.usage = null;
    if (missing === 'malformed-usage') input.receipt!.usage!.tokens.reasoning = 'unknown';
    if (missing === 'missing-tariff') input.tariff = null;
    if (missing === 'malformed-tariff') delete (input.tariff!.usdPerMillionTokens as Partial<SurplusTokenCounts>).cacheWrite;
    if (missing === 'expired-review') input.tariff!.reviewExpiresAt = now;
    if (missing === 'unknown-fees') input.receipt!.additionalCharges = 'unknown';
    if (missing === 'unsupported-dimension') input.tariff!.usdPerMillionTokens.reasoning = 'not-supported';
    if (missing === 'unbounded-ceiling') {
      input.receipt!.usage!.tokens.input = '999999999999999999';
      input.tariff!.usdPerMillionTokens.input = '999999999999999999';
    }
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'absorbed', actualCostUsd: '0.0001',
      userChargeUsd: '0', absorbedCostUsd: '0.0001', officialCeilingUsd: null,
      reason: 'partial_discard_requires_whole_call_absorption' });
  });
  it('retains a ceiling below supplier cost without masking the loss or charging discarded work', () => {
    const input = fixture(); input.disposition = 'discarded'; input.receipt!.buyerCostMicro = '2000';
    expect(evaluateSurplusReceipt(input)).toMatchObject({ status: 'absorbed', actualCostUsd: '0.002',
      newSupplierExpenseUsd: '0.002', userChargeUsd: '0', absorbedCostUsd: '0.002', officialCeilingUsd: '0.00111' });
  });
});
