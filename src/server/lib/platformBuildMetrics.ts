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
import type { ProviderModelEntry } from '../AgentV3/ProviderUsageLedger';

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
  /**
   * The SAME model-attributed ledger entries the bill is priced from — which rung actually ran, not
   * just which vendor.
   *
   * 🔴 ROOT CAUSE (deep re-autopsy of build 9cca1fd5, 2026-09-17). This module's own comment below
   * promises the admin's cost graph and the admin's bill "can never tell two different stories about
   * one build". They told different stories on every build, because the graph was priced from
   * `providerUsage` — a per-PROVIDER token blob with no model in it — through `realRateFor(provider)`
   * with the model argument omitted.
   *
   * `realRateFor`'s provider-only fallback is deliberately the most expensive rate in the family, and
   * it says so: *"an unrecognized model can only ever over-state cost, never under-state it."* That is
   * exactly right as a BILLING safeguard and exactly wrong as a MEASUREMENT. A build that really ran
   * `glm-4.7-flashx` ($0.07 in / $0.40 out) was recorded on the admin panel at the GLM 4.x coder line
   * ($0.60 / $2.20) — **8.6× on input, 5.5× on output** — on the one screen used to decide whether
   * engine spend is acceptable.
   *
   * ⚠️ THE ERROR RAN THE SAFE WAY: it OVER-stated our own cost, so nobody was under-charged and no
   * user was affected. It is the same shape as the `E2B_USD_PER_HOUR` incident `CLAUDE.md` records at
   * length — a wrong number on the admin's own cost panel, margin-safe and still wrong.
   *
   * Optional: absent ⇒ the old provider-only pricing, byte-identical to before.
   */
  providerEntries?: ReadonlyArray<ProviderModelEntry>;
  /**
   * Real E2B VM seconds this build held — OUR infrastructure cost, not the user's bill. It is measured
   * whether or not sandbox billing is switched on, because NavBharatAI pays for the VM either way and
   * the admin's cost view is the thing that answers "why is the E2B bill this size?".
   */
  sandboxSeconds?: number;
}


/**
 * Price a build's per-provider token totals, using the exact MODEL that ran wherever it is known.
 *
 * The two inputs answer two different questions and both are needed:
 *   • `providerUsage` — the per-provider totals, already RECONCILED against the billing sink. This is
 *     the authority on HOW MANY tokens a provider used, and it includes spend the per-call ledger
 *     could not attribute to a specific rung (plan/judge aux calls).
 *   • `entries` — the per-call ledger, which knows WHICH MODEL ran but does not see the unattributed
 *     remainder.
 *
 * So: every attributed entry is priced at its own model's real rate, and whatever tokens the
 * reconciled total has BEYOND what the entries account for are priced at the provider fallback —
 * exactly as before, and deliberately, because that fallback is the family's most expensive rate and
 * an unattributed call is one we genuinely cannot price. Exact where we know, conservative where we
 * do not. That is the same split `realProviderCostUsd` already makes with its `remainder` argument.
 *
 * 🔴 CACHE-HIT INPUT IS ATTRIBUTED — and the first draft of this module said it could not be, which
 * was simply wrong. I wrote that `cacheReadInputTokens` "exists only as a BUILD-level total, no
 * per-call or per-provider breakdown is recorded anywhere". It is recorded per (provider, model):
 * `captureTurnUsage` passes it into `providerLedger.add`, `ProviderTokens` has carried the field
 * since Fix 66, and `realProviderCostUsd` hands `e.usage` straight to `usageCostUsd` — so the BILL
 * has always priced the cached share at the provider's far cheaper cache-read rate.
 *
 * ⚠️ WHAT ACTUALLY HID IT WAS A TYPE. `BillingLedgerView.entries()` declared the usage as a
 * hand-written `{inputTokens, outputTokens}`, narrower than the objects it really returns, so every
 * reader typed against that view saw `cacheReadInputTokens: undefined` and priced the cached share at
 * the FULL input rate. A structural type narrower than its value loses data with no error anywhere.
 * That interface now names the ledger's own `ProviderModelEntry`, so it cannot drift again.
 *
 * PURE. Never throws; a malformed entry is skipped rather than allowed to poison a total.
 */
export function priceProviderUsage(
  providerUsage: Record<string, { inputTokens: number; outputTokens: number }> | null | undefined,
  entries?: ReadonlyArray<ProviderModelEntry> | null,
): Array<{ provider: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  // What the per-call ledger attributes to each provider, and what that costs at the real model rates.
  const attributed = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const e of entries ?? []) {
    const provider = typeof e?.provider === 'string' ? e.provider : '';
    if (!provider) continue;
    const inputTokens = Math.max(0, Math.round(Number(e?.usage?.inputTokens) || 0));
    const outputTokens = Math.max(0, Math.round(Number(e?.usage?.outputTokens) || 0));
    if (inputTokens === 0 && outputTokens === 0) continue;
    // The cached share of THIS entry's input, priced at the provider's far cheaper cache-read rate —
    // exactly as `realProviderCostUsd` has always priced the BILL. Clamped to the entry's own input,
    // because a provider can never cache-serve more than it received.
    const cacheReadInputTokens = Math.min(
      inputTokens,
      Math.max(0, Math.round(Number(e?.usage?.cacheReadInputTokens) || 0)),
    );
    const at = attributed.get(provider) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    at.inputTokens += inputTokens;
    at.outputTokens += outputTokens;
    at.costUsd += usageCostUsd({ inputTokens, outputTokens, cacheReadInputTokens }, realRateFor(provider, e?.model));
    attributed.set(provider, at);
  }

  const out: Array<{ provider: string; inputTokens: number; outputTokens: number; costUsd: number }> = [];
  for (const [provider, usage] of Object.entries(providerUsage || {})) {
    const inputTokens = Math.max(0, Math.round(Number(usage?.inputTokens) || 0));
    const outputTokens = Math.max(0, Math.round(Number(usage?.outputTokens) || 0));
    if (inputTokens === 0 && outputTokens === 0) continue;
    const at = attributed.get(provider);
    // 🔒 The reconciled total is the authority on TOKENS, so a ledger that somehow claims MORE than
    // the reconciled total is clamped rather than trusted — otherwise a double-counted call would
    // make the panel read high, which is the very failure being fixed.
    const knownIn = Math.min(inputTokens, at?.inputTokens ?? 0);
    const knownOut = Math.min(outputTokens, at?.outputTokens ?? 0);
    const remainder = { inputTokens: inputTokens - knownIn, outputTokens: outputTokens - knownOut };
    const knownCost = at && (knownIn === at.inputTokens && knownOut === at.outputTokens)
      ? at.costUsd
      // Clamped: price the share we kept at the ledger's own average, never the full ledger cost.
      : at && at.inputTokens + at.outputTokens > 0
        ? at.costUsd * ((knownIn + knownOut) / (at.inputTokens + at.outputTokens))
        : 0;
    const remainderCost = remainder.inputTokens === 0 && remainder.outputTokens === 0
      ? 0
      : usageCostUsd(remainder, realRateFor(provider));
    out.push({ provider, inputTokens, outputTokens, costUsd: knownCost + remainderCost });
  }
  return out;
}

/**
 * Record a finished build into the platform metrics registry (which in turn feeds the Monitor
 * timeline through the registered sink). NEVER throws — an absolute rule: telemetry must not be able
 * to fail a build that already succeeded.
 */
export function recordPlatformBuild(rec: PlatformBuildRecord): void {
  try {
    const metrics = getMetrics();
    for (const row of priceProviderUsage(rec.providerUsage, rec.providerEntries)) {
      metrics.recordModelCall(row.provider, row.inputTokens, row.outputTokens, row.costUsd);
    }
    metrics.recordBuild({
      ok: rec.ok,
      previewAllowed: rec.previewAllowed,
      isEdit: rec.isEdit,
      ms: Math.max(0, Math.round(rec.ms || 0)),
      sandboxSeconds: Math.max(0, Math.round(rec.sandboxSeconds || 0)),
    });
  } catch { /* telemetry never breaks a build */ }
}
