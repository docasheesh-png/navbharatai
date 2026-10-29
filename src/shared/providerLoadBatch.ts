/** Admin-only batch metadata. No credentials, prompt text or response text. */
export interface LoadBatchAuthority {
  scopeId: string;
  model: string;
  totalAttempts: number;
  priorAttempts: number;
  priorCostNanoUsd: number;
  totalBudgetNanoUsd: number;
  maxAttemptNanoUsd: number;
  maxConcurrency: number;
  maxOutputTokens: number;
  expiresAt: number;
}
export interface LoadQuestion { id: string; prompt: string; expected: unknown }
export interface LoadBatch {
  version: 1; revision: number; scopeId: string; model: string; corpusHash: string; count: number; concurrency: number;
  authority: LoadBatchAuthority; next: number; active: number; completed: number;
  spentNanoUsd: number; heldNanoUsd: number; stopped: boolean; createdAt: number;
}
export interface LoadItem {
  ordinal: number; requestId: string; batchRevision: number; controlRevision: number; state: 'reserved' | 'dispatched' | 'completed' | 'unknown' | 'cancelled';
  reservedNanoUsd: number; actualNanoUsd: number | null; quality: 'pass' | 'fail' | 'not_evaluated';
  elapsedMs: number | null; responseReceived: boolean; reason: 'completed' | 'provider_failure' | 'accounting_unknown' | 'not_dispatched';
  provider: 'cheaperinference'; model: string; retryCount: 0; fallbackCount: 0;
  usage: { inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null };
}
