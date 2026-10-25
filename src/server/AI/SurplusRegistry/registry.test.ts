import { describe, expect, it, vi } from 'vitest';
import { planSurplusBuild, planSurplusDispatchCandidate, type SurplusRequestFloorContract } from './selector';
import { normalizeOffers, syncSurplusMetadata, MARKET_ORIGIN } from './sync';
import { SurplusStore, SURPLUS_DOCUMENT } from './store';
import { NO_REVIEWS, type Observation, type Reviews, type Snapshot, type Store, type Workload } from './types';
const now = 1_800_000_000_000;
const workload: Workload = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
const offer: Observation = { model: 'model-a', offerId: 'offer-a', providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
  discountPct: 95, rates: { input: '100', output: '200' }, referenceRates: { input: '10000', output: '20000' }, unit: 'unverified',
  observedAt: now, upstreamGeneratedAt: now, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: `${MARKET_ORIGIN}/api/markets/model-a` };
const snapshot: Snapshot = { version: 'version-a', startedAt: now, observedAt: now, expiresAt: now + 300_000, models: ['model-a'], offers: [offer] };
const reviews: Reviews = { quality: [{ offerId: 'offer-a', model: 'model-a', providerId: 'provider-a', approved: true, cohort: 'coding-v1', benchmarkId: 'reviewed-run', artifactSha256: 'a'.repeat(64), reviewedAt: now - 1, expiresAt: now + 600_000 }],
  pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 600_000 }, accountAndPrivacyReviewedUntil: now + 600_000 };
const body = { model: 'model-a', offers: [{ id: 'offer-a', provider_id: 'provider-a', available: true, healthy: true, trusted: true,
  discount_pct: 95, effective_input_per_1m: 100, effective_output_per_1m: 200, direct_input_per_1m: 10000, direct_output_per_1m: 20000 }] };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', date: new Date(now).toUTCString(), age: '0', 'cache-control': 'public, max-age=30' } });

describe('Surplus phase-one preview policy', () => {
  it('never invents unit/quality/account review from market data', () => {
    expect(planSurplusBuild(snapshot, NO_REVIEWS, workload, now)).toMatchObject({ canDispatch: false, reason: 'pricing_units_not_independently_verified' });
    expect(planSurplusBuild(snapshot, { ...reviews, quality: [] }, workload, now)).toMatchObject({ reason: 'no_reviewed_coding_models' });
    expect(planSurplusBuild(snapshot, { ...reviews, accountAndPrivacyReviewedUntil: 0 }, workload, now)).toMatchObject({ reason: 'account_or_privacy_not_reviewed' });
  });
  it('blocks malformed persisted values and models outside the configured universe', () => {
    expect(planSurplusBuild({ ...snapshot, expiresAt: NaN }, reviews, workload, now).status).toBe('blocked');
    expect(planSurplusBuild({ ...snapshot, offers: [{ ...offer, trusted: 'false' as unknown as boolean }] }, reviews, workload, now).status).toBe('blocked');
    expect(planSurplusBuild({ ...snapshot, models: ['different-model'] }, reviews, workload, now).status).toBe('blocked');
    expect(planSurplusBuild(snapshot, null as unknown as Reviews, workload, now).status).toBe('blocked');
  });
  it('selects an estimate but never enables dispatch or wallet charging', () => {
    expect(planSurplusBuild(snapshot, reviews, workload, now)).toMatchObject({ canDispatch: false, status: 'estimated_candidate', selection: { estimatedMicroUsd: '0.120000', offerId: 'offer-a' } });
  });
  it('ranks full workload price rather than the biggest headline discount', () => {
    const moreExpensive = { ...offer, offerId: 'expensive', discountPct: 99.99, rates: { input: '100', output: '2000' } };
    const result = planSurplusBuild({ ...snapshot, offers: [moreExpensive, offer] }, { ...reviews, quality: [...reviews.quality, { ...reviews.quality[0], offerId: 'expensive' }] }, workload, now);
    expect(result.selection?.offerId).toBe('offer-a');
  });
  it.each(['cacheRead', 'cacheWrite', 'reasoning'] as const)('does not treat unknown %s prices as free', dimension => {
    expect(planSurplusBuild(snapshot, reviews, { ...workload, [dimension]: 10 }, now)).toMatchObject({ reason: 'no_eligible_90_percent_offer' });
  });
  it.each([{ available: false }, { healthy: false }, { trusted: false }, { discountPct: 89.9 }, { rates: { input: '9000', output: '19000' } }, { observedAt: now + 1 }, { sourceDate: now - 700_000 }, { sourceAgeSeconds: 301 }, { discountPct: NaN }, { upstreamGeneratedAt: null }, { observedAt: NaN }, { sourceAgeSeconds: -1 }, { providerTrustConfirmed: false }])('rejects unsafe offer %j', override => {
    expect(planSurplusBuild({ ...snapshot, offers: [{ ...offer, ...override }] }, reviews, workload, now).status).toBe('blocked');
  });
  it('fails closed on stale snapshot, expired reviews, or inconsistent quality cohorts', () => {
    expect(planSurplusBuild(snapshot, reviews, workload, now + 600_000).status).toBe('blocked');
    expect(planSurplusBuild(snapshot, { ...reviews, quality: [{ ...reviews.quality[0], expiresAt: now }] }, workload, now).status).toBe('blocked');
    expect(planSurplusBuild(snapshot, { ...reviews, quality: [...reviews.quality, { ...reviews.quality[0], cohort: 'unrelated-benchmark' }] }, workload, now).reason).toBe('incomparable_quality_cohorts');
  });
  it.each([-1, NaN, Infinity, 1.5])('rejects invalid token estimates %s', input => {
    expect(planSurplusBuild(snapshot, reviews, { ...workload, input }, now).reason).toBe('invalid_workload');
  });
});

describe('bounded public metadata sync', () => {
  it('preserves source cache observations and never infers units/cache prices', () => {
    const result = normalizeOffers('model-a', body, response(body).headers, now)[0];
    expect(result).toMatchObject({ unit: 'unverified', upstreamGeneratedAt: null, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30 });
    expect(result.rates.cacheRead).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('seller_base_url');
  });
  it('ignores unavailable/unhealthy/untrusted offers even if cheapest', () => {
    expect(normalizeOffers('model-a', { ...body, offers: [{ ...body.offers[0], available: false }, { ...body.offers[0], healthy: false }, { ...body.offers[0], trusted: false }] }, new Headers(), now)).toEqual([]);
  });
  it('fetches only bounded public detail URLs after a lease, without credentials', async () => {
    const store: Store = { read: async () => null, claim: vi.fn().mockResolvedValue({ token: 'lease', expiresAt: now + 120000 }), publish: vi.fn(), fail: vi.fn() };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ data: [{ id: 'provider-a', trusted: true }] })).mockResolvedValueOnce(response(body));
    expect(await syncSurplusMetadata(store, ['model-a'], 300000, fetcher, () => now)).toMatchObject({ status: 'synced', count: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]).toEqual([`${MARKET_ORIGIN}/api/markets/model-a`, expect.objectContaining({ method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } })]);
    expect(store.publish).toHaveBeenCalled();
  });
  it('retains a deterministic top slice when the eligible universe exceeds the bound', () => {
    const offers = Array.from({ length: 65 }, (_, i) => ({
      ...body.offers[0], id: `offer-${String(i).padStart(2, '0')}`,
      discount_pct: i === 64 ? 99 : 90, effective_input_per_1m: 100 + i, effective_output_per_1m: 200,
    }));
    const retained = normalizeOffers('model-a', { ...body, offers }, new Headers(), now);
    expect(retained).toHaveLength(64);
    expect(retained[0].offerId).toBe('offer-64');
    expect(retained.map(o => o.offerId)).not.toContain('offer-63'); // lowest-ranked of the 90% cohort dropped
  });
  it.each([NaN, Infinity, 1, 300001, 600000, 600001])('rejects invalid sync cadence before store/network (%s)', async interval => {
    const store = { claim: vi.fn() } as unknown as Store;
    const fetcher = vi.fn<typeof fetch>();
    await expect(syncSurplusMetadata(store, ['model-a'], interval, fetcher)).rejects.toThrow('configuration');
    expect(store.claim).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('held lease prevents all network work', async () => {
    const store = { claim: vi.fn().mockResolvedValue(null) } as unknown as Store;
    const fetcher = vi.fn<typeof fetch>();
    expect(await syncSurplusMetadata(store, ['model-a'], 300000, fetcher, () => now)).toEqual({ status: 'held' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([new Response('secret-provider-body', { status: 500 }), response({ model: 'wrong-model', offers: [] }), new Response('x'.repeat(2_000_001))])('records sanitized failure without publishing or renewing old data', async responseValue => {
    const store: Store = { read: async () => snapshot, claim: vi.fn().mockResolvedValue({ token: 'lease', expiresAt: now + 120000 }), publish: vi.fn(), fail: vi.fn() };
    expect(await syncSurplusMetadata(store, ['model-a'], 300000, vi.fn<typeof fetch>().mockResolvedValue(responseValue), () => now)).toEqual({ status: 'unavailable' });
    expect(store.publish).not.toHaveBeenCalled(); expect(store.fail).toHaveBeenCalled();
  });
});

function fakeDb() {
  const rows = new Map<string, Record<string, any>>();
  const doc = (path: string): any => ({ path, get: async () => ({ data: () => structuredClone(rows.get(path)) }) });
  let tail: Promise<unknown> = Promise.resolve();
  const db: any = { doc, runTransaction: (fn: any) => {
    const run = tail.then(() => fn({ get: (ref: any) => ref.get(), set: (ref: any, data: any, options?: any) => rows.set(ref.path, options?.merge ? { ...rows.get(ref.path), ...structuredClone(data) } : structuredClone(data)) }));
    tail = run.catch(() => {}); return run;
  } };
  return { db, rows };
}
describe('fixed-document fencing and provider isolation', () => {
  it('one worker wins concurrent claims; durable cooldown survives a new instance', async () => {
    const { db, rows } = fakeDb(); const store = new SurplusStore(db, () => now);
    const leases = await Promise.all([store.claim(now, 300000), new SurplusStore(db).claim(now, 300000)]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    await store.publish(leases.find(Boolean)!, snapshot);
    expect(await new SurplusStore(db).claim(now + 1, 300000)).toBeNull();
    expect([...rows.keys()]).toEqual([SURPLUS_DOCUMENT]);
  });
  it('rejects stale writer and cannot change OpenRouter data', async () => {
    const { db, rows } = fakeDb(); rows.set('live_ai_registry/openrouter', { sentinel: 'unchanged' });
    const store = new SurplusStore(db, () => now + 400000);
    const lease = (await store.claim(now, 300000))!;
    await store.claim(now + 300000, 300000);
    await expect(store.publish(lease, snapshot)).rejects.toThrow('fence');
    await store.fail(lease);
    expect(rows.get('live_ai_registry/openrouter')).toEqual({ sentinel: 'unchanged' });
    expect(rows.get(SURPLUS_DOCUMENT)?.lease).not.toBeNull();
  });
  it('failure preserves original snapshot timestamps and interval', async () => {
    const { db, rows } = fakeDb(); rows.set(SURPLUS_DOCUMENT, { snapshot });
    const store = new SurplusStore(db, () => now);
    const lease = (await store.claim(now, 300000))!; await store.fail(lease);
    expect(await store.read()).toEqual({ ...snapshot, controlRevision: 0 });
    expect(rows.get(SURPLUS_DOCUMENT)?.nextAllowedAt).toBe(now + 300000);
  });
});

describe('explicit request-time floor estimate mode', () => {
  const contract: SurplusRequestFloorContract = { kind: 'observation-only-provider-request-time-floor', endpoint: 'https://api.surplusintelligence.ai/min90/v1', reviewId: 'review-1', reviewedAt: now - 1, expiresAt: now + 600000, providerPin: 'top-level-provider', objective: 'price', marketplaceOnly: true, allowFallbacks: false };
  const floorReviews: Reviews = { ...reviews, quality: [{ ...reviews.quality[0], offerId: undefined, binding: 'model-provider' }] };
  const observation = { ...snapshot, offers: [{ ...offer, upstreamGeneratedAt: null }] };
  it('keeps the default strict mode blocked and missing origin time unknown', () => {
    expect(planSurplusBuild(observation, reviews, workload, now).status).toBe('blocked');
    expect(planSurplusDispatchCandidate(observation, floorReviews, workload, now, contract)).toMatchObject({ canDispatch: false, status: 'estimated_candidate', observationBasis: 'request-time-floor-required' });
    expect(observation.offers[0].upstreamGeneratedAt).toBeNull();
  });
  it.each([{ expiresAt: now }, { reviewedAt: now + 1 }, { expiresAt: NaN }, { reviewId: '' }, { endpoint: 'https://api.surplusintelligence.ai/v1' }, { marketplaceOnly: false }, { allowFallbacks: true }, { providerPin: 'none' }])('rejects malformed/expired review %j', change => {
    expect(planSurplusDispatchCandidate(observation, floorReviews, workload, now, { ...contract, ...change } as SurplusRequestFloorContract).status).toBe('blocked');
  });
  it.each([{ sourceDate: null }, { sourceDate: now - 300001 }, { cacheMaxAgeSeconds: null }, { cacheMaxAgeSeconds: 301 }, { sourceAgeSeconds: 301 }, { observedAt: now - 300001 }, { upstreamGeneratedAt: NaN }])('rejects stale or unbounded observation %j', change => {
    expect(planSurplusDispatchCandidate({ ...observation, offers: [{ ...observation.offers[0], ...change }] }, floorReviews, workload, now, contract).status).toBe('blocked');
  });
  it('rejects exact-offer-only review even when the observed offer matches', () => {
    expect(planSurplusDispatchCandidate(observation, reviews, workload, now, contract)).toMatchObject({ status: 'blocked', reason: 'no_reviewed_coding_models' });
    expect(planSurplusDispatchCandidate(observation, { ...reviews, quality: [{ ...reviews.quality[0], binding: 'exact-offer' }] }, workload, now, contract).status).toBe('blocked');
    expect(planSurplusBuild(snapshot, reviews, workload, now).status).toBe('estimated_candidate');
  });
  it('requires explicit model-provider review for a different offer identity', () => {
    const changedOffer = { ...observation, offers: [{ ...observation.offers[0], offerId: 'new-offer' }] };
    expect(planSurplusDispatchCandidate(changedOffer, reviews, workload, now, contract).status).toBe('blocked');
    const broadReview: Reviews = { ...reviews, quality: [{ ...reviews.quality[0], offerId: undefined, binding: 'model-provider' }] };
    expect(planSurplusDispatchCandidate(changedOffer, broadReview, workload, now, contract).status).toBe('estimated_candidate');
    expect(planSurplusBuild(changedOffer, broadReview, workload, now).status).toBe('blocked');
    expect(planSurplusDispatchCandidate(changedOffer, { ...broadReview, quality: [{ ...broadReview.quality[0], providerId: 'wrong-provider' }] }, workload, now, contract).status).toBe('blocked');
  });
  it('does not bypass independent unit/account/quality reviews or workload costs', () => {
    expect(planSurplusDispatchCandidate(observation, NO_REVIEWS, workload, now, contract).status).toBe('blocked');
    expect(planSurplusDispatchCandidate(observation, floorReviews, { ...workload, cacheRead: 1 }, now, contract).status).toBe('blocked');
  });
});
