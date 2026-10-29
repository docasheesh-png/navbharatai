/** Admin-only wire contract. Provider output and prompts must never enter persisted logs. */
export type DiagnosticProvider = 'surplus' | 'cheaperinference';
export const DIAGNOSTIC_LIMITS = Object.freeze({ promptBytes: 2048, defaultOutputTokens: 256, deadlineMs: 30_000, concurrentRuns: 1 });
export type DiagnosticReason = 'diagnostics_disabled' | 'invalid_request' | 'config_missing' | 'authentication_rejected' | 'network_error'
  | 'timeout' | 'cancelled' | 'rate_limited' | 'provider_error' | 'malformed_response'
  | 'receipt_unavailable' | 'accounting_failed' | 'reservation_failed'
  | 'budget_evidence_unavailable' | 'completed';
export interface DiagnosticEvent {
  elapsedMs: number;
  stage: 'validation' | 'configuration' | 'reservation' | 'dispatch' | 'response' | 'accounting';
  reason: DiagnosticReason;
  httpStatus?: number;
}
/** Durations cover the diagnostic runner only, not browser/auth middleware latency.
 * The current adapters are non-streaming: their round trip includes response parsing. */
export interface DiagnosticTiming {
  slow: boolean;
  thresholdMs: 10000;
  admissionMs: number;
  dispatchStartedMs: number | null;
  responseCompletedMs: number | null;
  providerRoundTripMs: number | null;
  accountingMs: number | null;
  totalMs: number;
  queueMs: null;
  headersMs: null;
  parsingMs: null;
  retryAfterMs: number | null;
  httpStatus: number | null;
  fallbackCount: 0;
  /** Largest measured interval, not a claim about an upstream root cause. */
  largestMeasuredStage: 'admission' | 'provider_round_trip' | 'accounting' | 'unknown';
}
export interface DiagnosticResult {
  /** Absent on old/recovered runs; never present a new lookup as fresh measurements. */
  timing?: DiagnosticTiming;
  /** Present only after the durable run completion acknowledgement. */
  completedAt?: number;
  missingEvidence?: string[];
  reconciliationRequired?: boolean;
  runId: string;
  provider: DiagnosticProvider;
  model: string | null;
  startedAt: string;
  elapsedMs: number;
  /** Null means not measured, not zero. Whole-request latency is not generation time. */
  firstByteMs: number | null;
  firstTokenMs: number | null;
  outputTokensPerSecond: number | null;
  retryCount: 0;
  text: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null };
  supplierCost: { status: 'reported'; amount: string; currency: string } | { status: 'unavailable' };
  walletCharge: { status: 'not_charged' } | { status: 'unknown' };
  accounting: 'pending' | 'not_dispatched' | 'reserved' | 'settled' | 'unknown_liability';
  timeline: DiagnosticEvent[];
  /** Provider health alone never establishes production builder health. */
  provesBuilderHealth: false;
}
