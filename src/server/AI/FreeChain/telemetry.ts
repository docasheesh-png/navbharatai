import type { ProviderId } from './config';
/** entered means a logical adapter/registry rung was attempted, not proof of an HTTP dispatch. */
export interface FreeChainAttempt { provider: ProviderId; reason: string; model: string; entered: boolean }
export interface FreeChainTelemetry {
  requestId: string; rung: ProviderId | null; provider: string; model: string;
  attempts: FreeChainAttempt[]; fallbacks: number; cacheHit: boolean;
  admissionReason?: 'capacity' | 'queue-full' | 'timeout' | 'aborted' | 'user-limit'; queueWaitMs?: number;
  costUsdEstimate: number | null; ttftMs: number | null; latencyMs: number; rolloutBucket: number;
  /** Master-plan router decision and provider-reported prompt-cache hits (counts only). */
  route?: 'fast' | 'quality' | 'normal'; routeReason?: string; cachedInputTokens?: number;
}
/** Fixed-field logs only. Never include prompts, keys, SDK objects, URLs, headers or raw errors. */
export function logFreeChain(value: FreeChainTelemetry): void {
  console.info('[FREE_CHAT_CHAIN]', JSON.stringify(value));
}
