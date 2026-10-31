import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/aiMaintenance', () => ({ assertAiAvailable: vi.fn(async () => {}), aiMaintenanceStore: { onChange: () => () => {} }, AiMaintenanceError: class extends Error {} }));
import { createSurplusBuildSession, type SurplusReviewedAdapter, type SurplusReviewedState } from './buildSession';

// DNA failedbr 627/630: a failed mid-build Surplus turn (budget/deadline abort, transport) whose accounting
// did not settle poisoned the session → every later turn 503 previous_call_accounting_unavailable.
const now = 1800000000000;
const offer = (model: string, rate: string) => ({ model, offerId: `offer-${model}`, providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
  discountPct: 95, rates: { input: rate, output: rate }, referenceRates: { input: '100', output: '100' }, unit: 'unverified' as const, observedAt: now, upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: `https://www.surplusintelligence.ai/api/markets/${model}` });
function state(models: string[]): SurplusReviewedState {
  return {
    snapshot: { version: 'generation', startedAt: now, observedAt: now, expiresAt: now + 300000, models, offers: models.map((m, i) => offer(m, String(i + 1))) } as never,
    reviews: { quality: models.map(model => ({ binding: 'model-provider', model, providerId: 'provider-a', benchmarkId: 'bench', cohort: 'coding', approved: true, artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 300000 })), pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 }, accountAndPrivacyReviewedUntil: now + 300000 } as never,
    capabilities: models.map(model => ({ reviewId: 'capability', model, modelVersion: 'reviewed-v1', providerId: 'provider-a', reviewedAt: now - 1, expiresAt: now + 300000, contextTokens: 200000, maxOutputTokens: 8192, tools: true, parallelTools: true, transcriptRoundTrip: true, providerPinVerified: true, returnedIdentityVerified: true, reportedChargeContractVerified: true, endpoint: 'https://api.surplusintelligence.ai/min90/v1' as const })),
    floorContract: { kind: 'observation-only-provider-request-time-floor', endpoint: 'https://api.surplusintelligence.ai/min90/v1', reviewId: 'floor', reviewedAt: now - 1, expiresAt: now + 300000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false },
  };
}
const params = { model: 'x', system: 'build', messages: [{ role: 'user' as const, content: 'Make app' }], tools: [], maxTokens: 100 };
function setup(models: string[], failFirst: boolean, receiptThrows = false) {
  const s = state(models); let calls = 0;
  const adapter: SurplusReviewedAdapter = {
    readState: vi.fn(async () => s),
    routing: review => ({ provider: review.providerId, si_route: { objective: 'price' } }),
    dispatch: vi.fn(async (req: Record<string, unknown>) => {
      if (failFirst && calls++ === 0) throw new Error('build budget hit mid-flight');
      return { model: req.model, choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
    }),
    identify: (raw: unknown) => { const r = raw as { model: string }; return { model: r.model, providerId: 'provider-a', completion: raw as never }; },
    receipt: vi.fn(async () => { if (receiptThrows) throw new Error('receipt store unavailable'); return undefined; }),
  };
  return { adapter, make: () => createSurplusBuildSession({ buildId: 'b', tier: 'weak', enabled: true, adapter, now: () => now }) };
}
describe('Surplus unsettled failure accounting is absorbed (no poisoned session)', () => {
  it('next turn moves to Surplus-internal AI2 instead of 503 previous_call_accounting_unavailable', async () => {
    const { adapter, make } = setup(['model-a', 'model-b'], true);
    const session = await make(); const runner = session!.runner();
    await expect(runner.runTurn(params)).rejects.toThrow();
    const ok = await runner.runTurn(params);
    expect(ok.text).toBe('done'); expect(ok.model).toBe('model-b');
    expect((adapter.dispatch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toMatchObject({ model: 'model-b' });
  });
  it('failure receipt store throwing does not poison; later turn still runs', async () => {
    const { make } = setup(['model-a', 'model-b'], true, true);
    const session = await make(); const runner = session!.runner();
    await expect(runner.runTurn(params)).rejects.toThrow();
    await expect(runner.runTurn(params)).resolves.toMatchObject({ text: 'done' });
  });
  it('single Surplus model: un-benches and retries once on Surplus rather than refusing', async () => {
    const { make } = setup(['model-a'], true);
    const session = await make(); const runner = session!.runner();
    await expect(runner.runTurn(params)).rejects.toThrow();
    await expect(runner.runTurn(params)).resolves.toMatchObject({ text: 'done', model: 'model-a' });
  });
});
