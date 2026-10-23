import { FREE_CHAIN_PROVIDER_IDS, type FreeChainAdminMetrics, type FreeChainAdminView } from '../src/lib/freeChatChainView';
export function freeChainViewFixture(over: Partial<FreeChainAdminView> = {}): FreeChainAdminView {
  return {
    enabled: false, runtimeEnabled: true, rolloutPercent: 0, allowListConfigured: false, order: [...FREE_CHAIN_PROVIDER_IDS],
    providers: FREE_CHAIN_PROVIDER_IDS.map(id => ({ id, model: `${id}-fixture-model`, configured: false, disabled: false,
      usage: { requestsDay: null }, limits: { requestsDay: null }, nextResetAt: null })),
    paid: { policyState: 'initialized', capUsd: 0, configuredCapUsd: 10, policyRevision: 1, reservedUsd: null, reportedUsd: null },
    limitations: ['Account-level remaining quota is not verified.'], ...over,
  };
}

export function freeChainMetricsFixture(over: Partial<FreeChainAdminMetrics> = {}): FreeChainAdminMetrics {
  return { observedAt: 1500, scanLimit: 4096, windowHours: 24, sampleCount: 0, complete: false,
    shareByProvider: {}, fallbackRate: null, p50Ms: null, p95Ms: null, cacheHitRate: null, ...over };
}
