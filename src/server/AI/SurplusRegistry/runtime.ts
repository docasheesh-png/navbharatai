import { getServerDb } from '../../lib/serverDb';
import { parseEnvFlag } from '../../lib/envFlag';
import { SurplusStore } from './store';
import { syncSurplusMetadata } from './sync';
import { planSurplusBuild, planSurplusDispatchCandidate, type SurplusRequestFloorContract } from './selector';
import { SURPLUS_MAX_MODELS, SURPLUS_METADATA_FRESH_MS, SURPLUS_OBSERVATION_CANDIDATES, isSurplusModelId, validSurplusUniverse } from './config';
import { NO_REVIEWS, type Reviews, type Snapshot, type SurplusManagerView, type SurplusQualitySource, type Workload } from './types';
import { synthesizeLiveReviews } from './liveAdmission';

export const SURPLUS_SYNC_JOB = 'surplus-metadata-registry';
/** Fixed Firestore document for durable admin coding approvals (manager/preview). Catalog observations do not grant verified production authority. */
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
  'This manager never grants paid dispatch. Key/flag and healthy metadata alone do not establish production capability, tariff or quality evidence.',
];
const LIVE_LIMITATIONS = [
  'Production admission requires existing verified evidence; this preview does not certify dispatch readiness.',
  'Manager canDispatch stays false by design. Mid-build Surplus failures with Files=0 fail-open to the Weak/CHEAP_FLOOR ladder (see surplusPreWriteFailOpen).',
  'Admin approval cannot fabricate missing capability, tariff or benchmark evidence.',
];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function hasUsableQuality(quality: Reviews['quality'], now: number): boolean {
  return quality.some(review => review?.approved === true
    && isSurplusModelId(review.providerId)
    && (review.binding === 'model-provider' || isSurplusModelId(review.offerId))
    && typeof review.benchmarkId === 'string' && !!review.benchmarkId.trim()
    && typeof review.cohort === 'string' && !!review.cohort.trim()
    && /^[a-f0-9]{64}$/.test(review.artifactSha256) && !/^(.)\1{63}$/.test(review.artifactSha256)
    && Number.isFinite(review.reviewedAt) && review.reviewedAt <= now
    && Number.isFinite(review.expiresAt) && review.expiresAt > now);
}

/** Resolve existing reviews for display without synthesizing verification from configuration. */
function resolveManagerReviews(opts: {
  env: NodeJS.ProcessEnv;
  snapshot: Snapshot | null;
  firestoreReviews: Reviews;
  firestoreFloor: SurplusRequestFloorContract | undefined;
  now: number;
}): { reviews: Reviews; floorContract: SurplusRequestFloorContract | undefined; liveBuilderAdmission: boolean; qualitySource: SurplusQualitySource } {
  const firestoreQuality = Array.isArray(opts.firestoreReviews?.quality) ? opts.firestoreReviews.quality : [];
  return {
    reviews: { ...(opts.firestoreReviews ?? NO_REVIEWS), quality: firestoreQuality.filter(q => q && typeof q.artifactSha256 === 'string' && !/^(.)\1{63}$/.test(q.artifactSha256)) },
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
          && /^[a-f0-9]{64}$/.test(review.artifactSha256) && !/^(.)\1{63}$/.test(review.artifactSha256) && Number.isFinite(review.reviewedAt) && review.reviewedAt <= now && Number.isFinite(review.expiresAt));
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

/** Compatibility action: verify existing production evidence without creating, renewing
 * or overwriting approval records. The legacy route/confirm token remains accepted.
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
  // Catalog health and a button click cannot create tariff/capability/benchmark evidence.
  // Existing independently recorded evidence is required by the unchanged customer billing policy.
  const existing = (await db.doc(SURPLUS_REVIEWS_DOC).get()).data();
  const evidence = synthesizeLiveReviews(env, snapshot, now, existing);
  return { approvedModels: [...new Set(evidence.reviews.quality.map(q => q.model))].sort(),
    offerPairs: evidence.reviews.quality.length, qualitySource: 'firestore', expiresAt: evidence.floorContract.expiresAt };
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
