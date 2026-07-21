// AgentV3 — build cost-alert advisory (Cap-4, admin-only).
//
// A small, ADDITIVE observability signal: when a single build's charge crosses an admin-set threshold,
// the build-diagnostics report (admin-only) carries a "⚠️ COST ALERT" line. It NEVER changes what a user
// is billed — it only surfaces the already-decided amount louder so an unusually expensive build is
// noticed. Env-gated and OFF by default, so a build's report is byte-identical to today unless the admin
// sets the threshold.
//
// HONEST BOUNDARY (rule 6): the signal is the CHARGED amount (`billedUsd`), which is what the report
// already records. For paid builds this is monotonic with real provider spend, so a runaway-cost build
// trips it. A FREE build (billedUsd 0) never trips it — but a free build runs only on the cheap weak-tier
// engines (Claude excluded by construction), so it is not a runaway-cost risk in the first place. Pure +
// deterministic (the decision) so it is unit-testable independently of the report renderer.

/** The admin-set per-build cost-alert threshold in USD, from `AGENTV3_COST_ALERT_USD`. 0 (or unset /
 *  non-positive / unparseable) means the alert is OFF — no report ever changes. */
export function costAlertThresholdUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENTV3_COST_ALERT_USD;
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The cost-alert advisory line for a build's report, or null when it should not fire. Fires only when the
 * threshold is enabled (> 0) AND the charged amount reaches it. Pure — the caller passes the threshold
 * (from `costAlertThresholdUsd()`) so the decision is testable without env.
 */
export function costAlertAdvisory(billedUsd: number | undefined, thresholdUsd: number): string | null {
  if (!(thresholdUsd > 0)) return null;                 // alert disabled
  if (typeof billedUsd !== 'number' || !Number.isFinite(billedUsd)) return null;
  if (billedUsd < thresholdUsd) return null;            // under the threshold — no alert
  return `⚠️ COST ALERT: this build charged $${billedUsd.toFixed(4)}, crossing the $${thresholdUsd.toFixed(2)} alert threshold (AGENTV3_COST_ALERT_USD). Review the token usage / tier above.`;
}
