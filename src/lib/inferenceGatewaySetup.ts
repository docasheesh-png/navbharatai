/** Narrow admin review form. No raw secrets, arbitrary documents, activation or budget controls. */
export const GATEWAY_SETUP_PROVIDERS = ['GLM', 'GROQ', 'CLOUDFLARE', 'OPENROUTER', 'DEEPSEEK', 'VERTEX', 'BRAVE', 'GEMINI'] as const;
export type GatewaySetupProvider = typeof GATEWAY_SETUP_PROVIDERS[number];
export const GATEWAY_REVIEW_FIELDS = ['account', 'terms', 'quality', 'privacy', 'capability', 'pricing', 'quota'] as const;
export type GatewayReviewField = typeof GATEWAY_REVIEW_FIELDS[number];
export const GATEWAY_ATTESTATIONS = ['accountOwnership', 'productionUse', 'terms', 'privacy', 'quality', 'exactPricing', 'noTraining', 'noHumanReview', 'localQuotaOnly'] as const;
export type GatewaySetupOperation =
  | { kind: 'embedding'; maxInputBytes: number; project: string; location: string; credentialPrincipal: string; maxNanoUsdPerCharacter: number }
  | { kind: 'grounding-search'; maxQueryBytes: number; maxResults: number; requestNanoUsd: number }
  | { kind: 'vision-pdf'; maxImages: number; maxPdfPages: 0 | 1000; maxAttachmentBytes: number; maxImageDimension: number };
export interface GatewaySetupSubmission {
  operationId: string; expectedCatalogRevision: string | null;
  profileId: string; provider: GatewaySetupProvider; modelId: string; modelRevision: string; canonicalModelId: string;
  canonicalAccountId: string; credentialEnv: string; platformOwnerId: string;
  policyKeys: string[]; termsPolicyId: string; qualityGateId: string; qualityGateVersion: string; privacyPolicyId: string;
  processingRegions: string[]; retentionHours: number; maxInputTokens: number; maxOutputTokens: number; maxContextTokens: number;
  localTokensPerMinute: number; billing: 'intrinsic-zero' | 'provider-hard-stop' | 'metered';
  reviewedPriority?: number;
  recoverHealth?: boolean;
  operation?: GatewaySetupOperation;
  inputNanoUsdPerMillion?: number; outputNanoUsdPerMillion?: number;
  endpointTag?: string; registryVersion?: string;
  reviewedAtMs: number; expiresAtMs: number;
  evidence: Record<GatewayReviewField, string>;
  attestations: Record<typeof GATEWAY_ATTESTATIONS[number], boolean>;
  reason: string;
}
export interface GatewaySetupStatus {
  kind: 'gateway_setup_status'; version: 1; observedAtMs: number;
  rollout?: { mode: 'canary' | 'all' | 'invalid'; canaryCount: number };
  deploymentEnabled: boolean; catalogRevision: string | null;
  reviewState: 'missing' | 'current' | 'expired' | 'invalid'; expiresAtMs: number | null;
  credentialEnvironments: string[];
  scopes: { key: string; label: string; dataClass: 'health' | 'confidential'; qualityTier: 'clinical' | 'professional' }[];
  profiles: { id: string; provider: string; modelId: string; operationKind?: 'text' | GatewaySetupOperation['kind']; expiresAtMs: number; reviewState: 'current' | 'expired' | 'invalid'; credentialAssociated: boolean; billing: 'intrinsic-zero' | 'provider-hard-stop' | 'metered' | 'unreviewed' }[];
  paidAuthority: 'existing' | 'missing'; paidCapUsd: number | null;
  upstreamRemaining: 'unknown'; liveProviderVerified: false;
}
export interface GatewaySetupPreview {
  kind: 'gateway_setup_preview'; version: 1; previewBinding: string;
  profileId: string; canonicalAccountId: string; policyKeys: string[]; billing: GatewaySetupSubmission['billing'];
  expiresAtMs: number; localTokensPerMinute: number; quotaMeter?: 'tokens/minute' | 'requests/minute'; operationKind?: 'text' | GatewaySetupOperation['kind']; maximumOperationNanoUsd?: number; reviewedPriority: number; credentialAssociated: true;
  healthRecoveryRecords?: number;
  paidAuthority: 'existing' | 'missing'; activationFlagChanged: false; deploymentEnabled: boolean;
}
export function isGatewaySetupStatus(value: unknown): value is GatewaySetupStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as GatewaySetupStatus;
  const str = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 256;
  const n = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
  return v.kind === 'gateway_setup_status' && v.version === 1 && n(v.observedAtMs)
    && (v.rollout === undefined || (v.rollout !== null && typeof v.rollout === 'object' && ['canary', 'all', 'invalid'].includes(v.rollout.mode) && n(v.rollout.canaryCount) && v.rollout.canaryCount <= 32))
    && typeof v.deploymentEnabled === 'boolean' && (v.catalogRevision === null || str(v.catalogRevision))
    && ['missing', 'current', 'expired', 'invalid'].includes(v.reviewState) && (v.expiresAtMs === null || n(v.expiresAtMs))
    && Array.isArray(v.credentialEnvironments) && v.credentialEnvironments.length <= 64 && v.credentialEnvironments.every(str)
    && Array.isArray(v.scopes) && v.scopes.length <= 256 && v.scopes.every(s => str(s.key) && str(s.label) && ['health', 'confidential'].includes(s.dataClass) && ['clinical', 'professional'].includes(s.qualityTier))
    && Array.isArray(v.profiles) && v.profiles.length <= 32 && v.profiles.every(p => str(p.id) && str(p.provider) && str(p.modelId) && n(p.expiresAtMs)
      && (p.operationKind === undefined || ['text', 'embedding', 'grounding-search', 'vision-pdf'].includes(p.operationKind))
      && ['current', 'expired', 'invalid'].includes(p.reviewState) && typeof p.credentialAssociated === 'boolean' && ['intrinsic-zero', 'provider-hard-stop', 'metered', 'unreviewed'].includes(p.billing))
    && ['existing', 'missing'].includes(v.paidAuthority) && (v.paidCapUsd === null || (typeof v.paidCapUsd === 'number' && v.paidCapUsd >= 0 && v.paidCapUsd <= 10))
    && v.upstreamRemaining === 'unknown' && v.liveProviderVerified === false;
}
export function isGatewaySetupPreview(value: unknown): value is GatewaySetupPreview {
  if (!value || typeof value !== 'object') return false;
  const v = value as GatewaySetupPreview;
  return v.kind === 'gateway_setup_preview' && v.version === 1 && /^[a-f0-9]{64}$/.test(v.previewBinding)
    && typeof v.profileId === 'string' && typeof v.canonicalAccountId === 'string'
    && Array.isArray(v.policyKeys) && v.policyKeys.length > 0 && v.policyKeys.length <= 8 && v.policyKeys.every(k => typeof k === 'string')
    && ['intrinsic-zero', 'provider-hard-stop', 'metered'].includes(v.billing) && Number.isSafeInteger(v.expiresAtMs)
    && (v.maximumOperationNanoUsd === undefined || (Number.isSafeInteger(v.maximumOperationNanoUsd) && v.maximumOperationNanoUsd >= 0 && v.maximumOperationNanoUsd <= 10_000_000_000))
    && (v.healthRecoveryRecords === undefined || (Number.isSafeInteger(v.healthRecoveryRecords) && v.healthRecoveryRecords >= 1 && v.healthRecoveryRecords <= 2))
    && Number.isSafeInteger(v.reviewedPriority) && v.reviewedPriority >= 0 && v.reviewedPriority <= 1000
    && Number.isSafeInteger(v.localTokensPerMinute) && v.localTokensPerMinute > 0 && v.credentialAssociated === true
    && ['existing', 'missing'].includes(v.paidAuthority) && v.activationFlagChanged === false && typeof v.deploymentEnabled === 'boolean';
}
