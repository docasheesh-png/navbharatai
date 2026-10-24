import { getServerDb } from '../../lib/serverDb';
import { parseEnvFlag } from '../../lib/envFlag';
import { SurplusStore } from './store';
import { syncSurplusMetadata } from './sync';
import { planSurplusBuild, planSurplusDispatchCandidate, type SurplusRequestFloorContract } from './selector';
import { SURPLUS_MAX_MODELS, SURPLUS_METADATA_FRESH_MS, SURPLUS_OBSERVATION_CANDIDATES, isSurplusModelId, validSurplusUniverse } from './config';
import { NO_REVIEWS, type Reviews, type SurplusManagerView, type Workload } from './types';
export const SURPLUS_SYNC_JOB = 'surplus-metadata-registry';
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
  'Account, capability, privacy, official tariff, usage mapping, pilot and receipt reviews still gate execution. This screen never grants them.',
];
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Read-only admin observation view. OFF performs no database or network I/O. */
export async function readSurplusObservations(): Promise<SurplusManagerView> {
  const config = surplusRegistryConfig();
  const view: SurplusManagerView = { status: 'disabled', enabled: config.enabled, canDispatch: false,
    configuredUniverse: config.models, intervalMs: config.intervalMs, freshnessMs: SURPLUS_METADATA_FRESH_MS, maxModels: SURPLUS_MAX_MODELS,
    version: null, controlRevision: null, fetchedAt: null, expiresAt: null, lastAttemptAt: null, lastSuccessAt: null,
    nextAllowedAt: null, lastError: config.configurationError, workload: { ...ADMIN_WORKLOAD }, models: [], observedCandidates: [], limitations: [...LIMITATIONS] };
  if (!config.enabled) return view;
  if (config.configurationError) return { ...view, status: 'invalid_configuration' };
  try {
    const db = getServerDb();
    if (!db) return { ...view, status: 'unavailable' };
    const [state, reviewDoc] = await Promise.all([new SurplusStore(db).inspect(), db.doc('live_ai_registry/surplus-builder-reviews').get()]);
    const reviewState = object(reviewDoc.data()), reviews = (reviewState.reviews ?? NO_REVIEWS) as Reviews;
    const quality = Array.isArray(reviews?.quality) ? reviews.quality : [];
    const snapshot = state.snapshot ? { ...state.snapshot, expiresAt: Math.min(state.snapshot.expiresAt, state.snapshot.startedAt + SURPLUS_METADATA_FRESH_MS) } : null, now = Date.now();
    const observations = snapshot?.offers.filter(offer => config.models.includes(offer?.model)) ?? [];
    return { ...view, status: !state.controls ? 'unavailable' : !snapshot ? 'empty' : snapshot.expiresAt <= now || snapshot.startedAt < now - SURPLUS_METADATA_FRESH_MS ? 'stale' : 'observed',
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
        const plan = planSurplusDispatchCandidate(eligibleSnapshot, reviews, ADMIN_WORKLOAD, now, reviewState.floorContract as SurplusRequestFloorContract);
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
/** Admin manual exclusion only. This cannot create quality/terms/capability/account reviews. */
export async function controlSurplusModel(modelId: string, action: 'disable' | 'enable', expectedRevision: number, snapshotVersion: string, reason: string): Promise<void> {
  const config = surplusRegistryConfig();
  if (!config.enabled || config.configurationError) throw new Error('REGISTRY_DISABLED');
  if (!config.models.includes(modelId)) throw new Error('INVALID_SURPLUS_CONTROL');
  const db = getServerDb();
  if (!db) throw new Error('REGISTRY_UNAVAILABLE');
  await new SurplusStore(db).control(modelId, action, expectedRevision, snapshotVersion, reason);
}
