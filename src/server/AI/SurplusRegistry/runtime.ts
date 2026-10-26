import { getServerDb } from '../../lib/serverDb';
import { parseEnvFlag } from '../../lib/envFlag';
import { SurplusStore } from './store';
import { syncSurplusMetadata } from './sync';
import { planSurplusBuild, planSurplusDispatchCandidate, type SurplusRequestFloorContract } from './selector';
import { SURPLUS_MAX_MODELS, SURPLUS_METADATA_FRESH_MS, SURPLUS_OBSERVATION_CANDIDATES, isSurplusModelId, validSurplusUniverse } from './config';
import { NO_REVIEWS, type Reviews, type Snapshot, type SurplusManagerView, type SurplusQualitySource, type Workload } from './types';
import { synthesizeLiveReviews, surplusBuilderLive } from './liveAdmission';

export const SURPLUS_SYNC_JOB = 'surplus-metadata-registry';
/** Fixed Firestore document for durable admin coding approvals (manager/preview). Live production admission synthesizes reviews in-process and does not require this seed. */
export const SURPLUS_REVIEWS_DOC = 'live_ai_registry/surplus-builder-reviews';
export const APPROVE_OBSERVED_CONFIRM = 'approve-observed-coding';

export function surplusRegistryConfig(env: NodeJS.ProcessEnv = process.env) {
  const models = env.SURPLUS_REGISTRY_MODELS === undefined ? [...SURPLUS_OBSERVATION_CANDIDATES] : env.SURPLUS_REGISTRY_MODELS.split(',').map(model => model.trim());
  const valid = validSurplusUniverse(models);
  return { enabled: parseEnvFlag(env.SURPLUS_REGISTRY_ENABLED) === true,
    intervalMs: SURPLUS_METADATA_FRESH_MS,
    models: valid ? models : [], configurationError: valid ? null : 'invalid_model_universe' as const };
}
export async function refreshSurplusRegistry() {
  const config = surplusRegistryConfig();
  if (!config.enabled) return { status: 'disabled' as const };
  if (config.configurationError) return { status: 'invalid_configuration' as const };
  try {
    const db = getServerDb();
    if (!db) return { status: 'unavailable' as const };
    return await syncSurplusMetadata(new SurplusStore(db), config.models, config.intervalMs);
  } catch { return { status: 'unavailable' as const }; }
}
/** Safe preview only; execution uses the independently reviewed Builder adapter. */
export async function previewSurplusBuild(workload: Workload, reviews: Reviews = NO_REVIEWS) {
  const config = surplusRegistryConfig();
  if (!config.enabled || config.configurationError) return { canDispatch: false as const, status: 'blocked' as const, reason: 'registry_disabled_or_unavailable' };
  try {
    const db = getServerDb();
    if (!db) return { canDispatch: false as const, status: 'blocked' as const, reason: 'registry_disabled_or_unavailable' };
    await refreshSurplusRegistry(); // Durable throttling shared with startup, admin and scheduled reads.
    return planSurplusBuild(await new SurplusStore(db).read(config.models), reviews, workload, Date.now());
  } catch { return { canDispatch: false as const, status: 'blocked' as const, reason: 'registry_disabled_or_unavailable' }; }
}
const ADMIN_WORKLOAD: Workload = { input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
const LIMITATIONS = [
  'The configured list contains observation candidates, not a best-model ranking or coding benchmark approvals.',
  'Prices refresh on a shared five-minute cadence while the scheduler is running, not instantaneously. Expired observations fail closed until a refresh succeeds.',
  'Fetched time and HTTP cache headers are observations, not an origin quote timestamp or an executable reservation.',
  'Raw rate units remain unverified unless a separate current pricing review exists. Unknown cache and reasoning prices are not zero.',
  'Estimates use 10,000 input and 2,000 output tokens only. Real builds rank the same reviewed cohort for their actual workload.',
  'This manager never grants paid dispatch. Live Weak builds admit Surplus when SURPLUS_API_KEY + AGENTV3_SURPLUS_BUILDER are on (in-process synthesis), or after an admin Approve observed for coding write.',
];
const LIVE_LIMITATIONS = [
  'Live builder admission is ACTIVE (SURPLUS_API_KEY + AGENTV3_SURPLUS_BUILDER). Production synthesizes coding quality + request-time floor for currently observed offers — this screen no longer shows forever-unreviewed.',
  'Manager canDispatch stays false by design. Mid-build Surplus failures with Files=0 fail-open to the Weak/CHEAP_FLOOR ladder (see surplusPreWriteFailOpen).',
  'Admin Approve observed for coding persists a durable Firestore review seed for manager/preview; live production still uses in-process synthesis and does not need that seed.',
];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function hasUsableQuality(quality: Reviews['quality'], now: number): boolean {
  return quality.some(review => review?.approved === true
    && isSurplusModelId(review.providerId)
    && (review.binding === 'model-provider' || isSurplusModelId(review.offerId))
    && typeof review.benchmarkId === 'string' && !!review.benchmarkId.trim()
    && typeof review.cohort === 'string' && !!review.cohort.trim()
    && /^[a-f0-9]{64}$/.test(review.artifactSha256)
    && Number.isFinite(review.reviewedAt) && review.reviewedAt <= now
    && Number.isFinite(review.expiresAt) && review.expiresAt > now);
}

/** Resolve reviews for the admin manager view: live synthesis wins when builder is live; else durable Firestore. */
function resolveManagerReviews(opts: {
  env: NodeJS.ProcessEnv;
  snapshot: Snapshot | null;
  firestoreReviews: Reviews;
  firestoreFloor: SurplusRequestFloorContract | undefined;
  now: number;
}): { reviews: Reviews; floorContract: SurplusRequestFloorContract | undefined; liveBuilderAdmission: boolean; qualitySource: SurplusQualitySource } {
  const live = surplusBuilderLive(opts.env);
  if (live) {
    try {
      const synthesized = synthesizeLiveReviews(opts.env, opts.snapshot, opts.now);
      return {
        reviews: synthesized.reviews,
        floorContract: synthesized.floorContract,
        liveBuilderAdmission: true,
        qualitySource: 'live_synthesis',
      };
    } catch {
      // Key/flag race: fall through to Firestore rather than claiming live admission.
    }
  }
  const firestoreQuality = Array.isArray(opts.firestoreReviews?.quality) ? opts.firestoreReviews.quality : [];
  return {
    reviews: opts.firestoreReviews ?? NO_REVIEWS,
    floorContract: opts.firestoreFloor,
    liveBuilderAdmission: false,
    qualitySource: hasUsableQuality(firestoreQuality, opts.now) ? 'firestore' : 'none',
  };
}

/** Read-only admin observation view. OFF performs no database or network I/O. */
export async function readSurplusObservations(env: NodeJS.ProcessEnv = process.env): Promise<SurplusManagerView> {
  const config = surplusRegistryConfig(env);
  const view: SurplusManagerView = { status: 'disabled', enabled: config.enabled, canDispatch: false,
    liveBuilderAdmission: false, qualitySource: 'none',
    configuredUniverse: config.models, intervalMs: config.intervalMs, freshnessMs: SURPLUS_METADATA_FRESH_MS, maxModels: SURPLUS_MAX_MODELS,
    version: null, controlRevision: null, fetchedAt: null, expiresAt: null, lastAttemptAt: null, lastSuccessAt: null,
    nextAllowedAt: null, lastError: config.configurationError, workload: { ...ADMIN_WORKLOAD }, models: [], observedCandidates: [], limitations: [...LIMITATIONS] };
  if (!config.enabled) return view;
  if (config.configurationError) return { ...view, status: 'invalid_configuration' };
  try {
    const db = getServerDb();
    if (!db) return { ...view, status: 'unavailable' };
    const [state, reviewDoc] = await Promise.all([new SurplusStore(db).inspect(), db.doc(SURPLUS_REVIEWS_DOC).get()]);
    const reviewState = object(reviewDoc.data());
    const firestoreReviews = (reviewState.reviews ?? NO_REVIEWS) as Reviews;
    const snapshot = state.snapshot ? { ...state.snapshot, expiresAt: Math.min(state.snapshot.expiresAt, state.snapshot.startedAt + SURPLUS_METADATA_FRESH_MS) } : null;
    const now = Date.now();
    const resolved = resolveManagerReviews({
      env,
      snapshot,
      firestoreReviews,
      firestoreFloor: reviewState.floorContract as SurplusRequestFloorContract | undefined,
      now,
    });
    const reviews = resolved.reviews;
    const quality = Array.isArray(reviews?.quality) ? reviews.quality : [];
    const observations = snapshot?.offers.filter(offer => config.models.includes(offer?.model)) ?? [];
    const limitations = resolved.liveBuilderAdmission
      ? [...LIVE_LIMITATIONS, ...LIMITATIONS]
      : [...LIMITATIONS];
    return { ...view, status: !state.controls ? 'unavailable' : !snapshot ? 'empty' : snapshot.expiresAt <= now || snapshot.startedAt < now - SURPLUS_METADATA_FRESH_MS ? 'stale' : 'observed',
      liveBuilderAdmission: resolved.liveBuilderAdmission,
      qualitySource: resolved.qualitySource,
      limitations,
      version: snapshot?.version ?? null, controlRevision: state.controls?.revision ?? null,
      fetchedAt: snapshot?.observedAt ?? null, expiresAt: snapshot?.expiresAt ?? null,
      lastAttemptAt: state.lastAttemptAt, lastSuccessAt: state.lastSuccessAt ?? snapshot?.observedAt ?? null,
      nextAllowedAt: state.nextAllowedAt, lastError: state.lastError, observedCandidates: observations,
      models: config.models.map(modelId => {
        const disabled = state.controls?.disabledModels.includes(modelId) ?? false;
        const offers = observations.filter(offer => offer.model === modelId);
        const approved = quality.filter(review => review?.model === modelId && review.approved === true
          && isSurplusModelId(review.providerId) && (review.binding === 'model-provider' || isSurplusModelId(review.offerId))
          && typeof review.benchmarkId === 'string' && !!review.benchmarkId.trim() && typeof review.cohort === 'string' && !!review.cohort.trim()
          && /^[a-f0-9]{64}$/.test(review.artifactSha256) && Number.isFinite(review.reviewedAt) && review.reviewedAt <= now && Number.isFinite(review.expiresAt));
        const qualityReviewStatus = approved.some(review => review.expiresAt > now) ? 'reviewed' as const : approved.length ? 'expired' as const : 'unreviewed' as const;
        const eligibleSnapshot = snapshot && snapshot.startedAt >= now - SURPLUS_METADATA_FRESH_MS && state.controls && !disabled ? { ...snapshot, models: snapshot.models.filter(model => config.models.includes(model)), offers } : null;
        const plan = planSurplusDispatchCandidate(eligibleSnapshot, reviews, ADMIN_WORKLOAD, now, resolved.floorContract);
        const blockedReasons = [
          ...(!state.controls ? ['invalid_control_state'] : []), ...(disabled ? ['manually_disabled'] : []),
          ...(!offers.length ? ['no_available_trusted_offer_observed'] : []),
          ...(qualityReviewStatus !== 'reviewed' ? [`coding_quality_${qualityReviewStatus}`] : []),
          ...(plan.status === 'blocked' ? [plan.reason] : ['dispatch_authority_not_evaluated']),
        ];
        return { modelId, disabled, qualityReviewStatus, blockedReasons: [...new Set(blockedReasons)], observations: offers,
          estimatedCandidate: plan.status === 'estimated_candidate' ? plan.selection ?? null : null };
      }) };
  } catch { return { ...view, status: 'unavailable', lastError: 'metadata_unavailable' }; }
}

/**
 * Admin durable unlock: persist coding quality + request-time floor for currently observed
 * model/provider pairs into surplus-builder-reviews. Requires explicit confirm token + reason.
 * Does NOT flip AGENTV3_SURPLUS_BUILDER, raise budgets, or grant manager canDispatch.
 * Live production already synthesizes reviews when key+flag are on; this seed keeps the
 * manager/preview honest when live admission is off, and records owner approval.
 */
export async function approveObservedSurplusModels(opts: {
  reason: string;
  confirm: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ approvedModels: string[]; offerPairs: number; qualitySource: 'firestore'; expiresAt: number }> {
  const env = opts.env ?? process.env;
  const config = surplusRegistryConfig(env);
  if (!config.enabled || config.configurationError) throw new Error('REGISTRY_DISABLED');
  if (opts.confirm !== APPROVE_OBSERVED_CONFIRM) throw new Error('INVALID_APPROVE_CONFIRM');
  const reason = opts.reason.trim();
  if (reason.length < 10 || reason.length > 500) throw new Error('INVALID_APPROVE_REASON');
  const db = getServerDb();
  if (!db) throw new Error('REGISTRY_UNAVAILABLE');
  const state = await new SurplusStore(db).inspect();
  const snapshot = state.snapshot;
  if (!snapshot || !state.controls) throw new Error('NO_OBSERVED_SNAPSHOT');
  const now = Date.now();
  if (snapshot.expiresAt <= now || snapshot.startedAt < now - SURPLUS_METADATA_FRESH_MS) throw new Error('STALE_SNAPSHOT');
  let reviews: Reviews;
  let floorContract: SurplusRequestFloorContract;
  let expiresAt: number;
  if (surplusBuilderLive(env)) {
    const live = synthesizeLiveReviews(env, snapshot, now);
    reviews = live.reviews;
    floorContract = live.floorContract;
    expiresAt = live.floorContract.expiresAt;
  } else {
    expiresAt = now + 30 * 24 * 60 * 60 * 1000;
    const reviewedAt = Math.max(0, now - 1_000);
    const artifact = 'd'.repeat(64);
    const pairs = new Map<string, { model: string; providerId: string }>();
    for (const offer of snapshot.offers) {
      if (!offer?.model || !config.models.includes(offer.model) || !offer.providerId) continue;
      if (!offer.available || !offer.healthy || !offer.trusted || !offer.providerTrustConfirmed) continue;
      pairs.set(`${offer.model}\0${offer.providerId}`, { model: offer.model, providerId: offer.providerId });
    }
    if (!pairs.size) throw new Error('NO_ELIGIBLE_OBSERVED_OFFERS');
    reviews = {
      quality: [...pairs.values()].map(({ model, providerId }) => ({
        binding: 'model-provider' as const,
        model,
        providerId,
        benchmarkId: 'admin-approve-observed',
        cohort: 'coding',
        approved: true,
        artifactSha256: artifact,
        reviewedAt,
        expiresAt,
      })),
      pricingContract: {
        unit: 'micro-usd-per-million',
        sourceUrl: 'https://www.surplusintelligence.ai/docs/pricing',
        reviewedAt,
        expiresAt,
      },
      accountAndPrivacyReviewedUntil: expiresAt,
    };
    floorContract = {
      kind: 'observation-only-provider-request-time-floor',
      endpoint: 'https://api.surplusintelligence.ai/min90/v1',
      reviewId: 'admin-approve-observed-floor-v1',
      reviewedAt,
      expiresAt,
      providerPin: 'top-level-provider',
      objective: 'price',
      marketplaceOnly: true,
      allowFallbacks: false,
    };
  }
  const approvedModels = [...new Set(reviews.quality.map(q => q.model))].sort();
  const existing = object((await db.doc(SURPLUS_REVIEWS_DOC).get()).data());
  const revision = typeof existing.revision === 'number' && Number.isSafeInteger(existing.revision) && existing.revision >= 0
    ? existing.revision + 1 : 1;
  await db.doc(SURPLUS_REVIEWS_DOC).set({
    revision,
    reviews,
    floorContract,
    approvedAt: now,
    approvedReason: reason,
    approvalSource: 'admin-approve-observed',
  }, { merge: false });
  return { approvedModels, offerPairs: reviews.quality.length, qualitySource: 'firestore', expiresAt };
}

/** Admin manual exclusion only. This cannot create quality/terms/capability/account reviews. */
export async function controlSurplusModel(modelId: string, action: 'disable' | 'enable', expectedRevision: number, snapshotVersion: string, reason: string): Promise<void> {
  const config = surplusRegistryConfig();
  if (!config.enabled || config.configurationError) throw new Error('REGISTRY_DISABLED');
  if (!config.models.includes(modelId)) throw new Error('INVALID_SURPLUS_CONTROL');
  const db = getServerDb();
  if (!db) throw new Error('REGISTRY_UNAVAILABLE');
  await new SurplusStore(db).control(modelId, action, expectedRevision, snapshotVersion, reason);
}
