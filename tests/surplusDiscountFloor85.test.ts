/**
 * Admin decision 2026-11-27 — the Surplus discount floor, locked.
 *
 * 1. The floor is 85% (was 90%). Among offers that clear it, the strongest model builds.
 * 2. The user charge is 10 × the verified actual cost, but never above the model's list price for the same usage.
 * 3. Weak may run a Claude-family model (Claude / Sonnet / Opus) ONLY through Surplus with a guaranteed ≥ 90% discount:
 *    such a request is sent on `/min90`, and its offer must also clear 90%. Everywhere else Weak stays Claude-free.
 * 4. Official route shape: `/min{N}/v1` (N = 0..100, no leading zeros), and `/anthropic/min{N}/v1` for Messages.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import {
  SURPLUS_CLAUDE_MIN_DISCOUNT_PCT, SURPLUS_MIN_DISCOUNT_PCT, isSurplusClaudeFamily, surplusBaseUrl, surplusBuildEndpoint,
  surplusBuildEndpointValid, surplusBuildFloor, surplusFloorFor, surplusFloorOfEndpoint, surplusModelPermitted,
} from '../src/server/AI/SurplusRegistry/config';
import { planSurplusBuild, planSurplusDispatchCandidate, type SurplusRequestFloorContract } from '../src/server/AI/SurplusRegistry/selector';
import { evaluateSurplusReceipt, type SurplusReceiptPolicyInput } from '../src/server/AI/SurplusRegistry/receiptPolicy';
import { persistSurplusReceipt, reserveSurplusAttempt, type SurplusReceiptAudit } from '../src/server/AI/SurplusRegistry/receiptStore';
import { createSurplusBuildTransport, SurplusBuildTransportError } from '../src/server/AI/SurplusRegistry/transport';
import { createSurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from '../src/server/AI/SurplusRegistry/buildSession';
import { TIER_LADDERS, parseLadderOverride } from '../src/server/AgentV3/tierLadder';
import { claudeBlockedInZone, runInNoClaudeZone } from '../src/server/AgentV3/noClaudeZone';
import { chooseModels } from '../src/server/lib/modelChoice';
import type { Observation, Reviews, Snapshot, Workload } from '../src/server/AI/SurplusRegistry/types';

const now = 1_800_000_000_000;
const PLAIN = 'glm-5.3';
const CLAUDE = 'claude-sonnet-5';

describe('the floor per model (one source of truth)', () => {
  it('is 85 for every model and 90 for a Claude-family model on Weak', () => {
    expect(SURPLUS_MIN_DISCOUNT_PCT).toBe(85);
    expect(SURPLUS_CLAUDE_MIN_DISCOUNT_PCT).toBe(90);
    for (const m of [PLAIN, 'deepseek-v4.1-flash', 'gpt-5.6-sol', 'qwen3-coder']) expect(surplusFloorFor(m, 'weak')).toBe(85);
    for (const m of [CLAUDE, 'claude-opus-4-7', 'anthropic/sonnet-latest', 'Claude-Haiku-4']) {
      expect(isSurplusClaudeFamily(m)).toBe(true);
      expect(surplusFloorFor(m, 'weak')).toBe(90);
      expect(surplusBuildFloor(m)).toBe(90);
    }
  });
});

describe('official minimum-discount route shapes', () => {
  it('builds /min85/v1, /min90/v1 and /anthropic/min90/v1', () => {
    expect(surplusBaseUrl(85)).toBe('https://api.surplusintelligence.ai/min85/v1');
    expect(surplusBaseUrl(90)).toBe('https://api.surplusintelligence.ai/min90/v1');
    expect(surplusBaseUrl(90, 'anthropic')).toBe('https://api.surplusintelligence.ai/anthropic/min90/v1');
    expect(surplusBuildEndpoint(PLAIN)).toBe('https://api.surplusintelligence.ai/min85/v1');
    expect(surplusBuildEndpoint(CLAUDE)).toBe('https://api.surplusintelligence.ai/min90/v1');
  });
  it.each([85.5, -1, 101, NaN])('refuses the non-documented floor %s', floor => {
    expect(() => surplusBaseUrl(floor)).toThrow();
  });
  it('reads the floor back from a route and rejects leading zeros or another host', () => {
    expect(surplusFloorOfEndpoint('https://api.surplusintelligence.ai/min85/v1/chat/completions')).toBe(85);
    expect(surplusFloorOfEndpoint('https://api.surplusintelligence.ai/anthropic/min90/v1/messages')).toBe(90);
    expect(surplusFloorOfEndpoint('https://api.surplusintelligence.ai/min085/v1')).toBeNull();
    expect(surplusFloorOfEndpoint('https://api.surplusintelligence.ai/v1')).toBeNull();
    expect(surplusFloorOfEndpoint('https://evil.test/min90/v1')).toBeNull();
  });
  it('accepts a builder route only at or above the model floor', () => {
    expect(surplusBuildEndpointValid('https://api.surplusintelligence.ai/min85/v1', PLAIN)).toBe(true);
    expect(surplusBuildEndpointValid('https://api.surplusintelligence.ai/min84/v1', PLAIN)).toBe(false);
    expect(surplusBuildEndpointValid('https://api.surplusintelligence.ai/min90/v1', CLAUDE)).toBe(true);
    expect(surplusBuildEndpointValid('https://api.surplusintelligence.ai/min89/v1', CLAUDE)).toBe(false);
    expect(surplusBuildEndpointValid('https://api.surplusintelligence.ai/min85/v1', CLAUDE)).toBe(false);
    expect(surplusBuildEndpointValid('https://api.surplusintelligence.ai/v1', PLAIN)).toBe(false);
  });
});

// Offer whose reported AND workload-weighted discount are both exactly `discount` percent.
function offerAt(model: string, discount: number): Observation {
  const pay = (ref: number) => String(Math.round(ref * (100 - discount) * 100) / 10000);
  return { model, offerId: `offer-${model}`, providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
    discountPct: discount, rates: { input: pay(10000), output: pay(20000) }, referenceRates: { input: '10000', output: '20000' }, unit: 'unverified',
    observedAt: now, upstreamGeneratedAt: now, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: `https://api.surplusintelligence.ai/api/markets/${model}` };
}
const workload: Workload = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
function plan(offers: Observation[]) {
  const snapshot: Snapshot = { version: 'v', startedAt: now, observedAt: now, expiresAt: now + 300_000, models: offers.map(o => o.model), offers };
  const reviews: Reviews = { quality: offers.map(o => ({ offerId: o.offerId, model: o.model, providerId: o.providerId, approved: true, cohort: 'coding', benchmarkId: 'b', artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 600_000 })),
    pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 600_000 }, accountAndPrivacyReviewedUntil: now + 600_000 };
  return planSurplusBuild(snapshot, reviews, workload, now);
}

describe('selector eligibility at the floor', () => {
  it.each([[84.9, false], [85, true], [89.9, true], [90, true]] as const)('a non-Claude offer at %s percent is eligible: %s', (discount, ok) => {
    const result = plan([offerAt(PLAIN, discount)]);
    expect(result.status === 'estimated_candidate').toBe(ok);
    if (!ok) expect(result.reason).toBe('no_eligible_discount_offer');
  });
  it.each([[84.9, false], [85, false], [89.9, false], [90, true]] as const)('a Claude-family offer at %s percent is eligible: %s', (discount, ok) => {
    expect(plan([offerAt(CLAUDE, discount)]).status === 'estimated_candidate').toBe(ok);
  });
  it('lets the strongest model win among offers that clear their floor (Claude first when ≥ 90%)', () => {
    expect(plan([offerAt(PLAIN, 99), offerAt(CLAUDE, 92)]).selection?.model).toBe(CLAUDE);
    expect(plan([offerAt(PLAIN, 86), offerAt(CLAUDE, 89.9)]).selection?.model).toBe(PLAIN);
  });
  it('accepts a min85 request-time floor contract and refuses a lower one', () => {
    const offers = [offerAt(PLAIN, 86)];
    const snapshot: Snapshot = { version: 'v', startedAt: now, observedAt: now, expiresAt: now + 300_000, models: [PLAIN], offers };
    const reviews: Reviews = { quality: [{ binding: 'model-provider', model: PLAIN, providerId: 'provider-a', approved: true, cohort: 'coding', benchmarkId: 'b', artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 600_000 }],
      pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 600_000 }, accountAndPrivacyReviewedUntil: now + 600_000 };
    const contract = (endpoint: string): SurplusRequestFloorContract => ({ kind: 'observation-only-provider-request-time-floor', endpoint, reviewId: 'r', reviewedAt: now - 1, expiresAt: now + 600_000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false });
    expect(planSurplusDispatchCandidate(snapshot, reviews, workload, now, contract(surplusBaseUrl(85))).status).toBe('estimated_candidate');
    expect(planSurplusDispatchCandidate(snapshot, reviews, workload, now, contract(surplusBaseUrl(84))).reason).toBe('request_time_floor_contract_not_reviewed');
  });
});

describe('Claude on Weak: only through Surplus on a guaranteed ≥ 90% floor', () => {
  it('a Surplus session may choose Claude only on Weak', () => {
    expect(surplusModelPermitted(CLAUDE, 'weak')).toBe(true);
    for (const tier of ['off', 'strong', 'normal']) expect(surplusModelPermitted(CLAUDE, tier)).toBe(false);
    expect(surplusModelPermitted(PLAIN, 'strong')).toBe(true);
  });
  it('the Weak ladder, its override, the no-Claude zone and the shared model rule still refuse Sonnet/Opus', () => {
    expect(TIER_LADDERS.weak.some(r => r.provider === 'CLAUDE' || r.provider === 'CLAUDE_OPUS')).toBe(false);
    expect(parseLadderOverride('weak', 'GLM:glm-5.3,SONNET').rejected).toMatch(/never run on weak/);
    expect(parseLadderOverride('weak', 'OPUS').rejected).toMatch(/never run on weak/);
    expect(runInNoClaudeZone({ active: true }, () => claudeBlockedInZone('claude-sonnet-4-6'))).toBe(true);
    expect(runInNoClaudeZone({ active: true }, () => claudeBlockedInZone('claude-opus-4-7'))).toBe(true);
    expect(chooseModels([{ id: 'claude-sonnet-4-6' }, { id: 'glm-5.3' }], { purpose: 'coding', noClaude: true }).models).not.toContain('claude-sonnet-4-6');
  });
  it('the build transport refuses any route below the 85% builder floor and posts on the one it is given', async () => {
    const env = { AGENTV3_SURPLUS_BUILDER: 'true', SURPLUS_API_KEY: 'test-only-not-a-real-key' };
    expect(() => createSurplusBuildTransport(env, vi.fn(), 'https://api.surplusintelligence.ai/min84/v1')).toThrow(SurplusBuildTransportError);
    expect(() => createSurplusBuildTransport(env, vi.fn(), 'https://api.surplusintelligence.ai/v1')).toThrow(SurplusBuildTransportError);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 }));
    await createSurplusBuildTransport(env, fetcher, surplusBuildEndpoint(CLAUDE))({ model: CLAUDE, provider: 'p', si_route: { objective: 'price' }, messages: [{ role: 'user', content: 'x' }], stream: false, max_tokens: 10 }, new AbortController().signal);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.surplusintelligence.ai/min90/v1/chat/completions');
  });

  function sessionState(claudeDiscount: number, claudeEndpoint = surplusBuildEndpoint(CLAUDE)): SurplusReviewedState {
    const offers = [offerAt(PLAIN, 95), offerAt(CLAUDE, claudeDiscount)].map(o => ({ ...o, upstreamGeneratedAt: null }));
    const cap = (model: string, endpoint: string) => ({ reviewId: `cap-${model}`, model, modelVersion: 'v1', providerId: 'provider-a', reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true as const, parallelTools: true as const, transcriptRoundTrip: true as const, providerPinVerified: true as const, returnedIdentityVerified: true as const, reportedChargeContractVerified: true as const, endpoint });
    return {
      snapshot: { version: 'g', startedAt: now, observedAt: now, expiresAt: now + 300000, models: [PLAIN, CLAUDE], offers },
      reviews: { quality: offers.map(o => ({ binding: 'model-provider' as const, model: o.model, providerId: o.providerId, benchmarkId: 'b', cohort: 'coding', approved: true, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 })),
        pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 },
      capabilities: [cap(PLAIN, surplusBuildEndpoint(PLAIN)), cap(CLAUDE, claudeEndpoint)],
      floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: surplusBaseUrl(85), reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
    };
  }
  async function sessionModel(state: SurplusReviewedState, tier = 'weak') {
    const adapter: SurplusReviewedAdapter = { readState: vi.fn(async () => state), routing: r => ({ provider: r.providerId, si_route: { objective: 'price' } }),
      dispatch: vi.fn(), identify: vi.fn(), receipt: vi.fn() };
    return (await createSurplusBuildSession({ buildId: 'b', tier, enabled: true, adapter, now: () => now }))?.model;
  }
  it('a Weak build picks Claude when its offer clears 90% on the /min90 route', async () => {
    expect(await sessionModel(sessionState(92))).toBe(CLAUDE);
  });
  it('a Weak build never picks Claude below 90%, nor on a route below /min90', async () => {
    expect(await sessionModel(sessionState(89.9))).toBe(PLAIN);
    expect(await sessionModel(sessionState(95, surplusBaseUrl(85)))).toBe(PLAIN);
  });
  it('Surplus never serves Normal or Strong at all', async () => {
    await expect(sessionModel(sessionState(95), 'strong')).rejects.toThrow();
  });
});

function receiptInput(listPrice: SurplusReceiptPolicyInput['listPrice']): SurplusReceiptPolicyInput {
  const binding = { buildId: 'b', callId: 'c', accountId: 'a', modelId: 'm', modelVersion: 'v1', providerId: 'p', endpoint: surplusBaseUrl(85), offerId: null, startedAt: now - 1000 };
  return { provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now, listPrice,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'provider-response-id', receiptId: 'r', requestId: 'q', currency: 'USD', buyerCostMicro: 100, costSource: 'usage.buyer_cost_micro', responseComplete: true,
      receivedAt: now - 100, evidenceSha256: 'a'.repeat(64), additionalCharges: 'none',
      usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'u', tokens: { input: '900', output: '80', cacheRead: '100', cacheWrite: '0', reasoning: '20' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 't', sourceUrl: 'https://official-provider.example/pricing', artifactSha256: 'b'.repeat(64), reviewId: 'r', reviewedAt: now - 2000, reviewExpiresAt: now + 10000,
      effectiveFrom: now - 10000, effectiveUntil: null, observedAt: now - 3000, surplusModelId: 'm', surplusModelVersion: 'v1', officialModelId: 'o', officialModelVersion: 'v', modelMappingReviewId: 'mm', usageMappingReviewId: 'u',
      currency: 'USD', billingBasis: 'tokens-only', usdPerMillionTokens: { input: '1', output: '2', cacheRead: '0.1', cacheWrite: '0.5', reasoning: '2' } },
  };
}

describe('billing: 10 × actual, capped at list price', () => {
  it('an 86% offer is charged at list price (below 10 × actual, never below actual)', () => {
    // list / actual = 100/14 = 7.142857…; actual is $0.0001, so list = $0.000714285714285714…, rounded DOWN.
    const d = evaluateSurplusReceipt(receiptInput({ rates: { input: '14', output: '28' }, referenceRates: { input: '100', output: '200' } }));
    expect(d).toMatchObject({ status: 'chargeable', reason: 'list_price_cap', actualCostUsd: '0.0001', userChargeUsd: '0.0007142857142857', policyId: 'surplus-build-10x-list-cap-v2' });
    expect(Number(d.userChargeUsd)).toBeLessThan(0.001);
    expect(Number(d.userChargeUsd)).toBeGreaterThan(0.0001);
  });
  it('a 95% offer is charged 10 × actual', () => {
    expect(evaluateSurplusReceipt(receiptInput({ rates: { input: '5', output: '10' }, referenceRates: { input: '100', output: '200' } })))
      .toMatchObject({ reason: 'ten_times_verified_actual_cost', userChargeUsd: '0.001' });
  });
  it('exactly 90% is 10 × actual (10 × actual equals list)', () => {
    expect(evaluateSurplusReceipt(receiptInput({ rates: { input: '10', output: '20' }, referenceRates: { input: '100', output: '200' } })))
      .toMatchObject({ reason: 'ten_times_verified_actual_cost', userChargeUsd: '0.001' });
  });
  it('an unknown list price keeps 10 × actual and says so (no invented cost)', () => {
    expect(evaluateSurplusReceipt(receiptInput({ rates: { input: '14' }, referenceRates: { input: '100', output: '200' } })))
      .toMatchObject({ reason: 'ten_times_verified_actual_cost_list_price_unknown', userChargeUsd: '0.001' });
    expect(evaluateSurplusReceipt(receiptInput(null))).toMatchObject({ reason: 'ten_times_verified_actual_cost_list_price_unknown', userChargeUsd: '0.001' });
  });
});

describe('receipt quarantine at the request floor', () => {
  // Realized discount 87%: inside the 85% floor, outside the 90% one.
  async function quarantine(endpoint: string) {
    const pilot = { id: 'authorized-pilot', expiresAt: now + 10000, maxCalls: 2, maxEstimatedMicroUsd: '100', providerSpendLimitReviewedUntil: now + 10000, noAutoTopup: true as const };
    const input = { buildId: 'b', callId: 'c', accountId: 'a', credentialSha256: 'a'.repeat(64), model: 'm', providerId: 'p', endpoint, policyVersion: 'policy', priceGeneration: 'g', estimatedMicroUsd: '30', reviewRevision: 1, pilot, now };
    const docs = new Map<string, any>();
    const db = { doc: (path: string) => ({ path }), runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const writes = new Map<string, any>();
      const result = await fn({ get: async (ref: { path: string }) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }), set: (ref: { path: string }, value: unknown) => writes.set(ref.path, structuredClone(value)) });
      for (const [k, v] of writes) docs.set(k, v); return result;
    } } as never;
    await reserveSurplusAttempt(db, input);
    const audit: SurplusReceiptAudit = { buildId: 'b', callId: 'c', accountId: 'a', model: 'm', providerId: 'p', endpoint, policyVersion: 'policy', priceGeneration: 'g', reportedAt: now + 1, usage: null, invoiceReconciliation: 'not-reconciled',
      decision: { actualCostUsd: '0.000013', officialCeilingUsd: '0.0001', userChargeUsd: '0.0001', evidenceFingerprint: 'f', status: 'chargeable' } as never };
    await persistSurplusReceipt(db, audit);
    return [...docs.entries()].find(([key]) => key.startsWith('surplus_build_receipts/'))![1].quarantineReason ?? null;
  }
  it('passes an 87% realized discount on a /min85 request', async () => {
    expect(await quarantine(surplusBaseUrl(85))).toBeNull();
  });
  it('quarantines the same 87% on a /min90 (Claude) request', async () => {
    expect(await quarantine(surplusBaseUrl(90))).toBe('realized_discount_below_floor');
  });
  it('holds an endpoint without a readable floor to the strict 90', async () => {
    expect(await quarantine('unknown-route')).toBe('realized_discount_below_floor');
  });
});
