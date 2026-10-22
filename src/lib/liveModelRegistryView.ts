import type { AdminRegistryView } from '../server/AI/LiveRegistry/types';

export type RegistryModelView = AdminRegistryView['models'][number];
export const REGISTRY_STATUSES = ['VERIFIED_FREE', 'PAID', 'UNKNOWN', 'STALE', 'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'UNAVAILABLE', 'DISABLED'] as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const nullableNumber = (v: unknown) => v === null || number(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';

/** A failed or malformed read must never become a healthy empty registry. */
export function isRegistryView(v: unknown): v is AdminRegistryView {
  if (!object(v) || typeof v.enabled !== 'boolean' || typeof v.configured !== 'boolean'
    || typeof v.strictFreeModulesEnabled !== 'boolean' || typeof v.strictFreeWeakEnabled !== 'boolean' || !number(v.syncIntervalMs)
    || !strings(v.limitations) || !object(v.controls) || !object(v.health)
    || !nullableNumber(v.lastSyncAttemptAt) || !nullableString(v.lastSyncError) || !Array.isArray(v.models)) return false;
  if (v.manifest !== null && (!object(v.manifest) || typeof v.manifest.version !== 'string'
    || !number(v.manifest.count) || !number(v.manifest.fetchedAt) || !number(v.manifest.expiresAt)
    || typeof v.manifest.accountVerified !== 'boolean' || !object(v.manifest.transitions)
    || !Object.values(v.manifest.transitions).every(number))) return false;
  if (!Object.values(v.controls).every(c => object(c) && typeof c.disabled === 'boolean'
    && number(c.termsReviewedUntil) && number(c.updatedAt) && typeof c.actor === 'string')) return false;
  if (!Object.values(v.health).every(h => object(h) && number(h.cooldownUntil) && nullableString(h.lastErrorCode)
    && number(h.successes) && number(h.attempts) && nullableNumber(h.latencyMs))) return false;
  if (v.history !== undefined && (!Array.isArray(v.history) || v.history.length > 30 || !v.history.every(h => object(h) && typeof h.version === 'string' && number(h.fetchedAt) && object(h.transitions) && Object.values(h.transitions).every(number)))) return false;
  if (v.recentRouting !== undefined && (!Array.isArray(v.recentRouting) || v.recentRouting.length > 30 || !v.recentRouting.every(r => object(r) && typeof r.requestId === 'string' && number(r.at) && typeof r.modelId === 'string' && typeof r.outcome === 'string' && typeof r.reason === 'string' && (r.reportedCost === undefined || typeof r.reportedCost === 'string')))) return false;
  if (v.imageDiscovery !== undefined) {
    if (!object(v.imageDiscovery) || !nullableString(v.imageDiscovery.lastError)) return false;
    const image = v.imageDiscovery.snapshot;
    if (image !== null && (!object(image) || !number(image.fetchedAt) || !number(image.expiresAt) || !Array.isArray(image.models) || image.models.length > 1000 || !image.models.every(m => object(m) && typeof m.exactModelId === 'string' && typeof m.eligibilityReason === 'string' && ['UNKNOWN', 'PAID', 'VERIFIED_FREE'].includes(String(m.eligibilityStatus))))) return false;
  }
  return v.models.every(m => object(m) && typeof m.provider === 'string' && typeof m.exactModelId === 'string'
    && typeof m.displayName === 'string' && object(m.pricing) && Object.values(m.pricing).every(x => typeof x === 'string')
    && nullableString(m.inputPricePerMillion) && nullableString(m.outputPricePerMillion)
    && object(m.supportedModalities) && strings(m.supportedModalities.input) && strings(m.supportedModalities.output)
    && strings(m.supportedCapabilities) && number(m.contextWindow) && nullableNumber(m.maximumOutputTokens)
    && typeof m.pricingVerificationSource === 'string' && typeof m.pricingVerificationMethod === 'string'
    && number(m.pricingVerifiedAt) && number(m.catalogFetchedAt) && number(m.metadataExpiresAt)
    && REGISTRY_STATUSES.includes(m.eligibilityStatus as typeof REGISTRY_STATUSES[number])
    && typeof m.eligibilityReason === 'string' && typeof m.accountAvailable === 'boolean'
    && nullableString(m.endpointTag) && typeof m.registryVersion === 'string' && typeof m.routable === 'boolean'
    && number(m.cooldownUntil) && nullableNumber(m.recentLatency) && nullableNumber(m.recentSuccessRate) && (m.recentSuccessRate === null || (m.recentSuccessRate as number) <= 1)
    && nullableString(m.lastErrorCode));
}

export function effectiveRegistryStatus(m: RegistryModelView, now: number): string {
  // Client time can only REMOVE apparent eligibility, never grant it.
  return m.eligibilityStatus === 'VERIFIED_FREE' && m.metadataExpiresAt <= now ? 'STALE' : m.eligibilityStatus;
}
export interface RegistryFilters { query: string; status: string; provider: string; capability: string; minContext: number; maxLatency: number; minSuccess: number }
export const EMPTY_REGISTRY_FILTERS: RegistryFilters = { query: '', status: '', provider: '', capability: '', minContext: 0, maxLatency: 0, minSuccess: 0 };
export function filterRegistryModels(models: RegistryModelView[], filters: RegistryFilters, now: number): RegistryModelView[] {
  const q = filters.query.toLowerCase().trim();
  return models.filter(m => (!q || `${m.exactModelId} ${m.displayName}`.toLowerCase().includes(q))
    && (!filters.status || effectiveRegistryStatus(m, now) === filters.status)
    && (!filters.provider || m.provider === filters.provider)
    && (filters.capability !== 'text-only' || (m.supportedModalities.input.length === 1 && m.supportedModalities.input[0] === 'text' && m.supportedModalities.output.length === 1 && m.supportedModalities.output[0] === 'text'))
    && (filters.capability !== 'tools' || m.supportedCapabilities.includes('tools'))
    && m.contextWindow >= filters.minContext
    && (!filters.maxLatency || (m.recentLatency !== null && m.recentLatency <= filters.maxLatency))
    && (!filters.minSuccess || (m.recentSuccessRate !== null && m.recentSuccessRate * 100 >= filters.minSuccess)));
}
export function registryTimestamp(value: number | null): string { return value && Number.isFinite(value) ? new Date(value).toLocaleString() : 'Not measured'; }
export function safeRegistrySource(source: string): string | null {
  try { const u = new URL(source); return u.protocol === 'https:' && u.hostname === 'openrouter.ai' && !u.port && !u.username && !u.password && (u.pathname.startsWith('/docs/') || u.pathname.startsWith('/api/v1/models') || u.pathname === '/models') ? u.href : null; } catch { return null; }
}
export function registryActionReason(value: string): boolean { const length = value.trim().length; return length >= 10 && length <= 500; }
