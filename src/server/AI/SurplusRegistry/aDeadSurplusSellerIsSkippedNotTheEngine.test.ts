/**
 * 🏪 A DEAD SURPLUS SELLER IS SKIPPED — NOT THE MODEL, NOT THE ENGINE (admin 2026-11-25: "surplus app builder me kam nahi
 * kar raha, vaise woh reply de raha hai").
 *
 * Live probes the same day, /min90, the builder's own request shape: qwen3-coder/bedrock and glm-5.3-flash/mistral → 200;
 * glm-5.3 and deepseek-v4.1-flash pinned to dashscope-cn → 404 no_sellers_for_model on EVERY request, any size. The
 * builder picked a dead pair, benched the whole model on its 404, and BR2525 lost qwen3-coder after 12 good turns.
 * These tests run the real session (createSurplusBuildSession + the real turn runner) against a fake market.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { evaluateSurplusReceipt } from './receiptPolicy';
import type { SurplusTurnPermit } from '../../AgentV3/providers/SurplusTurnRunner';
import { type SurplusAttemptFailure, createSurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from './buildSession';
import {
  recordSurplusPairRefusal, recordSurplusPairServed, resetSurplusPairRefusalsForTests, surplusPairRefused,
  SURPLUS_PAIR_SERVED_REFUSAL_MS, SURPLUS_PAIR_UNSERVED_REFUSAL_MS,
} from './surplusPairRefusals';

const now = 1800000000000;
const W = 'https://api.surplusintelligence.ai/min90/v1';
function offer(model: string, providerId: string, input: string) {
  return { model, offerId: `offer-${model}-${providerId}`, providerId, available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
    discountPct: 99, rates: { input, output: input }, referenceRates: { input: '100', output: '100' }, unit: 'unverified' as const, observedAt: now, upstreamGeneratedAt: null,
    sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: `https://www.surplusintelligence.ai/api/markets/${model}` };
}
function state(pairs: Array<[string, string, string]>): SurplusReviewedState {
  return {
    snapshot: { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models: [...new Set(pairs.map(p => p[0]))], offers: pairs.map(([m, p, r]) => offer(m, p, r)) },
    reviews: { quality: pairs.map(([model, providerId]) => ({ binding: 'model-provider' as const, model, providerId, benchmarkId: 'bench', cohort: 'coding', approved: true, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 })),
      pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 },
    capabilities: pairs.map(([model, providerId]) => ({ reviewId: `cap-${model}-${providerId}`, model, modelVersion: 'reviewed-v1', providerId, reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192,
      tools: true, parallelTools: true, transcriptRoundTrip: true, providerPinVerified: true, returnedIdentityVerified: true, reportedChargeContractVerified: true, endpoint: W })),
    floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: W, reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
  } as SurplusReviewedState;
}
const params = { model: 'ignored', system: 'build', messages: [{ role: 'user' as const, content: 'Make app' }], tools: [], maxTokens: 100 };
function receipt(permit: SurplusTurnPermit) {
  const binding = { buildId: permit.buildId, callId: permit.callId, accountId: 'account', modelId: permit.model, modelVersion: 'reviewed-v1', providerId: permit.providerId, endpoint: permit.endpoint, offerId: null, startedAt: now - 1 };
  return evaluateSurplusReceipt({ provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'server-dispatch-id', receiptId: permit.callId, requestId: permit.callId, currency: 'USD', buyerCostMicro: '1', costSource: 'usage.buyer_cost_micro', responseComplete: true, receivedAt: now, evidenceSha256: 'b'.repeat(64), additionalCharges: 'none', usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'mapping', tokens: { input: '10', output: '2', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff', sourceUrl: 'https://official.example/pricing', artifactSha256: 'c'.repeat(64), reviewId: 'tariff-review', reviewedAt: now - 2, reviewExpiresAt: now + 300000, effectiveFrom: now - 10, effectiveUntil: null, observedAt: now - 3, surplusModelId: permit.model, surplusModelVersion: 'reviewed-v1', officialModelId: permit.model, officialModelVersion: 'v1', modelMappingReviewId: 'model-mapping', usageMappingReviewId: 'mapping', currency: 'USD', billingBasis: 'tokens-only', usdPerMillionTokens: { input: '1', output: '2', cacheRead: '0.1', cacheWrite: 'not-supported', reasoning: '2' } },
  });
}
/** A market where `dead` pairs answer Surplus's documented 404 and every other pair serves. */
function market(pairs: Array<[string, string, string]>, dead: Set<string>, code = 'no_sellers_for_model') {
  const s = state(pairs);
  const calls: string[] = [];
  const adapter: SurplusReviewedAdapter = {
    readState: vi.fn(async () => s),
    routing: review => ({ provider: review.providerId, si_route: { objective: 'price' } }),
    dispatch: vi.fn(async (request: Record<string, unknown>) => {
      const pair = `${request.model}/${request.provider}`;
      calls.push(pair);
      if (dead.has(pair)) return { status: 404, body: { error: { type: 'invalid_request_error', code }, request_id: 'r1' }, _pair: pair };
      return { model: request.model, _pair: pair, choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
    }),
    identify: (raw: any) => {
      if (raw?.status === 404) throw new Error('refused');
      const [model, providerId] = String(raw._pair).split('/');
      return { model, providerId, completion: raw };
    },
    receipt: vi.fn(async (_raw, permit) => receipt(permit)),
    failure: vi.fn(async () => ({ canRetry: true })),
  };
  const make = () => createSurplusBuildSession({ buildId: `build-${Math.random()}`, tier: 'weak', enabled: true, adapter, now: () => now });
  return { make, calls };
}

beforeEach(() => resetSurplusPairRefusalsForTests());

describe('🔴 the reported market: the best-looking seller is dead, another seller of the SAME model serves', () => {
  const pairs: Array<[string, string, string]> = [['glm-5.3', 'dashscope-cn', '1'], ['glm-5.3', 'mistral', '5']];
  it('the dead pair is refused once, the SAME model answers on the next seller, and the model is not benched', async () => {
    const { make, calls } = market(pairs, new Set(['glm-5.3/dashscope-cn']));
    const seen: SurplusAttemptFailure[] = [];
    const r = await (await make()).runner({ onAttemptFailed: f => seen.push(f) }).runTurn(params as any);
    expect(r.text).toBe('done');
    expect(calls).toEqual(['glm-5.3/dashscope-cn', 'glm-5.3/mistral']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: 'glm-5.3', engineCode: 'no_sellers_for_model', benched: false });
  }, 20000);
  it('the NEXT build does not ask the dead seller again — it goes straight to the one that serves', async () => {
    const { make, calls } = market(pairs, new Set(['glm-5.3/dashscope-cn']));
    await (await make()).runner().runTurn(params as any);
    calls.length = 0;
    const r = await (await make()).runner().runTurn(params as any);
    expect(r.text).toBe('done');
    expect(calls).toEqual(['glm-5.3/mistral']);
  }, 20000);
  it('minimum_discount_not_met is the same kind of refusal (glm-5.3/zai: the market said 99.5%, the router 80%)', async () => {
    const { make, calls } = market(pairs, new Set(['glm-5.3/dashscope-cn']), 'minimum_discount_not_met');
    expect((await (await make()).runner().runTurn(params as any)).text).toBe('done');
    expect(calls).toEqual(['glm-5.3/dashscope-cn', 'glm-5.3/mistral']);
  }, 20000);
});

describe('🔁 reversion guard: any OTHER 404 still benches the model (the old rule, unchanged)', () => {
  it('a 404 with a non-market code moves to another model', async () => {
    const { make, calls } = market([['glm-5.3', 'dashscope-cn', '1'], ['glm-5.3', 'mistral', '5'], ['glm-5.2', 'zai', '9']], new Set(['glm-5.3/dashscope-cn']), 'model_unavailable');
    const seen: SurplusAttemptFailure[] = [];
    const r = await (await make()).runner({ onAttemptFailed: f => seen.push(f) }).runTurn(params as any);
    expect(r.text).toBe('done');
    expect(seen[0]).toMatchObject({ model: 'glm-5.3', benched: true });
    expect(calls).toEqual(['glm-5.3/dashscope-cn', 'glm-5.2/zai']); // the model left; its other seller was never tried
    expect(surplusPairRefused('glm-5.3', 'dashscope-cn', now)).toBe(false);
  }, 20000);
});

describe('the pair memory', () => {
  it('a pair that never served stays out 20 min; one that served recently only 2 min (a seller\'s momentary capacity)', () => {
    recordSurplusPairRefusal('glm-5.3', 'dashscope-cn', now);
    expect(surplusPairRefused('glm-5.3', 'dashscope-cn', now + SURPLUS_PAIR_UNSERVED_REFUSAL_MS - 1)).toBe(true);
    expect(surplusPairRefused('glm-5.3', 'dashscope-cn', now + SURPLUS_PAIR_UNSERVED_REFUSAL_MS)).toBe(false);
    recordSurplusPairServed('qwen3-coder', 'bedrock', now);
    recordSurplusPairRefusal('qwen3-coder', 'bedrock', now + 1000);
    expect(surplusPairRefused('qwen3-coder', 'bedrock', now + 1000 + SURPLUS_PAIR_SERVED_REFUSAL_MS - 1)).toBe(true);
    expect(surplusPairRefused('qwen3-coder', 'bedrock', now + 1000 + SURPLUS_PAIR_SERVED_REFUSAL_MS)).toBe(false);
  });
  it('serving clears a refusal at once, and the pair is per (model, provider), not per model', () => {
    recordSurplusPairRefusal('glm-5.3', 'dashscope-cn', now);
    expect(surplusPairRefused('glm-5.3', 'mistral', now)).toBe(false);
    recordSurplusPairServed('glm-5.3', 'dashscope-cn', now + 1);
    expect(surplusPairRefused('glm-5.3', 'dashscope-cn', now + 2)).toBe(false);
  });
});
