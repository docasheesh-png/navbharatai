import { describe, expect, it, vi } from 'vitest';
import { SURPLUS_MAX_MODELS, SURPLUS_MAX_OFFERS, SURPLUS_METADATA_FRESH_MS } from './config';
import { SurplusStore, SURPLUS_DOCUMENT, readSurplusModelControls } from './store';
import { syncSurplusMetadata } from './sync';
import { planSurplusBuild } from './selector';
import { NO_REVIEWS, type Observation, type Reviews, type Snapshot, type Store } from './types';
const now = 1_800_000_000_000;
const modelIds = Array.from({ length: 15 }, (_, index) => `model-${index}`);
const offer: Observation = { model: 'model-0', offerId: 'offer-0', providerId: 'provider-a', available: true, healthy: true, trusted: true, providerTrustConfirmed: true, trustObservedAt: now,
  discountPct: 95, rates: { input: '1', output: '2' }, referenceRates: { input: '100', output: '200' }, unit: 'unverified',
  observedAt: now, upstreamGeneratedAt: now, sourceDate: now, sourceAgeSeconds: 0, cacheMaxAgeSeconds: 30, sourceUrl: 'https://api.surplusintelligence.ai/api/markets/model-0' };
const snapshot: Snapshot = { version: 'version-a', startedAt: now, observedAt: now, expiresAt: now + SURPLUS_METADATA_FRESH_MS, models: modelIds, offers: [offer] };
const market = (model: string) => ({ model, offers: [{ id: `offer-${model}`, provider_id: 'provider-a', available: true, healthy: true, trusted: true,
  discount_pct: 95, effective_input_per_1m: 1, effective_output_per_1m: 2, direct_input_per_1m: 100, direct_output_per_1m: 200 }] });
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { date: new Date(now).toUTCString(), age: '0', 'cache-control': 'max-age=30' } });
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
describe('fifteen-model shared metadata manager', () => {
  it('uses at most three concurrent public reads and publishes one fresh complete snapshot', async () => {
    let active = 0, peak = 0;
    const store: Store = { read: async () => null, claim: vi.fn().mockResolvedValue({ token: 'lease', expiresAt: now + 120000 }), publish: vi.fn(), fail: vi.fn() };
    const fetcher = vi.fn<typeof fetch>(async url => {
      active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
      const path = String(url);
      return response(path.endsWith('/v1/providers') ? { data: [{ id: 'provider-a', trusted: true }] } : market(decodeURIComponent(path.split('/').pop()!)));
    });
    expect(await syncSurplusMetadata(store, modelIds, 300000, fetcher, () => now)).toEqual({ status: 'synced', count: 15 });
    expect(peak).toBe(3); expect(fetcher).toHaveBeenCalledTimes(16);
    expect(store.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ models: modelIds, expiresAt: now + 300000 }));
    expect(store.fail).not.toHaveBeenCalled();
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/api\.surplusintelligence\.ai\/(v1\/providers|api\/markets\/model-\d+)$/);
      expect(options).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error' });
    }
  });
  it('rejects a sixteenth model before lease or network', async () => {
    const store = { claim: vi.fn() } as unknown as Store, fetcher = vi.fn<typeof fetch>();
    await expect(syncSurplusMetadata(store, [...modelIds, 'model-15'], 300000, fetcher)).rejects.toThrow('configuration');
    expect(store.claim).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('failed member settles its group and cannot publish partial or refresh old data', async () => {
    const { db, rows } = fakeDb(); rows.set(SURPLUS_DOCUMENT, { snapshot });
    const store = new SurplusStore(db, () => now); let active = 0;
    const fetcher = vi.fn<typeof fetch>(async url => {
      active++; await Promise.resolve(); active--;
      const path = String(url);
      if (path.endsWith('model-1')) return new Response('PRIVATE_PROVIDER_ERROR', { status: 503 });
      return response(path.endsWith('/v1/providers') ? { data: [{ id: 'provider-a', trusted: true }] } : market(path.split('/').pop()!));
    });
    expect(await syncSurplusMetadata(store, modelIds, 300000, fetcher, () => now)).toEqual({ status: 'unavailable' });
    expect(active).toBe(0); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(rows.get(SURPLUS_DOCUMENT)).toMatchObject({ snapshot, lastAttemptAt: now, nextAllowedAt: now + 300000, lastError: 'metadata_unavailable' });
    expect(rows.get(SURPLUS_DOCUMENT)?.lastSuccessAt).toBeUndefined();
  });
  it('accepts fifteen candidates in selector but still requires independent reviews', () => {
    const workload = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    expect(planSurplusBuild(snapshot, NO_REVIEWS, workload, now).reason).toBe('pricing_units_not_independently_verified');
    expect(planSurplusBuild({ ...snapshot, models: [...modelIds, 'model-15'] }, NO_REVIEWS, workload, now).reason).toBe('stale_or_missing_snapshot');
    expect(SURPLUS_MAX_MODELS).toBe(15); expect(SURPLUS_MAX_OFFERS).toBe(960);
  });
  it('compares the same reviewed workload across all fifteen rather than dropping late cheap candidates', () => {
    const offers = modelIds.map((model, index) => ({ ...offer, model, offerId: `offer-${index}`, rates: { input: String(15 - index), output: '2' }, referenceRates: { input: '1000', output: '2000' } }));
    const reviews: Reviews = { pricingContract: { unit: 'micro-usd-per-million', sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing', reviewedAt: now - 1, expiresAt: now + 300000 },
      accountAndPrivacyReviewedUntil: now + 300000,
      quality: offers.map(item => ({ offerId: item.offerId, model: item.model, providerId: item.providerId, benchmarkId: 'same-coding-run', cohort: 'same-coding-cohort', artifactSha256: 'a'.repeat(64), approved: true, reviewedAt: now - 1, expiresAt: now + 300000 })) };
    const result = planSurplusBuild({ ...snapshot, offers }, reviews, { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, now);
    expect(result).toMatchObject({ canDispatch: false, status: 'estimated_candidate', selection: { model: 'model-14' } });
    expect(result.configuredUniverse).toHaveLength(15);
  });
  it('rejects aggregate count and byte overflows without partial storage', async () => {
    const { db, rows } = fakeDb(), store = new SurplusStore(db, () => now);
    const lease = (await store.claim(now, 300000))!;
    await expect(store.publish(lease, { ...snapshot, offers: Array.from({ length: 961 }, () => offer) })).rejects.toThrow('exceeds bound');
    await expect(store.publish(lease, { ...snapshot, offers: [{ ...offer, sourceUrl: 'x'.repeat(500001) }] })).rejects.toThrow('exceeds bound');
    expect(rows.get(SURPLUS_DOCUMENT)?.snapshot).toBeUndefined();
  });
  it('uses a single durable cooldown across manager instances and records real sync times', async () => {
    const { db, rows } = fakeDb(), first = new SurplusStore(db, () => now), second = new SurplusStore(db, () => now);
    const leases = await Promise.all([first.claim(now, 300000), second.claim(now, 300000)]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    await first.publish(leases.find(Boolean)!, snapshot);
    expect(await new SurplusStore(db).claim(now + 299999, 300000)).toBeNull();
    expect(rows.get(SURPLUS_DOCUMENT)).toMatchObject({ lastAttemptAt: now, lastSuccessAt: now, nextAllowedAt: now + 300000 });
    expect([...rows.keys()]).toEqual([SURPLUS_DOCUMENT]);
  });
});
describe('durable manual exclusions without invented approvals', () => {
  it('applies a disable immediately, survives polling, and re-enable only removes the exclusion', async () => {
    const { db, rows } = fakeDb(); rows.set(SURPLUS_DOCUMENT, { snapshot });
    const store = new SurplusStore(db, () => now);
    await store.control('model-0', 'disable', 0, 'version-a', 'Pause while reviewing quality');
    expect(await store.read()).toMatchObject({ controlRevision: 1, offers: [] });
    const lease = (await store.claim(now, 300000))!; await store.publish(lease, snapshot);
    expect(await store.read()).toMatchObject({ controlRevision: 1, offers: [] });
    await store.control('model-0', 'enable', 1, 'version-a', 'Resume independent eligibility checks');
    expect(await store.read()).toMatchObject({ controlRevision: 2, offers: [offer] });
    expect([...rows.keys()]).toEqual([SURPLUS_DOCUMENT]);
    expect(rows.get(SURPLUS_DOCUMENT)).not.toHaveProperty('reviews');
  });
  it('stale controls and stale snapshot reviews cannot overwrite a newer admin action', async () => {
    const { db, rows } = fakeDb(); rows.set(SURPLUS_DOCUMENT, { snapshot });
    const store = new SurplusStore(db, () => now);
    await store.control('model-0', 'disable', 0, 'version-a', 'Pause while reviewing quality');
    await expect(store.control('model-0', 'enable', 0, 'version-a', 'Restore the old review')).rejects.toThrow('REGISTRY_VERSION_CHANGED');
    await expect(store.control('model-0', 'enable', 1, 'old-version', 'Restore the old review')).rejects.toThrow('REGISTRY_VERSION_CHANGED');
    expect((await store.read())?.offers).toEqual([]);
  });
  it('clamps a legacy ten-minute snapshot to the current five-minute freshness bound', async () => {
    const { db, rows } = fakeDb(); rows.set(SURPLUS_DOCUMENT, { snapshot: { ...snapshot, expiresAt: now + 600000 } });
    expect(await new SurplusStore(db).read()).toMatchObject({ expiresAt: now + 300000 });
  });
  it('filters current environment removals even if a durable refresh is held', async () => {
    const { db, rows } = fakeDb(); rows.set(SURPLUS_DOCUMENT, { snapshot, nextAllowedAt: now + 300000 });
    const store = new SurplusStore(db, () => now);
    expect(await store.claim(now, 300000)).toBeNull();
    expect(await store.read(['model-1'])).toMatchObject({ models: ['model-1'], offers: [] });
    expect(await store.read([])).toBeNull();
    expect(await store.read(['unobserved-model'])).toBeNull();
  });
  it.each([null, {}, { revision: 0, disabledModels: ['model-0'], updatedAt: null, reason: null },
    { revision: 1, disabledModels: ['model-0', 'model-0'], updatedAt: now, reason: 'Review needed' },
    { revision: -1, disabledModels: [], updatedAt: now, reason: 'Review needed' }])('fails closed on malformed persisted controls %j', async controls => {
    const { db, rows } = fakeDb(); rows.set(SURPLUS_DOCUMENT, { snapshot, controls });
    expect(readSurplusModelControls(controls)).toBeNull();
    expect(await new SurplusStore(db).read()).toBeNull();
  });
  it('does not treat a missing legacy control document as a review', () => {
    expect(readSurplusModelControls(undefined)).toEqual({ revision: 0, disabledModels: [], updatedAt: null, reason: null });
  });
});
