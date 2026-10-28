/** Admin-only wire contract. Provider output and prompts must never enter persisted logs. */
export type DiagnosticProvider = 'surplus' | 'cheaperinference';
export const DIAGNOSTIC_LIMITS = Object.freeze({ promptBytes: 2048, outputTokens: 256, deadlineMs: 30_000, concurrentRuns: 1 });
export type DiagnosticReason = 'config_missing' | 'authentication_rejected' | 'network_error'
  | 'timeout' | 'rate_limited' | 'provider_error' | 'malformed_response'
  | 'receipt_unavailable' | 'accounting_failed' | 'reservation_failed'
  | 'budget_evidence_unavailable' | 'completed';
export interface DiagnosticEvent {
  elapsedMs: number;
  stage: 'validation' | 'configuration' | 'reservation' | 'dispatch' | 'response' | 'accounting';
  reason: DiagnosticReason;
  httpStatus?: number;
}
export interface DiagnosticResult {
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
  accounting: 'not_dispatched' | 'reserved' | 'settled' | 'unknown_liability';
  timeline: DiagnosticEvent[];
  /** Provider health alone never establishes production builder health. */
  provesBuilderHealth: false;
}
