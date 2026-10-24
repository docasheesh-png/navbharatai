import { randomUUID } from 'node:crypto';
import type { Observation, Snapshot, Store } from './types';
import { SURPLUS_MODEL_ID as ID, SURPLUS_MAX_OFFERS_PER_MODEL, SURPLUS_METADATA_FRESH_MS, SURPLUS_FETCH_CONCURRENCY, validSurplusUniverse } from './config';
export const MARKET_ORIGIN = 'https://api.surplusintelligence.ai';
const rate = (value: unknown): string | undefined => {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^\d{1,15}(?:\.\d{1,6})?$/.test(text) ? text : undefined;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function numericHeader(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
/** Bounded read: no credentials, redirects, POSTs or inference endpoints. */
async function readJson(url: string, transport: typeof fetch): Promise<{ data: unknown; headers: Headers }> {
  const response = await transport(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error('Surplus metadata unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new Error('Surplus metadata exceeds limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: response.headers };
}
export function normalizeOffers(model: string, body: unknown, headers: Headers, observedAt: number): Observation[] {
  if (!record(body) || body.model !== model || !Array.isArray(body.offers) || body.offers.length > 5000) throw new Error('Invalid Surplus market schema');
  const date = Date.parse(headers.get('date') ?? '');
  const sourceDate = Number.isFinite(date) ? date : null;
  const sourceAgeSeconds = numericHeader(headers.get('age'));
  const cacheMaxAgeSeconds = numericHeader(headers.get('cache-control')?.match(/(?:^|,)\s*(?:s-maxage|max-age)=(\d+)/)?.[1] ?? null);
  const eligible = body.offers.filter(record).filter(o => typeof o.id === 'string' && ID.test(o.id)
    && typeof o.provider_id === 'string' && ID.test(o.provider_id))
    .filter(o => o.available === true && o.healthy === true && o.trusted === true);
  if (eligible.length > SURPLUS_MAX_OFFERS_PER_MODEL) throw new Error('Surplus offer universe exceeds bound');
  return eligible.map(o => {
      const input = rate(o.effective_input_per_1m), output = rate(o.effective_output_per_1m);
      const directInput = rate(o.direct_input_per_1m), directOutput = rate(o.direct_output_per_1m);
      return { model, offerId: o.id as string, providerId: o.provider_id as string, available: true, healthy: true, trusted: true, providerTrustConfirmed: false, trustObservedAt: null,
        discountPct: typeof o.discount_pct === 'number' && Number.isFinite(o.discount_pct) && o.discount_pct >= 0 && o.discount_pct <= 100 ? o.discount_pct : null,
        rates: { ...(input ? { input } : {}), ...(output ? { output } : {}) },
        referenceRates: { ...(directInput ? { input: directInput } : {}), ...(directOutput ? { output: directOutput } : {}) },
        unit: 'unverified', upstreamGeneratedAt: null, observedAt, sourceDate, sourceAgeSeconds, cacheMaxAgeSeconds,
        sourceUrl: `${MARKET_ORIGIN}/api/markets/${encodeURIComponent(model)}` };
    });
}
export async function syncSurplusMetadata(store: Store, models: string[], intervalMs = 300_000, transport: typeof fetch = fetch, clock = Date.now) {
  if (!validSurplusUniverse(models)
      || !Number.isSafeInteger(intervalMs) || intervalMs !== SURPLUS_METADATA_FRESH_MS) throw new Error('Invalid Surplus sync configuration');
  const startedAt = clock(), lease = await store.claim(startedAt, intervalMs);
  if (!lease) return { status: 'held' as const };
  try {
    const trust = await readJson(`${MARKET_ORIGIN}/v1/providers`, transport);
    if (!record(trust.data) || !Array.isArray(trust.data.data) || trust.data.data.length > 512) throw new Error('Invalid Surplus provider schema');
    const trusted = new Set(trust.data.data.filter(record).filter(p => typeof p.id === 'string' && ID.test(p.id) && p.trusted === true).map(p => p.id));
    const trustObservedAt = clock();
    const offers: Observation[] = [];
    // At most three concurrent detail reads, fifteen total. The 10s request deadlines
    // bound a full refresh below the 120s durable lease, even for a 15-model universe.
    // Settle the entire group before failing: no detached requests outlive the lease.
    for (let index = 0; index < models.length; index += SURPLUS_FETCH_CONCURRENCY) {
      const group = await Promise.allSettled(models.slice(index, index + SURPLUS_FETCH_CONCURRENCY).map(async model => {
        const { data, headers } = await readJson(`${MARKET_ORIGIN}/api/markets/${encodeURIComponent(model)}`, transport);
        return normalizeOffers(model, data, headers, clock()).map(offer => ({ ...offer, providerTrustConfirmed: trusted.has(offer.providerId), trustObservedAt }));
      }));
      if (group.some(result => result.status === 'rejected')) throw new Error('Incomplete Surplus metadata');
      for (const result of group) if (result.status === 'fulfilled') offers.push(...result.value);
    }
    const observedAt = clock();
    const snapshot: Snapshot = { version: randomUUID(), startedAt, observedAt, expiresAt: startedAt + SURPLUS_METADATA_FRESH_MS, models: [...models], offers };
    await store.publish(lease, snapshot);
    return { status: 'synced' as const, count: offers.length };
  } catch {
    await store.fail(lease);
    return { status: 'unavailable' as const }; // Never expose raw bodies/errors or fabricate freshness.
  }
}
