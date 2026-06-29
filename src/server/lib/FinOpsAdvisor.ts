// P-MON.6 — FinOps Advisor: actionable cost recommendations from REAL metrics.
//
// A pure, dependency-free rules engine over the live MetricsSnapshot (per-provider spend +
// request counts, build outcomes, repair attempts). It produces concrete recommendations
// such as "X% of spend went to failed builds" or "provider Y costs N× more per request than
// the cheapest provider".
//
// HONESTY (a core NavBharatAI law): every number is derived from real recorded metrics —
// there are NO hardcoded prices and NO speculative projections. Savings figures are the
// amount ALREADY OBSERVED as wasted in the current window, not an invented monthly forecast.
// With no data (no builds, no spend) the engine returns no recommendations rather than
// fabricating advice.

export interface ProviderUsageLike {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface FinOpsSnapshot {
  tokens: Record<string, ProviderUsageLike>;
  totalCostUsd: number;
  builds: {
    total: number;
    succeeded: number;
    failed: number;
    previewAllowed: number;
    totalRepairAttempts: number;
    successRate: number;
    previewRate: number;
    avgMs: number;
  };
}

export type FinOpsSeverity = 'info' | 'warning' | 'critical';

export interface FinOpsRecommendation {
  id: string;
  severity: FinOpsSeverity;
  title: string;
  detail: string;
  /** USD already observed as wasted/avoidable in the current window (real, not projected). */
  observedWasteUsd: number | null;
}

export interface FinOpsReport {
  recommendations: FinOpsRecommendation[];
  summary: {
    totalCostUsd: number;
    builds: number;
    failedBuildRatePct: number;
    costPerBuildUsd: number | null;
    topProvider: { name: string; costUsd: number; sharePct: number } | null;
  };
}

export interface FinOpsThresholds {
  /** Min builds before build-based advice fires (avoid noise on tiny samples). */
  minBuilds: number;
  /** Failed-build rate (0–1) above which we flag wasted spend. */
  failedRate: number;
  /** Preview rate (0–1) below which we flag builds that never reached preview. */
  lowPreviewRate: number;
  /** Avg repair attempts per build above which we flag repair-loop cost. */
  repairsPerBuild: number;
  /** A provider's share of total spend (0–1) above which concentration is flagged. */
  providerShare: number;
  /** Cost-per-request multiple vs the cheapest provider above which we flag it. */
  costMultiple: number;
}

export const DEFAULT_FINOPS_THRESHOLDS: FinOpsThresholds = {
  minBuilds: 10,
  failedRate: 0.15,
  lowPreviewRate: 0.5,
  repairsPerBuild: 1.5,
  providerShare: 0.6,
  costMultiple: 3,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const pct = (n: number): number => Math.round(n * 1000) / 10; // 0–1 → 0–100 with 1 decimal

/** Cost per request for a provider, or null if it has no requests. */
export function costPerRequest(u: ProviderUsageLike): number | null {
  return u.requests > 0 ? u.costUsd / u.requests : null;
}

export function analyzeFinOps(snap: FinOpsSnapshot, thresholds: Partial<FinOpsThresholds> = {}): FinOpsReport {
  const t = { ...DEFAULT_FINOPS_THRESHOLDS, ...thresholds };
  const recommendations: FinOpsRecommendation[] = [];
  const b = snap.builds;
  const totalCost = snap.totalCostUsd || 0;

  // --- Provider summary (real shares) ---
  const providers = Object.entries(snap.tokens || {});
  let topProvider: FinOpsReport['summary']['topProvider'] = null;
  for (const [name, u] of providers) {
    const sharePct = totalCost > 0 ? (u.costUsd / totalCost) * 100 : 0;
    if (!topProvider || u.costUsd > topProvider.costUsd) {
      topProvider = { name, costUsd: round4(u.costUsd), sharePct: Math.round(sharePct * 10) / 10 };
    }
  }

  const failedRate = b.total > 0 ? b.failed / b.total : 0;

  // --- Rule 1: spend wasted on failed builds (real waste = cost × failed share) ---
  if (b.total >= t.minBuilds && failedRate >= t.failedRate) {
    const wasted = round4(totalCost * failedRate);
    recommendations.push({
      id: 'failed-build-spend',
      severity: failedRate >= 0.3 ? 'critical' : 'warning',
      title: `${pct(failedRate)}% of builds failed — spend on failed builds`,
      detail: `${b.failed} of ${b.total} builds failed. Roughly $${wasted} of the $${round4(totalCost)} `
        + `spent maps to failed builds. Improve verification/repair or pre-validation to recover it.`,
      observedWasteUsd: wasted,
    });
  }

  // --- Rule 2: low preview rate (builds that never reached a usable preview) ---
  if (b.total >= t.minBuilds && b.previewRate < t.lowPreviewRate) {
    const noPreview = b.total - b.previewAllowed;
    const wasted = totalCost > 0 ? round4(totalCost * (noPreview / b.total)) : null;
    recommendations.push({
      id: 'low-preview-rate',
      severity: 'warning',
      title: `Only ${pct(b.previewRate)}% of builds reached preview`,
      detail: `${noPreview} of ${b.total} builds never produced a previewable result. That AI spend `
        + `produced nothing usable — tighten the build/verify loop before charging tokens.`,
      observedWasteUsd: wasted,
    });
  }

  // --- Rule 3: heavy repair loops (extra token cost per build) ---
  const repairsPerBuild = b.total > 0 ? b.totalRepairAttempts / b.total : 0;
  if (b.total >= t.minBuilds && repairsPerBuild >= t.repairsPerBuild) {
    recommendations.push({
      id: 'high-repair-loops',
      severity: 'info',
      title: `${round2(repairsPerBuild)} repair attempts per build on average`,
      detail: `Repair loops re-call the model and add token cost. A high average suggests the first `
        + `generation is often wrong — improving prompts/templates cuts repeat spend.`,
      observedWasteUsd: null,
    });
  }

  // --- Rule 4: provider spend concentration ---
  if (topProvider && totalCost > 0 && topProvider.sharePct / 100 >= t.providerShare && providers.length > 1) {
    recommendations.push({
      id: 'provider-concentration',
      severity: 'info',
      title: `${topProvider.name} is ${topProvider.sharePct}% of all spend`,
      detail: `A single provider dominates cost ($${topProvider.costUsd}). Check the router's fallback `
        + `priority and per-task tiering so cheaper providers absorb suitable load.`,
      observedWasteUsd: null,
    });
  }

  // --- Rule 5: a provider costs far more per request than the cheapest (data-driven) ---
  const perReq = providers
    .map(([name, u]) => ({ name, cpr: costPerRequest(u), requests: u.requests, costUsd: u.costUsd }))
    .filter((p): p is { name: string; cpr: number; requests: number; costUsd: number } => p.cpr != null);
  if (perReq.length >= 2) {
    const cheapest = perReq.reduce((a, c) => (c.cpr < a.cpr ? c : a));
    for (const p of perReq) {
      if (cheapest.cpr > 0 && p.name !== cheapest.name && p.cpr >= cheapest.cpr * t.costMultiple && p.requests >= 5) {
        const multiple = Math.round((p.cpr / cheapest.cpr) * 10) / 10;
        recommendations.push({
          id: `expensive-provider-${p.name}`,
          severity: 'info',
          title: `${p.name} costs ${multiple}× more per request than ${cheapest.name}`,
          detail: `${p.name} averages $${round4(p.cpr)}/request vs ${cheapest.name} at $${round4(cheapest.cpr)}. `
            + `Where quality allows, routing more of ${p.name}'s ${p.requests} requests to ${cheapest.name} lowers cost.`,
          observedWasteUsd: null,
        });
      }
    }
  }

  return {
    recommendations,
    summary: {
      totalCostUsd: round4(totalCost),
      builds: b.total,
      failedBuildRatePct: Math.round(failedRate * 1000) / 10,
      costPerBuildUsd: b.total > 0 ? round4(totalCost / b.total) : null,
      topProvider,
    },
  };
}
