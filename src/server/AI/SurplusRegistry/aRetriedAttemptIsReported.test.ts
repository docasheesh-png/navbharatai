/**
 * Q-3019 (failedbr #2478, "make a bgmi for me"): ~7.5 of 25 minutes went to Surplus calls that switched model with a
 * cold cache (same-model median 4.6 s, after a switch 36.7 s). Every switch followed a failed attempt that was
 * retried INSIDE the session — the report showed 79 "ok" calls and "no engine wasted any time". A retried attempt
 * now reaches the report (PROVIDER_FALLBACK + the per-provider tally the AI Engines page reads), with codes only.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { evaluateSurplusReceipt } from './receiptPolicy';
import type { SurplusTurnPermit } from '../../AgentV3/providers/SurplusTurnRunner';
import { describeSurplusAttemptFailure, type SurplusAttemptFailure, createSurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from './buildSession';
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

import { readFileSync } from 'node:fs';

async function failOnceThenAnswer() {
  const { adapter, make } = setup();
  const ok = (adapter.dispatch as any).getMockImplementation();
  let n = 0;
  (adapter.dispatch as any).mockImplementation(async (...a: unknown[]) => { if (n++ === 0) throw new Error('socket hang up at 10.0.0.7 key=sk-secret'); return ok(...a); });
  const session = await make();
  const seen: SurplusAttemptFailure[] = [];
  const r = await session.runner({ onAttemptFailed: f => seen.push(f) }).runTurn(params as any);
  return { r, seen, dispatches: n };
}

describe('a retried Surplus attempt reaches the report', () => {
  it('one failed attempt → exactly one notice, naming model, stage and reason; the turn still answers', async () => {
    process.env.SURPLUS_TURN_RETRIES = '1';
    try {
      const { r, seen, dispatches } = await failOnceThenAnswer();
      expect(r.text).toBe('done');
      expect(dispatches).toBe(2);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ model: 'model-a', stage: 'dispatch', reason: 'dispatch_failed', attempt: 1, benched: true });
    } finally { delete process.env.SURPLUS_TURN_RETRIES; }
  }, 20000);

  it('codes only — the raw provider text never reaches the notice', async () => {
    process.env.SURPLUS_TURN_RETRIES = '1';
    try {
      const { seen } = await failOnceThenAnswer();
      const line = describeSurplusAttemptFailure(seen[0]);
      expect(JSON.stringify(seen) + line).not.toMatch(/socket|10\.0\.0\.7|sk-secret/);
      expect(line).toBe('Surplus attempt 1 on model-a failed (dispatch: dispatch_failed) — model-a is benched for this build');
    } finally { delete process.env.SURPLUS_TURN_RETRIES; }
  }, 20000);

  it('the sentence says what a switch costs and what a retry waits', () => {
    expect(describeSurplusAttemptFailure({ model: 'qwen3-coder', stage: 'dispatch', reason: 'empty_completion', attempt: 2, benched: true, nextModel: 'glm-5.3-flash' }))
      .toBe('Surplus attempt 2 on qwen3-coder failed (dispatch: empty_completion) — qwen3-coder is benched for this build; the next turn moves to glm-5.3-flash, whose cache is cold');
    expect(describeSurplusAttemptFailure({ model: 'qwen3-coder', stage: 'turn', reason: 'turn_timeout', attempt: 1, elapsedMs: 240000, retryInMs: 2000 }))
      .toBe('Surplus attempt 1 on qwen3-coder failed (turn: turn_timeout) after 240s — retrying in 2s');
  });

  it('both places that create a Surplus runner for a build forward the notice to the report (wiring)', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const wired = route.match(/onAttemptFailed: \(failure\) => opts\.onProviderError\?\.\('SURPLUS', new Error\(describeSurplusAttemptFailure\(failure\)\)\)/g) ?? [];
    const runners = route.match(/surplusSession\??\.runner\(\{/g) ?? [];
    expect(runners.length).toBeGreaterThan(0);
    expect(wired.length).toBe(runners.length);
  });
});
