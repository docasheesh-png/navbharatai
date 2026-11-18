// Synthetic unit-test evidence only. Never imported by production code.
import { createHash } from 'node:crypto';
import { surplusBuilderSwitchOn } from '../../src/server/lib/alwaysOnSuppliers';
import { SURPLUS_MIN90_BASE_URL } from '../../src/server/lib/surplusClient';
import type { SurplusCapabilityReview } from '../../src/server/AI/SurplusRegistry/buildSession';
import type { SurplusOfficialTariff } from '../../src/server/AI/SurplusRegistry/receiptPolicy';
import type { SurplusPilotAuthority } from '../../src/server/AI/SurplusRegistry/receiptStore';
import type { Snapshot } from '../../src/server/AI/SurplusRegistry/types';
import { surplusLiveKey, credentialSha256, type LiveProductionReviews, type LiveUsageMapping } from '../../src/server/AI/SurplusRegistry/liveAdmission';
const LIVE_PILOT_ID='synthetic-test-pilot';
const LIVE_MAX_ESTIMATED_MICRO='999999999999999999';
const LIVE_MAX_CALLS=1000000;
const EVIDENCE_TTL_MS=30*24*60*60*1000;
const ARTIFACT=createHash('sha256').update('synthetic unit test evidence').digest('hex');
/** In-process live reviews from key + metadata snapshot. Never a Firestore seed. */
export function syntheticTestReviews(
  env: NodeJS.ProcessEnv,
  snapshot: Snapshot | null,
  now: number,
): LiveProductionReviews {
  const key = surplusLiveKey(env);
  if (!key) throw new Error('Surplus API key missing or invalid for live builder');
  if (!surplusBuilderSwitchOn(env)) throw new Error('Surplus builder is disabled');

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
      sourceUrl: 'https://test-provider.invalid/pricing',
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
