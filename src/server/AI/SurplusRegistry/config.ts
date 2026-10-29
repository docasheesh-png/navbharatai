/** Bounds shared by observation, storage and selection. No constant grants inference approval. */
export const SURPLUS_MAX_MODELS = 15;
export const SURPLUS_MAX_OFFERS_PER_MODEL = 64;
export const SURPLUS_MAX_OFFERS = SURPLUS_MAX_MODELS * SURPLUS_MAX_OFFERS_PER_MODEL;
export const SURPLUS_MAX_SNAPSHOT_BYTES = 500_000;
export const SURPLUS_METADATA_FRESH_MS = 300_000;
export const SURPLUS_FETCH_CONCURRENCY = 3;
export const SURPLUS_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
export const isSurplusModelId = (value: unknown): value is string => typeof value === 'string' && SURPLUS_MODEL_ID.test(value)
  && value.split('/').every(part => !!part && part !== '.' && part !== '..');
export function validSurplusUniverse(models: unknown): models is string[] {
  return Array.isArray(models) && models.length > 0 && models.length <= SURPLUS_MAX_MODELS
    && models.every(isSurplusModelId) && new Set(models).size === models.length;
}
/**
 * Observation candidates verified in the public catalog on 2026-10-24:
 * https://api.surplusintelligence.ai/v1/models
 * These are NOT a quality ranking, benchmark approvals or automatic future discovery.
 * Every dispatch still requires independent current coding and capability reviews.
 */
export const SURPLUS_OBSERVATION_CANDIDATES: readonly string[] = Object.freeze([
  'deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017', 'glm-5.3', 'glm-5.3-flash', 'glm-5.2',
  'qwen3.8-flash', 'qwen3.8-2.4t-a95b', 'qwen3-coder', 'qwen3-coder-next', 'qwen3-coder-30b-a3b-instruct',
  'minimax-m2.5', 'minimax-m2.1', 'gpt-5.6-luna', 'gpt-5.6-sol', 'claude-sonnet-5',
]);

/**
 * Coding-quality preference (best first) used ONLY to order offers that already passed every
 * gate (reviewed+approved, healthy, trusted, fresh, ≥90% discount reported AND workload-weighted).
 * Grants nothing by itself. A reviewed `qualityScore` on the QualityReview overrides this order.
 * Admin decision 2026-10-29: when >1 coding-eligible model qualifies, pick the better one, not the cheapest.
 */
export const SURPLUS_CODING_QUALITY_ORDER: readonly string[] = Object.freeze([
  'claude-sonnet-5', 'gpt-5.6-sol', 'qwen3-coder', 'glm-5.3', 'qwen3.8-2.4t-a95b',
  'deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash', 'minimax-m2.5', 'gpt-5.6-luna', 'qwen3-coder-next',
  'glm-5.2', 'minimax-m2.1', 'glm-5.3-flash', 'qwen3.8-flash', 'qwen3-coder-30b-a3b-instruct',
]);
/** Higher = better. Reviewed score (0–100) wins; else static order; unknown models rank last. */
export function surplusCodingQuality(model: string, reviewedScore?: unknown): number {
  if (typeof reviewedScore === 'number' && Number.isFinite(reviewedScore) && reviewedScore >= 0 && reviewedScore <= 100) return 1000 + reviewedScore;
  const i = SURPLUS_CODING_QUALITY_ORDER.indexOf(model);
  return i < 0 ? -1 : SURPLUS_CODING_QUALITY_ORDER.length - i;
}
