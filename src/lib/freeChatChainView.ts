/** Shared, credential-free contract for the admin Free Chat Chain screen and runtime. */
export const FREE_CHAIN_PROVIDER_IDS = ['glm47', 'glm45', 'groq', 'openrouter', 'cloudflare', 'gemini', 'deepseek'] as const;
export type FreeChainProviderId = typeof FREE_CHAIN_PROVIDER_IDS[number];
export function freeChainProviderLabel(id: FreeChainProviderId): string {
  return id === 'glm47' ? 'GLM 4.7 Flash' : id === 'glm45' ? 'GLM 4.5 Flash' : id;
}
export interface FreeChainControls {
  enabled: boolean;
  rolloutPercent: number;
  disabledProviders: FreeChainProviderId[];
}
export interface FreeChainControlAction {
  enabled?: boolean;
  rolloutPercent?: number;
  disabledProviders?: FreeChainProviderId[];
  reason: string;
  expectedControls: FreeChainControls;
}
export const FREE_CHAIN_MAX_PAID_CAP_USD = 10;
export interface FreeChainBudgetAction { capUsd: number; expectedRevision: number; reason: string }
export interface FreeChainBudgetResponse { ok: true; capUsd: number; policyRevision: number }
export const FREE_CHAIN_METRICS_SCAN_LIMIT = 4096;
/** Expensive history observations are requested separately, never part of status polling. */
export interface FreeChainAdminMetrics {
  observedAt: number;
  scanLimit: typeof FREE_CHAIN_METRICS_SCAN_LIMIT;
  windowHours: 24;
  sampleCount: number;
  complete: false;
  shareByProvider: Record<string, number | null>;
  fallbackRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  cacheHitRate: number | null;
}
export interface FreeChainAdminView {
  /** Deployment gate; a saved control cannot override an environment-level OFF. */
  enabled: boolean;
  runtimeEnabled: boolean;
  rolloutPercent: number;
  allowListConfigured: boolean;
  order: FreeChainProviderId[];
  providers: Array<{
    id: FreeChainProviderId;
    model: string;
    configured: boolean;
    disabled: boolean;
    reason?: string;
    usage?: Record<string, number | null>;
    limits?: Record<string, number | null>;
    nextResetAt?: number | null;
    circuit?: { state: string; openedUntil: number };
  }>;
  paid: {
    /** Effective durable shared authority, not this process's configured limit. */
    capUsd: number | null;
    /** Uninitialized is proved by a successful read, never inferred from an error. */
    policyState: 'initialized' | 'uninitialized';
    configuredCapUsd: number | null;
    policyRevision: number | null;
    reservedUsd: number | null;
    reportedUsd: number | null;
  };
  limitations: string[];
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const nullableNumber = (v: unknown): v is number | null => v === null || number(v);
const rate = (v: unknown): v is number | null => v === null || (number(v) && v <= 1);
const cap = (v: unknown): v is number | null => v === null || (number(v) && v <= FREE_CHAIN_MAX_PAID_CAP_USD);
const revision = (v: unknown): v is number => number(v) && Number.isSafeInteger(v);
const quantities = (v: unknown): boolean => object(v) && Object.values(v).every(nullableNumber);
export const isFreeChainProviderId = (v: unknown): v is FreeChainProviderId => typeof v === 'string' && (FREE_CHAIN_PROVIDER_IDS as readonly string[]).includes(v);
const providers = (v: unknown): v is FreeChainProviderId[] => Array.isArray(v) && v.length <= FREE_CHAIN_PROVIDER_IDS.length && v.every(isFreeChainProviderId) && new Set(v).size === v.length;

/** Do not store an error or a partially decoded response as a healthy chain snapshot. */
export function isFreeChainAdminView(v: unknown): v is FreeChainAdminView {
  if (!object(v) || typeof v.enabled !== 'boolean' || typeof v.runtimeEnabled !== 'boolean'
    || !number(v.rolloutPercent) || !Number.isInteger(v.rolloutPercent) || v.rolloutPercent > 100 || typeof v.allowListConfigured !== 'boolean'
    || !providers(v.order) || !Array.isArray(v.providers) || v.providers.length !== FREE_CHAIN_PROVIDER_IDS.length
    || !providers(v.providers.map(p => object(p) ? p.id : null))
    || !object(v.paid) || !(v.paid.policyState === 'uninitialized' ? v.paid.capUsd === null && v.paid.policyRevision === null : v.paid.policyState === 'initialized' && number(v.paid.capUsd) && revision(v.paid.policyRevision) && v.paid.policyRevision > 0) || !cap(v.paid.capUsd) || !cap(v.paid.configuredCapUsd) || !(v.paid.policyRevision === null || revision(v.paid.policyRevision)) || !nullableNumber(v.paid.reservedUsd) || !nullableNumber(v.paid.reportedUsd)
    || !Array.isArray(v.limitations) || !v.limitations.every(s => typeof s === 'string')) return false;
  return v.providers.every(p => object(p) && typeof p.model === 'string' && typeof p.configured === 'boolean' && typeof p.disabled === 'boolean'
    && (p.reason === undefined || typeof p.reason === 'string')
    && (p.usage === undefined || quantities(p.usage)) && (p.limits === undefined || quantities(p.limits))
    && (p.nextResetAt === undefined || nullableNumber(p.nextResetAt))
    && (p.circuit === undefined || (object(p.circuit) && typeof p.circuit.state === 'string' && number(p.circuit.openedUntil))));
}

export function isFreeChainAdminMetrics(m: unknown): m is FreeChainAdminMetrics {
  return object(m) && number(m.observedAt) && Number.isInteger(m.observedAt) && m.observedAt > 0 && m.observedAt <= 8.64e15
    && m.scanLimit === FREE_CHAIN_METRICS_SCAN_LIMIT && m.windowHours === 24
    && number(m.sampleCount) && Number.isInteger(m.sampleCount) && m.sampleCount <= m.scanLimit && m.complete === false
    && object(m.shareByProvider) && Object.keys(m.shareByProvider).every(isFreeChainProviderId) && Object.values(m.shareByProvider).every(rate)
    && rate(m.fallbackRate) && rate(m.cacheHitRate) && nullableNumber(m.p50Ms) && nullableNumber(m.p95Ms);
}

export function validFreeChainReason(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length >= 10 && v.length <= 500;
}

/** Strict allowlist: this endpoint cannot change credentials, budgets, models or provider URLs. */
export function readFreeChainControlAction(value: unknown): FreeChainControlAction | null {
  if (!object(value) || !validFreeChainReason(value.reason)
    || Object.keys(value).some(k => !['enabled', 'rolloutPercent', 'disabledProviders', 'reason', 'expectedControls'].includes(k))) return null;
  if (!object(value.expectedControls) || typeof value.expectedControls.enabled !== 'boolean'
    || !number(value.expectedControls.rolloutPercent) || !Number.isInteger(value.expectedControls.rolloutPercent) || value.expectedControls.rolloutPercent > 100
    || !providers(value.expectedControls.disabledProviders)
    || Object.keys(value.expectedControls).some(k => !['enabled', 'rolloutPercent', 'disabledProviders'].includes(k))) return null;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return null;
  if (value.rolloutPercent !== undefined && (!number(value.rolloutPercent) || !Number.isInteger(value.rolloutPercent) || value.rolloutPercent > 100)) return null;
  if (value.disabledProviders !== undefined && !providers(value.disabledProviders)) return null;
  if (value.enabled === undefined && value.rolloutPercent === undefined && value.disabledProviders === undefined) return null;
  return {
    ...(value.enabled !== undefined ? { enabled: value.enabled as boolean } : {}),
    ...(value.rolloutPercent !== undefined ? { rolloutPercent: value.rolloutPercent as number } : {}),
    ...(value.disabledProviders !== undefined ? { disabledProviders: [...value.disabledProviders as FreeChainProviderId[]] } : {}),
    reason: value.reason.trim(),
    expectedControls: { enabled: value.expectedControls.enabled, rolloutPercent: value.expectedControls.rolloutPercent, disabledProviders: [...value.expectedControls.disabledProviders] },
  };
}

/** Deliberate budget edits use cents, with integer nanoUSD conversion on the server. */
export function validFreeChainBudgetUsd(v: unknown): v is number {
  return number(v) && v <= FREE_CHAIN_MAX_PAID_CAP_USD && /^\d+(?:\.\d{1,2})?$/.test(String(v));
}
export function readFreeChainBudgetAction(v: unknown): FreeChainBudgetAction | null {
  if (!object(v) || !validFreeChainBudgetUsd(v.capUsd) || !revision(v.expectedRevision) || !validFreeChainReason(v.reason)
    || Object.keys(v).some(k => !['capUsd', 'expectedRevision', 'reason'].includes(k))) return null;
  return { capUsd: v.capUsd, expectedRevision: v.expectedRevision, reason: v.reason.trim() };
}
export function isFreeChainBudgetResponse(v: unknown): v is FreeChainBudgetResponse {
  return object(v) && v.ok === true && validFreeChainBudgetUsd(v.capUsd) && revision(v.policyRevision) && v.policyRevision > 0;
}
export function freeChainBudgetFingerprint(view: FreeChainAdminView): string {
  return JSON.stringify([view.paid.policyState, view.paid.capUsd, view.paid.configuredCapUsd, view.paid.policyRevision]);
}

export function freeChainControls(view: FreeChainAdminView): FreeChainControls {
  return { enabled: view.runtimeEnabled, rolloutPercent: view.rolloutPercent, disabledProviders: view.providers.filter(p => p.disabled).map(p => p.id).sort() };
}
export function freeChainControlFingerprint(view: FreeChainAdminView): string { return JSON.stringify(freeChainControls(view)); }
export function freeChainPercent(value: number | null | undefined): string { return value == null ? 'Not measured' : `${(value * 100).toFixed(1)}%`; }
export function freeChainUsd(value: number | null): string { return value === null ? 'Unavailable' : value > 0 && value < 0.0001 ? '<$0.0001 USD' : `$${value.toFixed(4)} USD`; }
export function freeChainTimestamp(value: number | null | undefined): string { return value && Number.isFinite(value) && value <= 8.64e15 ? new Date(value).toLocaleString() : 'Not available'; }
