import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { evaluateSurplusReceipt } from './receiptPolicy';
import type { SurplusTurnPermit } from '../../AgentV3/providers/SurplusTurnRunner';
import { createSurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from './buildSession';
const now = 1800000000000;
function state(): SurplusReviewedState {
  return {
    snapshot: { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: ['model-a'], offers: [{ model: 'model-a', offerId: 'offer-a', providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
      discountPct: 95, rates: { input: '1', output: '1' }, referenceRates: { input: '100', output: '100' }, unit: 'unverified', observedAt: now, upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: 'https://www.surplusintelligence.ai/api/markets/model-a' }] },
    reviews: { quality: [{ binding: 'model-provider', model: 'model-a', providerId: 'provider-a', benchmarkId: 'bench', cohort: 'coding', approved: true, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 }], pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 },
    capabilities: [{ reviewId: 'capability', model: 'model-a', modelVersion: 'reviewed-v1', providerId: 'provider-a', reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true, parallelTools: true, transcriptRoundTrip: true, providerPinVerified: true, returnedIdentityVerified: true, reportedChargeContractVerified: true, endpoint: 'https://api.surplusintelligence.ai/min90/v1' }],
    floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: 'https://api.surplusintelligence.ai/min90/v1', reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
  };
}
const params = { model: 'ignored-legacy-model', system: 'build', messages: [{ role: 'user' as const, content: 'Make app' }], tools: [], maxTokens: 100 };
function receipt(permit: SurplusTurnPermit) {
  const binding = { buildId: permit.buildId, callId: permit.callId, accountId: 'account', modelId: permit.model, modelVersion: 'reviewed-v1', providerId: permit.providerId, endpoint: permit.endpoint, offerId: null, startedAt: now - 1 };
  return evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'server-dispatch-id', receiptId: permit.callId, requestId: permit.callId, currency: 'USD', buyerCostMicro: '1', costSource: 'usage.buyer_cost_micro', responseComplete: true, receivedAt: now, evidenceSha256: 'b'.repeat(64), additionalCharges: 'none', usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'mapping', tokens: { input: '10', output: '2', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff', sourceUrl: 'https://official.example/pricing', artifactSha256: 'c'.repeat(64), reviewId: 'tariff-review', reviewedAt: now - 2, reviewExpiresAt: now + 300000, effectiveFrom: now - 10, effectiveUntil: null, observedAt: now - 3, surplusModelId: permit.model, surplusModelVersion: 'reviewed-v1', officialModelId: 'model-a', officialModelVersion: 'v1', modelMappingReviewId: 'model-mapping', usageMappingReviewId: 'mapping', currency: 'USD', billingBasis: 'tokens-only', usdPerMillionTokens: { input: '1', output: '2', cacheRead: '0.1', cacheWrite: 'not-supported', reasoning: '2' } },
  });
}
function setup() {
  const s = state();
  const completion = { model: 'model-a', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
  const adapter: SurplusReviewedAdapter = { readState: vi.fn(async () => s), routing: review => ({ provider: review.providerId, si_route: { objective: 'price' } }), dispatch: vi.fn(async () => completion), identify: raw => ({ model: 'model-a', providerId: 'provider-a', completion: raw as typeof completion }), receipt: vi.fn(async (_raw, permit) => receipt(permit)) };
  const make = () => createSurplusBuildSession({ buildId: 'build', tier: 'weak', enabled: true, adapter, now: () => now });
  return { s, adapter, make };
}
describe('Surplus build-scoped authority', () => {
  it('default OFF does not read state or construct transport', async () => {
    const { adapter } = setup();
    expect(await createSurplusBuildSession({ buildId: 'build', tier: 'weak', enabled: false, adapter })).toBeUndefined();
    expect(adapter.readState).not.toHaveBeenCalled(); expect(adapter.dispatch).not.toHaveBeenCalled();
  });
  it('uses full runner from an independently reviewed model/provider class', async () => {
    const { make, adapter } = setup(); const session = await make();
    const result = await session!.runner().runTurn(params);
    expect(result.text).toBe('done'); expect(result.model).toBe('model-a');
    expect(adapter.dispatch).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a', provider: 'provider-a', si_route: { objective: 'price' } }), expect.any(AbortSignal), expect.objectContaining({ endpoint: 'https://api.surplusintelligence.ai/min90/v1' }));
  });
  it.each(['expired', 'quality', 'privacy', 'price', 'tools', 'context', 'floor'] as const)('blocks %s evidence before dispatch', async kind => {
    const { make, s, adapter } = setup();
    if (kind === 'expired') s.snapshot!.expiresAt = now;
    if (kind === 'quality') s.reviews.quality = [];
    if (kind === 'privacy') s.reviews.accountAndPrivacyReviewedUntil = now;
    if (kind === 'price') s.snapshot!.offers[0].rates.input = '99';
    if (kind === 'tools') s.capabilities[0].tools = false as true;
    if (kind === 'context') s.capabilities[0].contextTokens = 1;
    if (kind === 'floor') s.floorContract.allowFallbacks = true as false;
    await expect(make()).rejects.toThrow(); expect(adapter.dispatch).not.toHaveBeenCalled();
  });
  it('rechecks stale offers before every call; no legacy fallback', async () => {
    const { make, s, adapter } = setup(); const session = await make();
    await session!.runner().runTurn(params); s.snapshot!.expiresAt = now;
    await expect(session!.runner().runTurn(params)).rejects.toThrow(); expect(adapter.dispatch).toHaveBeenCalledTimes(1);
  });
  it('pins the build model despite a cheaper newly reviewed model', async () => {
    const { make, s, adapter } = setup(); const session = await make();
    s.snapshot!.models.push('model-b'); s.snapshot!.offers.unshift({ ...s.snapshot!.offers[0], model: 'model-b', offerId: 'offer-b', rates: { input: '0.1', output: '0.1' } });
    s.reviews.quality.push({ ...s.reviews.quality[0], model: 'model-b' });
    await session!.runner().runTurn(params); expect(adapter.dispatch).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a' }), expect.anything(), expect.anything());
  });
  it('filters missing capability before choosing the cheapest reviewed price', async () => {
    const { make, s } = setup();
    s.snapshot!.models.push('model-b'); s.snapshot!.offers.push({ ...s.snapshot!.offers[0], model: 'model-b', offerId: 'offer-b', rates: { input: '2', output: '2' } });
    s.reviews.quality.push({ ...s.reviews.quality[0], model: 'model-b' });
    s.capabilities = [{ ...s.capabilities[0], model: 'model-b' }];
    expect((await make())!.model).toBe('model-b');
  });
  it('rejects returned provider mismatch and still accounts failed response', async () => {
    const { make, adapter } = setup(); adapter.identify = raw => ({ model: 'model-a', providerId: 'other', completion: raw as never });
    const session = await make(); await expect(session!.runner().runTurn(params)).rejects.toThrow(); expect(adapter.receipt).toHaveBeenCalledOnce();
  });
  it('does not dispatch an already stopped call', async () => {
    const { make, adapter } = setup(); const session = await make(); const abort = new AbortController(); abort.abort();
    await expect(session!.runner().runTurn({ ...params, signal: abort.signal })).rejects.toThrow(); expect(adapter.dispatch).not.toHaveBeenCalled();
  });
  it('poisons later turns after a missing receipt instead of silently charging zero', async () => {
    const { make, adapter } = setup(); adapter.receipt = vi.fn(async () => undefined);
    const session = await make(); await expect(session!.runner().runTurn(params)).rejects.toThrow('unavailable');
    await expect(session!.runner().runTurn(params)).rejects.toThrow('unavailable'); expect(adapter.dispatch).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent model calls while preserving parallel tools within turns', async () => {
    const { make, adapter } = setup(); const session = await make(); let active = 0, peak = 0;
    const original = adapter.dispatch;
    adapter.dispatch = vi.fn(async (...args) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); const r = await original(...args); active--; return r; });
    await Promise.all([session!.runner().runTurn(params), session!.runner().runTurn(params)]);
    expect(peak).toBe(1); expect(adapter.dispatch).toHaveBeenCalledTimes(2);
  });

});

describe('Surplus build scope is Weak-only (owner 2026-10-25)', () => {
  it.each(['off', 'mini'] as const)('rejects Normal/Strong tier %j before adapter I/O', async (tier) => {
    const { createSurplusBuildSession, SurplusBuildUnavailableError } = await import('./buildSession');
    const adapter = { readState: vi.fn() } as never;
    try {
      await createSurplusBuildSession({ buildId: 'build', tier, enabled: true, adapter });
      throw new Error('expected invalid_build_scope');
    } catch (error) {
      expect(error).toBeInstanceOf(SurplusBuildUnavailableError);
      expect(error).toMatchObject({ reason: 'invalid_build_scope' });
    }
    expect((adapter as { readState: ReturnType<typeof vi.fn> }).readState).not.toHaveBeenCalled();
  });
});
