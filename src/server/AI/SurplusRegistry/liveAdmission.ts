/** Production evidence reader. Catalogs and configured credentials are observations,
 * not capability tests, quality benchmarks, account assurances or official tariffs.
 * Missing verified records decline Weak-builder admission; diagnostic bots are separate.
 */
import { createHash } from 'node:crypto';
import { parseEnvFlag } from '../../lib/envFlag';
import { SURPLUS_MIN90_BASE_URL } from '../../lib/surplusClient';
import type { SurplusCapabilityReview } from './buildSession';
import type { SurplusOfficialTariff } from './receiptPolicy';
import type { SurplusPilotAuthority } from './receiptStore';
import type { Snapshot, Reviews } from './types';
import type { SurplusRequestFloorContract } from './selector';

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

/** Read existing evidence without creating or renewing any assertion from a catalog.
 * The historical name is retained for internal callers; this function no longer synthesizes reviews.
 * Missing evidence declines production admission; manual diagnostics do not use this path.
 */
export function synthesizeLiveReviews(env: NodeJS.ProcessEnv, snapshot: Snapshot | null, now: number, evidence?: unknown): LiveProductionReviews {
  const key = surplusLiveKey(env);
  if (!key || !surplusBuilderLive(env)) throw new Error('Surplus builder is disabled or unconfigured');
  const data = evidence as LiveProductionReviews | undefined;
  const fresh = (value: { reviewedAt?: number; expiresAt?: number } | undefined) => !!value && Number.isFinite(value.reviewedAt) && value.reviewedAt! <= now && Number.isFinite(value.expiresAt) && value.expiresAt! > now;
  const artifact = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^(.)\1{63}$/.test(value);
  const source = (value: unknown) => typeof value === 'string' && /^https:\/\//.test(value) && !/example\.|\.example(?:\/|$)/i.test(value);
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < 1
    || !Array.isArray(data.capabilities) || !data.capabilities.length
    || !data.capabilities.every(c => fresh(c) && c.endpoint === SURPLUS_MIN90_BASE_URL)
    || !Array.isArray(data.tariffs) || !data.tariffs.length
    || !data.tariffs.every(t => artifact(t.artifactSha256) && source(t.sourceUrl) && t.reviewedAt <= now && t.reviewExpiresAt > now)
    || !Array.isArray(data.usageMappings) || !data.usageMappings.length || !data.usageMappings.every(fresh)
    || !data.reviews || !Array.isArray(data.reviews.quality) || !data.reviews.quality.length
    || !data.reviews.quality.every(q => fresh(q) && q.approved === true && artifact(q.artifactSha256))
    || !fresh(data.reviews.pricingContract ?? undefined) || !source(data.reviews.pricingContract?.sourceUrl)
    || !(data.reviews.accountAndPrivacyReviewedUntil > now)
    || !fresh(data.floorContract) || data.floorContract.endpoint !== SURPLUS_MIN90_BASE_URL
    || !data.account || data.account.marketplaceOnly !== true || data.account.noFallbackKeys !== true || data.account.credentialSha256 !== credentialSha256(key) || !(data.account.reviewedUntil > now)
    || !(data.account.liveCredentialCheckAt <= now) || !(data.account.liveCredentialCheckExpiresAt > now)
    || !data.pilot || !(data.pilot.expiresAt > now) || !(data.pilot.providerSpendLimitReviewedUntil > now)
    || data.pilot.noAutoTopup !== true) throw new Error('Surplus production evidence unavailable or unverified');
  return structuredClone({ ...data, snapshot });
}
