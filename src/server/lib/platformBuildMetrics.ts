/**
 * PLATFORM BUILD METRICS — the one call that puts a finished NavBharatAI Pro build into the admin's
 * platform telemetry.
 *
 * ROOT CAUSE THIS CLOSES (found 2026-08-23). The shared metrics registry (`metrics.ts`) is what feeds
 * the admin panel's Platform Health Score, AI Insights, FinOps recommendations, `/api/admin/metrics`
 * and the daily `metrics_snapshots` history. Every one of those was fed from ONE place:
 * `routes/build.ts`, the LEGACY Engineer-AI builder. The main engine — AgentV3 / NavBharatAI Pro,
 * where essentially all real user builds happen — recorded nothing into it at all.
 *
 * So the panels were not wrong about their inputs; they were blind to the platform's actual
 * workload, while presenting themselves as "platform health". That is the reporting-honesty failure
 * the fourth absolute rule's step 5 names: fixing the numbers is not enough unless the system stops
 * claiming to measure something it never saw.
 *
 * WHY A SHARED HELPER AND NOT INLINE CODE. AgentV3 settles a build in TWO places — the normal settle
 * and the watchdog/advisory finalizer — and the two have drifted before (Fix 67 was exactly that bug
 * for billing). One helper, called from both, is what stops the same drift happening to telemetry.
 */
import { getMetrics } from './metrics';
import { realRateFor, usageCostUsd } from '../AgentV3/providerRates';

export interface PlatformBuildRecord {
  ok: boolean;
  /** Did the platform's own eyes see the app render? Distinct from `ok`. */
  previewAllowed: boolean;
  isEdit: boolean;
  ms: number;
  /**
   * Per-provider token totals for the whole build, already reconciled against the billing sink.
   *
   * NOTE ON `requests`: this is a per-build, per-provider AGGREGATE, so it produces one recorded
   * model-call entry per provider per build — not the true number of individual API calls. Token and
   * cost totals are exact; a per-call count is not available here and is deliberately not invented.
   * The real per-call counts live in `/api/admin/llm-latency`, which reads the trace spans.
   */
  providerUsage: Record<string, { inputTokens: number; outputTokens: number }>;
}

/**
 * Record a finished build into the platform metrics registry (which in turn feeds the Monitor
 * timeline through the registered sink). NEVER throws — an absolute rule: telemetry must not be able
 * to fail a build that already succeeded.
 */
export function recordPlatformBuild(rec: PlatformBuildRecord): void {
  try {
    const metrics = getMetrics();
    for (const [provider, usage] of Object.entries(rec.providerUsage || {})) {
      const inputTokens = Math.max(0, Math.round(usage?.inputTokens || 0));
      const outputTokens = Math.max(0, Math.round(usage?.outputTokens || 0));
      if (inputTokens === 0 && outputTokens === 0) continue;
      // Price it with the SAME live rate card the real-cost billing uses, so the admin's cost graph
      // and the admin's bill can never tell two different stories about one build.
      const realUsd = usageCostUsd({ inputTokens, outputTokens }, realRateFor(provider));
      metrics.recordModelCall(provider, inputTokens, outputTokens, realUsd);
    }
    metrics.recordBuild({
      ok: rec.ok,
      previewAllowed: rec.previewAllowed,
      isEdit: rec.isEdit,
      ms: Math.max(0, Math.round(rec.ms || 0)),
    });
  } catch { /* telemetry never breaks a build */ }
}
