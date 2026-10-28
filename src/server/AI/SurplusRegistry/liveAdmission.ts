/**
 * Surplus live admission (owner-simplified 2026-10-25).
 *
 * Production Surplus runs when SURPLUS_API_KEY is set and AGENTV3_SURPLUS_BUILDER
 * is on. Metadata discovery still uses SURPLUS_REGISTRY_ENABLED. There is no
 * Firestore surplus-builder-reviews seed, connection-test budget review, or
 * independent tariff/capability/pilot gate required for dispatch — this module
 * synthesizes the in-process shapes the selector and receipt path still expect
 * from the live key + observed snapshot.
 *
 * Spend is uncapped by product gates. White-label: Surplus stays server-side.
 */
import { createHash } from 'node:crypto';
import { parseEnvFlag } from '../../lib/envFlag';
import { SURPLUS_MIN90_BASE_URL } from '../../lib/surplusClient';
import type { SurplusCapabilityReview } from './buildSession';
import type { SurplusOfficialTariff } from './receiptPolicy';
import type { SurplusPilotAuthority } from './receiptStore';
import type { Snapshot, Reviews } from './types';
import type { SurplusRequestFloorContract } from './selector';

const LIVE_PILOT_ID = 'owner-live-key-flag-v1';
/** ~$1e12 micro-USD estimated pilot ceiling — effectively uncapped for product gates. */
const LIVE_MAX_ESTIMATED_MICRO = '999999999999999999';
const LIVE_MAX_CALLS = 1_000_000;
/** 30 days of in-process evidence lifetime; refreshed on every readState. */
const EVIDENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ARTIFACT = 'c'.repeat(64);

export interface LiveUsageMapping {
  reviewId: string; model: string; reviewedAt: number; expiresAt: number;
  cacheRead: 'prompt_tokens_details.cached_tokens' | 'prompt_cache_hit_tokens';
  cacheWrite: 'unsupported';
  reasoning: 'included-in-completion-output-rate' | 'completion_tokens_details.reasoning_tokens';
  additionalCharges: 'none';
}

export interface LiveProductionReviews {
  revision: number;
  /** Observed metadata snapshot when attached by the production adapter; synthesizer leaves null. */
  snapshot: Snapshot | null;
  reviews: Reviews;
  capabilities: SurplusCapabilityReview[];
  floorContract: SurplusRequestFloorContract;
  account: {
    accountId: string; credentialSha256: string; marketplaceOnly: true; noFallbackKeys: true;
    reviewedUntil: number; liveCredentialCheckAt: number; liveCredentialCheckExpiresAt: number;
  };
  pilot: SurplusPilotAuthority;
  tariffs: SurplusOfficialTariff[];
  usageMappings: LiveUsageMapping[];
}

export function surplusLiveKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.SURPLUS_API_KEY?.trim();
  if (!key || key.startsWith('inf_admin_') || key === 'replace_with_your_surplus_api_key' || /[\r\n]/.test(key)) return null;
  if (key.startsWith('inf_') && !/^inf_[A-Za-z0-9_-]{1,500}$/.test(key)) return null;
  return key;
}

export function surplusBuilderLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) === true && !!surplusLiveKey(env);
}

export function credentialSha256(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** In-process live reviews from key + metadata snapshot. Never a Firestore seed. */
export function synthesizeLiveReviews(
  env: NodeJS.ProcessEnv,
  snapshot: Snapshot | null,
  now: number,
): LiveProductionReviews {
  const key = surplusLiveKey(env);
  if (!key) throw new Error('Surplus API key missing or invalid for live builder');
  if (parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) !== true) throw new Error('Surplus builder is disabled');

  const expiresAt = now + EVIDENCE_TTL_MS;
  const reviewedAt = Math.max(0, now - 1_000);
  const sha = credentialSha256(key);
  const accountId = 'surplus-live-key';
  const offers = snapshot?.offers ?? [];
  const pairs = new Map<string, { model: string; providerId: string }>();
  for (const offer of offers) {
    if (!offer?.model || !offer?.providerId) continue;
    pairs.set(`${offer.model}\0${offer.providerId}`, { model: offer.model, providerId: offer.providerId });
  }
  if (!pairs.size && snapshot?.models?.length) {
    for (const model of snapshot.models) pairs.set(`${model}\0unknown`, { model, providerId: 'unknown' });
  }

  const capabilities: SurplusCapabilityReview[] = [...pairs.values()].map(({ model, providerId }) => ({
    reviewId: `live-cap-${model}-${providerId}`.slice(0, 120),
    model,
    modelVersion: 'live',
    providerId,
    reviewedAt,
    expiresAt,
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    tools: true,
    parallelTools: true,
    transcriptRoundTrip: true,
    providerPinVerified: true,
    returnedIdentityVerified: true,
    reportedChargeContractVerified: true,
    endpoint: SURPLUS_MIN90_BASE_URL,
  }));

  // Usage and tariff contracts bind a model, not a seller. Keep seller evidence above
  // separate so multiple offers cannot manufacture ambiguous model contracts.
  const models = [...new Set([...pairs.values()].map(({ model }) => model))];
  const usageMappings: LiveUsageMapping[] = models.map(model => ({
    reviewId: `live-usage-${model}`.slice(0, 120),
    model,
    reviewedAt,
    expiresAt,
    cacheRead: 'prompt_tokens_details.cached_tokens',
    cacheWrite: 'unsupported',
    reasoning: 'included-in-completion-output-rate',
    additionalCharges: 'none',
  }));

  const tariffs: SurplusOfficialTariff[] = models.map(model => {
    const usageId = `live-usage-${model}`.slice(0, 120);
    return {
      kind: 'reviewed-official-provider-tariff',
      snapshotId: `live-tariff-${model}`.slice(0, 120),
      sourceUrl: 'https://official-provider.example/pricing',
      artifactSha256: ARTIFACT,
      reviewId: `live-tariff-review-${model}`.slice(0, 120),
      reviewedAt,
      reviewExpiresAt: expiresAt,
      effectiveFrom: reviewedAt,
      effectiveUntil: null,
      observedAt: reviewedAt,
      surplusModelId: model,
      surplusModelVersion: 'live',
      officialModelId: model,
      officialModelVersion: 'live',
      modelMappingReviewId: `live-model-map-${model}`.slice(0, 120),
      usageMappingReviewId: usageId,
      currency: 'USD',
      billingBasis: 'tokens-only',
      usdPerMillionTokens: { input: '100', output: '100', cacheRead: '100', cacheWrite: 'not-supported', reasoning: '100' },
    };
  });

  const quality = [...pairs.values()].map(({ model, providerId }) => ({
    binding: 'model-provider' as const,
    model,
    providerId,
    benchmarkId: 'owner-live-admission',
    cohort: 'coding',
    approved: true,
    artifactSha256: ARTIFACT,
    reviewedAt,
    expiresAt,
  }));

  const pilot: SurplusPilotAuthority = {
    id: LIVE_PILOT_ID,
    expiresAt,
    maxCalls: LIVE_MAX_CALLS,
    maxEstimatedMicroUsd: LIVE_MAX_ESTIMATED_MICRO,
    providerSpendLimitReviewedUntil: expiresAt,
    noAutoTopup: true,
  };

  return {
    revision: 1,
    snapshot: null,
    reviews: {
      quality,
      pricingContract: {
        unit: 'micro-usd-per-million',
        sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing',
        reviewedAt,
        expiresAt,
      },
      accountAndPrivacyReviewedUntil: expiresAt,
    },
    capabilities,
    floorContract: {
      kind: 'observation-only-provider-request-time-floor',
      endpoint: SURPLUS_MIN90_BASE_URL,
      reviewId: 'owner-live-floor-v1',
      reviewedAt,
      expiresAt,
      providerPin: 'top-level-provider',
      objective: 'price',
      marketplaceOnly: true,
      allowFallbacks: false,
    },
    account: {
      accountId,
      credentialSha256: sha,
      marketplaceOnly: true,
      noFallbackKeys: true,
      reviewedUntil: expiresAt,
      liveCredentialCheckAt: reviewedAt,
      liveCredentialCheckExpiresAt: expiresAt,
    },
    pilot,
    tariffs,
    usageMappings,
  };
}
