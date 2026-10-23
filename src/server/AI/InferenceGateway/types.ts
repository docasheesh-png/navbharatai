/**
 * Server-only routing contract used by the default-off gateway composition.
 * None of these TypeScript shapes authenticates its data. The trusted ingress
 * must authenticate the principal and derive surface, privacy,
 * quality and payer from server policy, never from client mode/provider strings.
 */
export type Surface = 'chat' | 'professional' | 'doctor' | 'sda' | 'builder'
  | 'developer-api' | 'published-app' | 'image-generation' | 'image-enhancement';
export type QualityTier = 'standard' | 'weak' | 'normal' | 'strong' | 'professional' | 'clinical';
export type DataClass = 'public' | 'personal' | 'confidential' | 'health';
export type RoutingMode = 'strict-free' | 'free-first-authorized-paid';
export type Payer = { readonly kind: 'platform'; readonly ownerId: string }
  | { readonly kind: 'tenant'; readonly ownerId: string; readonly tenantId: string };
export interface QualityRequirement {
  readonly tier: QualityTier;
  /** Exact versioned benchmark/policy gate, not an invented cross-model quality score. */
  readonly gateId: string;
  readonly gateVersion: string;
}
export interface PrivacyRequirement {
  readonly dataClass: DataClass;
  readonly policyId: string;
  readonly allowedProcessingRegions: readonly string[];
  readonly maxRetentionHours: number;
  readonly allowTraining: boolean;
  readonly allowHumanReview: boolean;
}
interface TokenBounds { readonly inputTokens: number; readonly outputTokens: number; }
interface GenerationRequirements extends TokenBounds {
  readonly streaming: boolean;
  readonly systemPrompt: boolean;
}
export type StructuredFeature = 'tool-calls' | 'strict-json-schema' | 'parallel-tool-calls';
export type VisionFormat = 'image/png' | 'image/jpeg' | 'application/pdf';
export type CapabilityRequest =
  | ({ readonly kind: 'text' } & GenerationRequirements)
  | ({ readonly kind: 'tool-json'; readonly features: readonly StructuredFeature[];
       readonly schemaDialect: string } & GenerationRequirements)
  | ({ readonly kind: 'vision-pdf'; readonly formats: readonly VisionFormat[];
       readonly imageCount: number; readonly pdfPages: number } & GenerationRequirements)
  | { readonly kind: 'voice-session'; readonly inputFormat: string; readonly outputFormat: string;
      readonly bidirectional: boolean; readonly interruption: boolean; readonly maxDurationMs: number }
  | { readonly kind: 'embedding'; readonly inputTokens: number; readonly dimensions: number;
      /** Must identify the exact embedding model/revision and preprocessing version. */
      readonly vectorSpaceId: string }
  | { readonly kind: 'grounding-search'; readonly queries: number; readonly maxResults: number;
      readonly citations: boolean; readonly domainFiltering: boolean };
interface GenerationSupport {
  readonly maxContextTokens: number; readonly maxInputTokens: number; readonly maxOutputTokens: number;
  readonly streaming: boolean; readonly systemPrompt: boolean;
}
export type CapabilitySupport =
  | ({ readonly kind: 'text' } & GenerationSupport)
  | ({ readonly kind: 'tool-json'; readonly features: readonly StructuredFeature[];
       readonly schemaDialects: readonly string[] } & GenerationSupport)
  | ({ readonly kind: 'vision-pdf'; readonly formats: readonly VisionFormat[];
       readonly maxImages: number; readonly maxPdfPages: number } & GenerationSupport)
  | { readonly kind: 'voice-session'; readonly inputFormats: readonly string[]; readonly outputFormats: readonly string[];
      readonly bidirectional: boolean; readonly interruption: boolean; readonly maxDurationMs: number }
  | { readonly kind: 'embedding'; readonly maxInputTokens: number; readonly dimensions: number; readonly vectorSpaceId: string }
  | { readonly kind: 'grounding-search'; readonly maxQueries: number; readonly maxResults: number;
      readonly citations: boolean; readonly domainFiltering: boolean };
interface AttemptIdentity {
  readonly physicalAttemptId: string;
  readonly profileId: string;
  readonly outputVisible: boolean;
}
/** A timeout/abort after dispatch is uncertain. A refusal is terminal even before visible output. */
export type AttemptRecord = AttemptIdentity & (
  | { readonly outcome: 'definite-failure';
      readonly failureClass: 'retryable-provider-failure' | 'safety-refusal' | 'policy-denied' | 'invalid-request' }
  | { readonly outcome: 'uncertain' | 'completed'; readonly failureClass?: never }
);
export interface RoutingRequest {
  readonly logicalRequestId: string;
  readonly nextPhysicalAttemptId: string;
  /** Canonical complete payload digest, including instructions/history/tool schemas; no payload is stored here. */
  readonly payloadDigest: string;
  readonly policyRevision: string;
  readonly termsPolicyId: string;
  /** Server-selected spend pool; funded builder and new fallback pools must not mix. */
  readonly budgetScopeId: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly surface: Surface;
  readonly quality: QualityRequirement;
  readonly capability: CapabilityRequest;
  readonly privacy: PrivacyRequirement;
  readonly payer: Payer;
  readonly mode: RoutingMode;
  readonly createdAtMs: number;
  readonly deadlineAtMs: number;
  /** Separate queue, first output, and complete attempt/session deadlines. No chat defaults. */
  readonly maxQueueWaitMs: number;
  /** Durable total from previous admissions; excludes the current queue interval. */
  readonly queueWaitConsumedMs: number;
  readonly queueEnteredAtMs: number;
  readonly firstOutputTimeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly cancellation: { readonly id: string; readonly cancelled: boolean };
  readonly outputVisible: boolean;
  readonly maxPhysicalAttempts: number;
  readonly attempts: readonly AttemptRecord[];
  readonly evidenceRef: string;
}
export interface QuotaScope {
  readonly providerId: string;
  readonly kind: 'account' | 'organization' | 'project' | 'model';
  readonly id: string;
}
export interface QuotaDimension {
  readonly scope: QuotaScope;
  /** E.g. requests/day, input-tokens/minute, neurons/day. Never a credential/key ID. */
  readonly meter: string;
}
export interface ProviderProfile {
  readonly id: string;
  readonly version: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly adapterId: string;
  /** Reviewed preference, 0–1000 (lower first); only breaks equal operational/cost ranks. Omitted means 1000. */
  readonly reviewedPriority?: number;
  readonly status: 'approved' | 'disabled' | 'unknown';
  /** Hosted NVIDIA evaluation/trial and coding-plan products cannot claim production eligibility. */
  readonly serviceClass: 'production' | 'evaluation-only' | 'unknown';
  readonly product: 'inference-api' | 'coding-subscription' | 'unknown';
  readonly surfaces: readonly Surface[];
  readonly qualityApprovals: readonly QualityRequirement[];
  /** Server legal/compliance gates cover product license, user geography/audience and data terms. */
  readonly termsApprovals: readonly string[];
  readonly capabilities: readonly CapabilitySupport[];
  readonly privacy: {
    readonly dataClasses: readonly DataClass[];
    readonly training: 'none' | 'permitted' | 'unknown';
    readonly humanReview: 'none' | 'permitted' | 'unknown';
    readonly retentionHours: number | null;
    readonly processingRegions: readonly string[];
  };
  readonly credentialOwner: Payer;
  /** Multiple overlapping account/org/project/model dimensions must ALL be reserved. */
  readonly quotaDimensions: readonly QuotaDimension[];
  readonly charging: 'verified-free-no-overage' | 'metered' | 'unknown';
  /** Binds reviewed exact model, account tier, license/terms, geography/audience and privacy settings. */
  readonly evidenceRef: string;
}
export interface QuotaSnapshot {
  readonly requestBinding: string;
  readonly profileVersion: string;
  readonly profileBinding: string;
  readonly logicalRequestId: string;
  readonly profileId: string;
  readonly dimensions: readonly (QuotaDimension & { readonly required: number; readonly remaining: number })[];
  readonly evidenceRef: string;
}
export interface AvailabilitySnapshot {
  readonly requestBinding: string;
  readonly profileVersion: string;
  readonly profileBinding: string;
  readonly profileId: string;
  readonly coolingUntilMs: number;
  readonly predictedQueueMs: number;
  readonly predictedFirstOutputMs: number;
  readonly predictedCompletionMs: number;
  readonly evidenceRef: string;
}
export interface PriceQuote {
  readonly requestBinding: string;
  readonly profileBinding: string;
  readonly logicalRequestId: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly rateCardVersion: string;
  readonly currency: 'USD';
  readonly estimatedNanoUsd: number;
  /** Conservative total including all required token/audio/tool/search/session charges. */
  readonly ceilingNanoUsd: number;
  readonly coverage: 'all-request-usage';
  readonly capability: CapabilityRequest;
  readonly evidenceRef: string;
}
export interface BudgetAuthorization {
  readonly id: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly logicalRequestId: string;
  readonly payer: Payer;
  readonly surface: Surface;
  readonly allowedProfileIds: readonly string[];
  readonly budgetScopeId: string;
  readonly periodId: string;
  readonly periodStartsAtMs: number;
  readonly periodEndsAtMs: number;
  readonly maxAttemptNanoUsd: number;
  readonly remainingLogicalRequestNanoUsd: number;
  /** Shared across ALL paid rungs in this scope, not a per-provider allowance. */
  readonly remainingPeriodNanoUsd: number;
  readonly periodLimitNanoUsd: number;
  readonly evidenceRef: string;
}
export interface Candidate {
  readonly profile: ProviderProfile;
  readonly quota: QuotaSnapshot;
  readonly availability: AvailabilitySnapshot;
  /** Metered profiles only. Any quote on a free profile is contradictory and quarantined. */
  readonly price?: PriceQuote;
}
export type EvidenceKind = 'request' | 'profile' | 'quota' | 'availability' | 'price' | 'budget';
export interface EvidenceRecord {
  readonly kind: EvidenceKind;
  readonly binding: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly revoked: boolean;
}
/**
 * TRUST BOUNDARY: implemented only by trusted server services over authenticated,
 * immutable policy/account/rate/quota/identity records (or verified signatures).
 * The request must NEVER supply this resolver or its records. A string/brand or
 * matching JSON is NOT verification. This module has no production implementation.
 * Resolver lookup is read-only and deterministic for the supplied snapshot.
 */
export interface EvidenceAuthority { lookup(reference: string): EvidenceRecord | undefined; }
export interface PlanningInput {
  readonly nowMs: number;
  readonly request: RoutingRequest;
  readonly candidates: readonly Candidate[];
  readonly budget?: BudgetAuthorization;
  readonly authority: EvidenceAuthority;
}
export type RejectionReason = 'malformed' | 'evidence' | 'profile-ineligible' | 'surface'
  | 'capability' | 'quality' | 'privacy' | 'payer' | 'quota' | 'cooldown' | 'deadline'
  | 'strict-free' | 'price' | 'budget';
export interface CandidateRejection { readonly profileId: string; readonly reason: RejectionReason; }
export interface SelectionPlan {
  readonly kind: 'plan';
  readonly authorizedToDispatch: false;
  readonly logicalRequestId: string;
  readonly physicalAttemptId: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly adapterId: string;
  readonly capabilityKind: CapabilityRequest['kind'];
  readonly payer: Payer;
  readonly deadlineAtMs: number;
  readonly queueUntilMs: number;
  readonly firstOutputTimeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly cancellationId: string;
  readonly remainingPhysicalAttempts: number;
  readonly quotaReservations: readonly { readonly ledgerKey: string; readonly amount: number }[];
  readonly budgetReservation?: {
    readonly authorizationId: string; readonly budgetScopeId: string; readonly periodId: string;
    readonly payer: Payer; readonly amountNanoUsd: number; readonly rateCardVersion: string;
  };
  readonly mandatoryDispatchChecks: readonly string[];
  readonly rejected: readonly CandidateRejection[];
}
export type PlanningResult = SelectionPlan
  | { readonly kind: 'blocked'; readonly reason: RejectionReason | 'cancelled' | 'output-visible'
      | 'attempt-limit' | 'uncertain-outcome' | 'already-completed' | 'terminal-failure' | 'no-eligible-candidate';
      readonly rejected: readonly CandidateRejection[] }
  | { readonly kind: 'excluded'; readonly reason: 'image-pipeline-preserved' };
