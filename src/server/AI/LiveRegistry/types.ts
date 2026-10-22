/** Admin-only metadata. Never serialize credentials or prompts into these records. */
export type EligibilityStatus = 'VERIFIED_FREE' | 'PAID' | 'UNKNOWN' | 'STALE' | 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'DISABLED';
export interface LiveModelRecord {
  provider: 'openrouter';
  exactModelId: string;
  displayName: string;
  /** Response-only alias supplied on this same catalog row; never used for dispatch. */
  canonicalResponseModel?: string;
  /** Original decimal USD/token strings, not floating-point financial decisions. */
  pricing: Record<string, string>;
  inputPricePerMillion: string | null;
  outputPricePerMillion: string | null;
  supportedModalities: { input: string[]; output: string[] };
  supportedCapabilities: string[];
  contextWindow: number;
  maximumOutputTokens: number | null;
  pricingVerificationSource: string;
  pricingVerificationMethod: 'official-catalog-and-endpoints';
  verificationBasis: 'explicit-zero-fees' | 'OPENROUTER_FREE_VARIANT_CONTRACT' | 'unverified';
  pricingVerifiedAt: number;
  catalogFetchedAt: number;
  metadataExpiresAt: number;
  eligibilityStatus: EligibilityStatus;
  eligibilityReason: string;
  accountAvailable: boolean;
  endpointTag: string | null;
  registryVersion: string;
}
export interface ModelControl {
  codingEvidence?: import('./codingQuality').CodingBenchmarkEvidence;
  disabled: boolean;
  termsReviewedUntil: number;
  updatedAt: number;
  actor: string;
  endpointTag: string | null;
  reason: string;
}
export interface ModelHealth {
  cooldownUntil: number;
  status: 'RATE_LIMITED' | 'QUOTA_EXHAUSTED' | 'UNAVAILABLE' | null;
  lastErrorCode: string | null;
  successes: number;
  attempts: number;
  latencyMs: number | null;
}
export interface CatalogManifest {
  version: string;
  count: number;
  fetchedAt: number;
  expiresAt: number;
  accountVerified: boolean;
  transitions: Record<string, number>;
  chunks?: string[];
}
export interface RegistryState {
  manifest: CatalogManifest | null;
  models: LiveModelRecord[];
  controls: Record<string, ModelControl>;
  health: Record<string, ModelHealth>;
  lastSyncAttemptAt: number | null;
  lastSyncError: string | null;
  nextSyncAllowedAt?: number;
  accountCooldownUntil?: number;
  accountErrorCode?: string | null;
}
export interface SyncLease { token: string; expiresAt: number }
export interface RoutingAudit {
  requestId: string; at: number; modelId: string; registryVersion: string;
  policy: 'STRICT_FREE'; outcome: 'admitted' | 'success' | 'failed' | 'blocked';
  attempt: number; reason: string; latencyMs?: number; providerRequestId?: string;
  inputTokens?: number; outputTokens?: number; cachedTokens?: number;
  requestedMaxOutputTokens?: number; selectedMaxOutputTokens?: number;
  reportedModel?: string; reportedCost?: string; estimatedCost: '0' | null;
}
export interface RegistryStore {
  read(): Promise<RegistryState>;
  routingState(): Promise<RegistryState>;
  recheck(model: LiveModelRecord, now: number): Promise<boolean>;
  quarantine(modelId: string, reason: string, now: number): Promise<void>;
  blockAccount(until: number, code: string): Promise<void>;
  claim(now: number, ttlMs: number): Promise<SyncLease | null>;
  publish(lease: SyncLease, models: LiveModelRecord[], manifest: CatalogManifest): Promise<void>;
  fail(lease: SyncLease, at: number, reason: string, retryAt?: number): Promise<void>;
  control(modelId: string, action: 'disable' | 'enable' | 'approve-terms', actor: string, now: number, registryVersion: string, reason: string): Promise<void>;
  record(audit: RoutingAudit): Promise<void>;
  updateHealth(modelId: string, update: ModelHealth): Promise<void>;
}
export interface AdminRegistryView extends RegistryState {
  enabled: boolean;
  strictFreeModulesEnabled: boolean;
  strictFreeWeakEnabled: boolean;
  configured: boolean;
  syncIntervalMs: number;
  imageDiscovery?: { snapshot: import('./imageDiscovery').ImageDiscoverySnapshot | null; lastError: string | null };
  limitations: string[];
  history: CatalogManifest[];
  recentRouting: RoutingAudit[];
  models: Array<LiveModelRecord & { routable: boolean; cooldownUntil: number; recentLatency: number | null; recentSuccessRate: number | null; lastErrorCode: string | null }>;
}
