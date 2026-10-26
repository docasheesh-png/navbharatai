/** Metadata observations only. Nothing in this package grants paid inference authority. */
export type Dimension = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning';
export type Rates = Partial<Record<Dimension, string>>;
export interface Observation {
  model: string;
  offerId: string;
  providerId: string;
  available: boolean;
  healthy: boolean;
  trusted: boolean;
  providerTrustConfirmed: boolean;
  trustObservedAt: number | null;
  discountPct: number | null;
  rates: Rates;
  referenceRates: Rates;
  /** Unknown units remain unknown until independently reviewed; never guessed here. */
  unit: 'unverified';
  observedAt: number;
  /** Origin generation time, NOT HTTP Date. Unknown prevents selecting from stale cached offers. */
  upstreamGeneratedAt: number | null;
  sourceDate: number | null;
  sourceAgeSeconds: number | null;
  cacheMaxAgeSeconds: number | null;
  sourceUrl: string;
}
export interface Snapshot {
  version: string;
  startedAt: number;
  observedAt: number;
  expiresAt: number;
  models: string[];
  offers: Observation[];
  /** Read-time manual-block revision; polling never changes this authority boundary. */
  controlRevision?: number;
}
export interface SurplusModelControls {
  revision: number;
  disabledModels: string[];
  updatedAt: number | null;
  reason: string | null;
}
export interface SurplusManagerState {
  snapshot: Snapshot | null;
  controls: SurplusModelControls | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextAllowedAt: number | null;
  lastError: 'metadata_unavailable' | 'invalid_control_state' | null;
}
export interface Lease { token: string; expiresAt: number }
export interface QualityReview {
  offerId?: string;
  binding?: 'exact-offer' | 'model-provider';
  model: string;
  providerId: string;
  benchmarkId: string;
  artifactSha256: string;
  cohort: string;
  approved: boolean;
  reviewedAt: number;
  expiresAt: number;
}
export interface Reviews {
  quality: QualityReview[];
  /** MUST be reviewed outside polling; catalog refresh never creates or renews this. */
  pricingContract: { unit: 'micro-usd-per-million'; sourceUrl: string; reviewedAt: number; expiresAt: number } | null;
  accountAndPrivacyReviewedUntil: number;
}
export const NO_REVIEWS: Reviews = { quality: [], pricingContract: null, accountAndPrivacyReviewedUntil: 0 };
export interface Store {
  read(): Promise<Snapshot | null>;
  claim(now: number, intervalMs: number): Promise<Lease | null>;
  publish(lease: Lease, snapshot: Snapshot): Promise<void>;
  fail(lease: Lease): Promise<void>;
}
export interface Workload {
  input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number;
}
export type Plan = {
  canDispatch: false;
  status: 'blocked' | 'estimated_candidate';
  reason: string;
  snapshotVersion?: string;
  configuredUniverse?: string[];
  observationBasis?: 'origin-timestamp' | 'request-time-floor-required';
  selection?: { model: string; providerId: string; offerId: string; estimatedMicroUsd: string; qualityArtifact: string };
};

/** Where the manager derived coding-quality / floor evidence for display. */
export type SurplusQualitySource = 'none' | 'firestore' | 'live_synthesis';

/** Admin-only read contract. An observation or estimate never authorizes paid execution. */
export interface SurplusManagerModel {
  modelId: string;
  disabled: boolean;
  qualityReviewStatus: 'reviewed' | 'expired' | 'unreviewed';
  blockedReasons: string[];
  observations: Observation[];
  estimatedCandidate: Plan['selection'] | null;
}
export interface SurplusManagerView {
  status: 'disabled' | 'invalid_configuration' | 'unavailable' | 'empty' | 'observed' | 'stale';
  enabled: boolean;
  canDispatch: false;
  /** True when SURPLUS_API_KEY + AGENTV3_SURPLUS_BUILDER admit via in-process synthesis. */
  liveBuilderAdmission: boolean;
  /** Source of quality/floor evidence shown in this manager view. */
  qualitySource: SurplusQualitySource;
  configuredUniverse: string[];
  intervalMs: number;
  freshnessMs: number;
  maxModels: number;
  version: string | null;
  controlRevision: number | null;
  fetchedAt: number | null;
  expiresAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextAllowedAt: number | null;
  lastError: string | null;
  workload: Workload;
  models: SurplusManagerModel[];
  observedCandidates: Observation[];
  limitations: string[];
}

/** Safe admin-only projection; no server imports, credentials or raw provider text. */
export interface SurplusConnectionTestStatus {
  status: 'ready' | 'blocked_configuration' | 'blocked_budget_review' | 'unavailable' | 'unknown_liability_hold' | 'passed' | 'failed' | 'budget_exceeded';
  environmentConfigured: boolean;
  productionFlagsOff: boolean;
  latencyMs: number | null;
  /** Provider-reported exact canonical USD, not an invoice, wallet charge, or cost estimate. */
  actualCostUsd: string | null;
  expectedResponse: 'not_checked' | 'matched' | 'mismatched';
}
