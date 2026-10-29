import type { Dimension, Observation, Plan, Reviews, Snapshot, Workload } from './types';
import { SURPLUS_MAX_MODELS, SURPLUS_MAX_OFFERS, surplusCodingQuality } from './config';
const DIMENSIONS: Dimension[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
const SCALE = 1_000_000n;
const blocked = (reason: string): Plan => ({ canDispatch: false, status: 'blocked', reason });
function decimal(value: string | undefined): bigint | null {
  if (!value || !/^\d{1,15}(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
function weighted(rates: Observation['rates'], workload: Workload): bigint | null {
  let total = 0n;
  for (const dimension of DIMENSIONS) {
    if (workload[dimension] === 0) continue;
    const rate = decimal(rates[dimension]);
    if (rate === null) return null; // Unknown cache/reasoning prices are never zero.
    total += BigInt(workload[dimension]) * rate;
  }
  return total;
}
function microUsd(total: bigint): string {
  // total has six decimal places in rates and is per-million tokens: retain six
  // decimals of micro-USD, conservatively rounded UP, with no floating point money.
  const scaled = (total + SCALE - 1n) / SCALE;
  return `${scaled / SCALE}.${String(scaled % SCALE).padStart(6, '0')}`;
}
/** Pure preview contract. Returned candidates are NOT dispatchable or guaranteed quotes. */
function plan(snapshot: Snapshot | null, reviews: Reviews, workload: Workload, now: number, requestFloor = false): Plan {
  if (!Number.isFinite(now) || DIMENSIONS.some(d => !Number.isSafeInteger(workload[d]) || workload[d] < 0 || workload[d] > 1_000_000_000)
      || workload.input + workload.output === 0) return blocked('invalid_workload');
  if (!snapshot || !Array.isArray(snapshot.offers) || !Array.isArray(snapshot.models) || snapshot.models.length > SURPLUS_MAX_MODELS || snapshot.offers.length > SURPLUS_MAX_OFFERS
      || typeof snapshot.version !== 'string' || !snapshot.version || snapshot.models.some(m => typeof m !== 'string' || !m)
      || ![snapshot.observedAt, snapshot.expiresAt, snapshot.startedAt].every(Number.isFinite) || snapshot.observedAt > now || snapshot.expiresAt <= now || snapshot.startedAt > snapshot.observedAt || snapshot.expiresAt > snapshot.startedAt + 600_000) return blocked('stale_or_missing_snapshot');
  const contract = reviews.pricingContract;
  if (!contract || contract.unit !== 'micro-usd-per-million' || !/^https:\/\/(www\.)?surplusintelligence\.ai\//.test(contract.sourceUrl)
      || !Number.isFinite(contract.reviewedAt) || !Number.isFinite(contract.expiresAt)
      || contract.reviewedAt > now || contract.expiresAt <= now) return blocked('pricing_units_not_independently_verified');
  if (!Number.isFinite(reviews.accountAndPrivacyReviewedUntil) || reviews.accountAndPrivacyReviewedUntil <= now) return blocked('account_or_privacy_not_reviewed');
  // The wire can pin model/provider, not an individual offer. An exact-offer
  // benchmark therefore cannot authorize even a dispatch candidate in floor mode.
  const quality = reviews.quality.filter(q => q.approved === true && (requestFloor ? q.binding === 'model-provider' : (typeof q.offerId === 'string' && !!q.offerId))
    && typeof q.benchmarkId === 'string' && q.benchmarkId.trim() && typeof q.cohort === 'string' && q.cohort.trim()
    && /^[a-f0-9]{64}$/.test(q.artifactSha256) && Number.isFinite(q.reviewedAt) && Number.isFinite(q.expiresAt)
    && q.reviewedAt <= now && q.expiresAt > now);
  if (!quality.length) return blocked('no_reviewed_coding_models');
  if (new Set(quality.map(q => q.cohort)).size !== 1) return blocked('incomparable_quality_cohorts');
  const candidates = snapshot.offers.flatMap(offer => {
    const approved = quality.find(q => q.model === offer.model && q.providerId === offer.providerId && (requestFloor ? q.binding === 'model-provider' : q.offerId === offer.offerId));
    const originFresh = offer.upstreamGeneratedAt !== null && Number.isFinite(offer.upstreamGeneratedAt)
      && offer.upstreamGeneratedAt <= now && offer.upstreamGeneratedAt >= now - 600_000;
    const boundedObservation = requestFloor && offer.upstreamGeneratedAt === null
      && offer.observedAt >= now - 300_000 && offer.sourceDate !== null && Number.isFinite(offer.sourceDate)
      && offer.sourceDate >= now - 300_000 && offer.sourceDate <= now + 5000
      && offer.cacheMaxAgeSeconds !== null && Number.isFinite(offer.cacheMaxAgeSeconds)
      && offer.cacheMaxAgeSeconds >= 0 && offer.cacheMaxAgeSeconds <= 300
      && (offer.sourceAgeSeconds === null || offer.sourceAgeSeconds + (now - offer.observedAt) / 1000 <= 300);
    if (!approved || offer.available !== true || offer.healthy !== true || offer.trusted !== true || offer.providerTrustConfirmed !== true
        || offer.trustObservedAt === null || !Number.isFinite(offer.trustObservedAt) || offer.trustObservedAt > now || offer.trustObservedAt < now - 600_000
        || !snapshot.models.includes(offer.model) || [offer.model, offer.providerId, offer.offerId].some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(id)) || !Number.isFinite(offer.discountPct) || offer.discountPct! < 90 || offer.discountPct! > 100
        || !Number.isFinite(offer.observedAt) || (!originFresh && !boundedObservation)
        || offer.observedAt > now || offer.observedAt < now - 600_000 || offer.observedAt < snapshot.startedAt
        || (offer.sourceDate !== null && (!Number.isFinite(offer.sourceDate) || offer.sourceDate > now + 5000 || offer.sourceDate < now - 600_000))
        || (offer.sourceAgeSeconds !== null && (!Number.isFinite(offer.sourceAgeSeconds) || offer.sourceAgeSeconds < 0 || offer.sourceAgeSeconds > 300))) return [];
    const cost = weighted(offer.rates, workload), reference = weighted(offer.referenceRates, workload);
    // Both reported discount AND the actual workload-weighted estimate must meet 90%.
    if (cost === null || reference === null || reference <= 0n || cost * 10n > reference) return [];
    return [{ offer, approved, cost, quality: surplusCodingQuality(offer.model, approved.qualityScore) }];
  // Objective (admin 2026-10-29): among ≥90%-discount eligible offers pick the BEST coding quality;
  // price only breaks ties within the same model/quality, then offerId for determinism.
  }).sort((a, b) => b.quality - a.quality || (a.cost < b.cost ? -1 : a.cost > b.cost ? 1 : 0) || a.offer.offerId.localeCompare(b.offer.offerId));
  if (!candidates.length) return blocked('no_eligible_90_percent_offer');
  const { offer, approved, cost } = candidates[0];
  return { canDispatch: false, status: 'estimated_candidate', reason: 'cost_preview_only_agent_capability_receipts_and_builder_adapter_unverified', snapshotVersion: snapshot.version, configuredUniverse: snapshot.models, observationBasis: requestFloor ? 'request-time-floor-required' : 'origin-timestamp',
    selection: { model: offer.model, providerId: offer.providerId, offerId: offer.offerId, estimatedMicroUsd: microUsd(cost), qualityArtifact: approved.artifactSha256 } };
}

/** Treat malformed persisted observations/reviews as unavailable, never as implicit approval. */
export function planSurplusBuild(snapshot: Snapshot | null, reviews: Reviews, workload: Workload, now: number): Plan {
  try { return plan(snapshot, reviews, workload, now); }
  catch { return blocked('invalid_metadata_or_review'); }
}

/** Reviewed permission to consider bounded cached observations, NOT proof of a live quote. */
export interface SurplusRequestFloorContract {
  kind: 'observation-only-provider-request-time-floor';
  endpoint: 'https://api.surplusintelligence.ai/min90/v1';
  reviewId: string;
  reviewedAt: number;
  expiresAt: number;
  providerPin: 'top-level-provider';
  objective: 'price';
  marketplaceOnly: true;
  allowFallbacks: false;
}

/**
 * The adapter must enforce /min90, exact model/provider, marketplace-only service and no
 * fallback at REQUEST TIME. This candidate remains an estimate and never authorizes a bill.
 * Origin generation time remains null; no synthetic timestamp is inserted into the snapshot.
 */
export function planSurplusDispatchCandidate(
  snapshot: Snapshot | null, reviews: Reviews, workload: Workload, now: number, contract: SurplusRequestFloorContract | undefined,
): Plan {
  try {
    if (!contract || contract.kind !== 'observation-only-provider-request-time-floor'
        || contract.endpoint !== 'https://api.surplusintelligence.ai/min90/v1'
        || contract.providerPin !== 'top-level-provider' || contract.objective !== 'price'
        || contract.marketplaceOnly !== true || contract.allowFallbacks !== false
        || typeof contract.reviewId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(contract.reviewId)
        || !Number.isFinite(contract.reviewedAt) || !Number.isFinite(contract.expiresAt)
        || contract.reviewedAt > now || contract.expiresAt <= now || contract.expiresAt <= contract.reviewedAt) {
      return blocked('request_time_floor_contract_not_reviewed');
    }
    return plan(snapshot, reviews, workload, now, true);
  } catch { return blocked('invalid_metadata_or_review'); }
}
