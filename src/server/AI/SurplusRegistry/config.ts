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
 * gate (reviewed+approved, healthy, trusted, fresh, the model's discount floor — 85%, or 90% for a
 * Claude-family model on Weak — reported AND workload-weighted; see `surplusBuildFloor`).
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

/**
 * THE DISCOUNT FLOOR — one source of truth (admin decision 2026-11-27).
 *
 * - Every Surplus build request is routed on a request-time minimum-discount floor: the URL segment `min{N}`
 *   (official docs: `min0`..`min100`, no leading zeros, no decimals; the router checks `estimated_discount_pct >= N`
 *   per request and answers HTTP 404 `minimum_discount_not_met` — free, not attempted — when no seller meets it).
 *   The realized discount may still differ from the router's estimate; receipts are checked again (receiptStore).
 * - The floor is 85% (it was 90% until 2026-11-27). Among offers that clear it, the strongest model builds
 *   (`surplusCodingQuality`, unchanged).
 * - A Claude-family model (Claude / Sonnet / Opus) on the Weak tier runs ONLY on a guaranteed ≥ 90% floor. This is the
 *   single exception to "Weak never runs Sonnet or Opus": it holds only through Surplus, only on `/min90`, and only
 *   when the selected offer also clears 90%. Every direct provider, ladder rung and fallback stays Claude-free on Weak.
 *
 * There is no environment override for the BUILDER's endpoint: it is derived from these constants only.
 * (`SURPLUS_BASE_URL` configures the separate text-only helper in `lib/surplusClient.ts`, never the builder.)
 */
export const SURPLUS_ORIGIN = 'https://api.surplusintelligence.ai';
export const SURPLUS_MIN_DISCOUNT_PCT = 85;
export const SURPLUS_CLAUDE_MIN_DISCOUNT_PCT = 90;
/** The admin's bar for Claude on Weak, written as a literal on purpose: lowering the constant above cannot lower it. */
const WEAK_CLAUDE_ADMIN_BAR_PCT = 90;

/** Claude / Sonnet / Opus model ids (any spelling). PURE. */
export function isSurplusClaudeFamily(model: string): boolean {
  return typeof model === 'string' && /claude|sonnet|opus/i.test(model);
}

/** The minimum discount a Surplus request for this model on this tier is routed with. PURE. */
export function surplusFloorFor(model: string, tier: string): number {
  return tier === 'weak' && isSurplusClaudeFamily(model) ? SURPLUS_CLAUDE_MIN_DISCOUNT_PCT : SURPLUS_MIN_DISCOUNT_PCT;
}

/** The Surplus builder runs on Weak only (owner 2026-10-25), so its floor is the Weak floor. PURE. */
export function surplusBuildFloor(model: string): number {
  return surplusFloorFor(model, 'weak');
}

/** `https://api.surplusintelligence.ai/min{N}/v1`, or `/anthropic/min{N}/v1` for the Anthropic Messages protocol. PURE. */
export function surplusBaseUrl(floor: number, protocol: 'openai' | 'anthropic' = 'openai'): string {
  if (!Number.isInteger(floor) || floor < 0 || floor > 100) throw new Error('Invalid Surplus minimum-discount floor');
  return protocol === 'anthropic' ? `${SURPLUS_ORIGIN}/anthropic/min${floor}/v1` : `${SURPLUS_ORIGIN}/min${floor}/v1`;
}

/** The exact base URL the builder sends this model's requests to. PURE. */
export function surplusBuildEndpoint(model: string): string {
  return surplusBaseUrl(surplusBuildFloor(model));
}

const FLOOR_URL = /^https:\/\/api\.surplusintelligence\.ai\/(?:anthropic\/)?min(0|[1-9]\d?|100)\/v1(?:\/chat\/completions|\/messages)?$/;
const FLOOR_BASE_URL = /^https:\/\/api\.surplusintelligence\.ai\/min(0|[1-9]\d?|100)\/v1$/;

/** The floor an official Surplus floor URL routes on (either protocol, base or full path); null when it has none. PURE. */
export function surplusFloorOfEndpoint(url: unknown): number | null {
  const m = typeof url === 'string' ? FLOOR_URL.exec(url) : null;
  return m ? Number(m[1]) : null;
}

/** The floor of an official OpenAI-protocol builder BASE url (`…/min{N}/v1`); null for anything else. PURE. */
export function surplusFloorOfBuildBaseUrl(url: unknown): number | null {
  const m = typeof url === 'string' ? FLOOR_BASE_URL.exec(url) : null;
  return m ? Number(m[1]) : null;
}

/**
 * A builder base URL is valid for this model when it is the official floor URL and its floor is AT LEAST the model's
 * floor. A stricter floor is never a violation (it only narrows supply); a looser one always is. Production always
 * sends exactly `surplusBuildEndpoint(model)`. PURE.
 */
export function surplusBuildEndpointValid(url: unknown, model: string): boolean {
  const floor = surplusFloorOfBuildBaseUrl(url);
  return floor !== null && floor >= surplusBuildFloor(model);
}

/**
 * May a Surplus session on this tier choose this model at all? Non-Claude models: yes. Claude-family: only on Weak and
 * only when its floor is the guaranteed ≥ 90% (admin 2026-11-27). PURE.
 */
export function surplusModelPermitted(model: string, tier: string): boolean {
  if (!isSurplusClaudeFamily(model)) return true;
  return tier === 'weak' && surplusFloorFor(model, tier) >= WEAK_CLAUDE_ADMIN_BAR_PCT;
}
