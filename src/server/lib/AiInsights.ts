// P-MON.5 — AI Insights / NL Query / Ops Report Generator.
//
// A pure, dependency-free engine that turns the live MetricsSnapshot into readable insights, a
// periodic ops-report summary, and answers to common natural-language telemetry questions.
//
// HONESTY (a core NavBharatAI law): every sentence is DERIVED from real recorded metrics — no
// numbers are invented and nothing is projected. The insights are deterministic (rules over real
// data), so an admin gets trustworthy, reproducible observations rather than a model's guess. With
// no telemetry the engine says so plainly instead of fabricating an insight. The NL query is a
// recognized-intent resolver over the real snapshot (cost / success / speed / providers / preview /
// volume); an unrecognized question returns an honest "I can answer about …" reply rather than a
// hallucinated one.

import type { MetricsSnapshot } from './metrics';

export type InsightSeverity = 'good' | 'info' | 'warning' | 'critical';

export interface Insight {
  id: string;
  severity: InsightSeverity;
  headline: string;
  detail: string;
}

export interface InsightThresholds {
  /** Min builds before build-quality insights fire (avoid noise on tiny samples). */
  minBuilds: number;
}

export const DEFAULT_INSIGHT_THRESHOLDS: InsightThresholds = { minBuilds: 5 };

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const usd = (x: number): string => `$${x.toFixed(x < 0.01 ? 5 : 2)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** Per-request cost for a provider (null if it has no requests). */
function costPerRequest(u: { requests: number; costUsd: number }): number | null {
  return u.requests > 0 ? u.costUsd / u.requests : null;
}

/** True when the snapshot carries no recorded telemetry at all. */
export function hasNoTelemetry(snap: MetricsSnapshot): boolean {
  return snap.builds.total === 0 && Object.keys(snap.tokens).length === 0;
}

/**
 * Derive readable insights from the real metrics snapshot. Deterministic + pure.
 * Ordered most-actionable first (critical → warning → good/info).
 */
export function generateInsights(
  snap: MetricsSnapshot,
  thresholds: InsightThresholds = DEFAULT_INSIGHT_THRESHOLDS,
): Insight[] {
  if (hasNoTelemetry(snap)) {
    return [{
      id: 'no-data',
      severity: 'info',
      headline: 'No telemetry recorded yet',
      detail: 'No builds or model calls have been recorded in this window, so there is nothing to analyse yet.',
    }];
  }

  const out: Insight[] = [];
  const b = snap.builds;

  // ── Build quality (needs a minimum sample) ──
  if (b.total >= thresholds.minBuilds) {
    const failRate = b.total ? b.failed / b.total : 0;
    out.push({
      id: 'success-rate',
      severity: b.successRate >= 0.9 ? 'good' : b.successRate >= 0.7 ? 'warning' : 'critical',
      headline: `Build success rate is ${pct(b.successRate)}`,
      detail: `${b.succeeded} of ${b.total} builds passed verification` +
        (failRate > 0 ? `; ${b.failed} failed (${pct(failRate)}).` : '.'),
    });

    out.push({
      id: 'preview-rate',
      severity: b.previewRate >= 0.9 ? 'good' : b.previewRate >= 0.7 ? 'info' : 'warning',
      headline: `${pct(b.previewRate)} of builds reached a preview`,
      detail: `${b.previewAllowed} of ${b.total} builds produced a usable preview.`,
    });

    if (b.avgMs > 0) {
      out.push({
        id: 'avg-duration',
        severity: b.avgMs <= 120_000 ? 'good' : b.avgMs <= 300_000 ? 'info' : 'warning',
        headline: `Average build takes ${secs(b.avgMs)}`,
        detail: `Mean wall-clock across ${b.total} builds is ${secs(b.avgMs)}.`,
      });
    }

    if (b.total > 0) {
      const avgRepairs = b.totalRepairAttempts / b.total;
      if (avgRepairs >= 1) {
        out.push({
          id: 'repair-burden',
          severity: avgRepairs >= 3 ? 'critical' : avgRepairs >= 2 ? 'warning' : 'info',
          headline: `Builds need ${avgRepairs.toFixed(1)} repair attempts on average`,
          detail: `${b.totalRepairAttempts} repair attempts across ${b.total} builds — high values point at generation quality or flaky verification.`,
        });
      }
    }
  }

  // ── Cost / providers ──
  const providers = Object.entries(snap.tokens).filter(([, u]) => u.requests > 0);
  if (snap.totalCostUsd > 0 && providers.length > 0) {
    const sorted = [...providers].sort((a, b) => b[1].costUsd - a[1].costUsd);
    const [topName, topUsage] = sorted[0];
    const share = snap.totalCostUsd > 0 ? topUsage.costUsd / snap.totalCostUsd : 0;
    out.push({
      id: 'top-spend',
      severity: share >= 0.75 && providers.length > 1 ? 'warning' : 'info',
      headline: `${topName} is ${pct(share)} of spend`,
      detail: `Total recorded spend is ${usd(snap.totalCostUsd)}; ${topName} accounts for ${usd(topUsage.costUsd)}.`,
    });

    // Cheapest vs priciest per-request (only meaningful with ≥2 active providers).
    if (providers.length >= 2) {
      const withCpr = providers
        .map(([name, u]) => ({ name, cpr: costPerRequest(u)! }))
        .sort((a, b) => a.cpr - b.cpr);
      const cheapest = withCpr[0];
      const priciest = withCpr[withCpr.length - 1];
      if (cheapest.cpr > 0 && priciest.cpr > cheapest.cpr) {
        const ratio = priciest.cpr / cheapest.cpr;
        out.push({
          id: 'provider-cost-spread',
          severity: ratio >= 5 ? 'warning' : 'info',
          headline: `${priciest.name} costs ${ratio.toFixed(1)}× more per request than ${cheapest.name}`,
          detail: `${priciest.name}: ${usd(priciest.cpr)}/req vs ${cheapest.name}: ${usd(cheapest.cpr)}/req — shifting eligible traffic to the cheaper tier lowers spend.`,
        });
      }
    }
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Generate a periodic ops-report summary (plain text) from the real snapshot. Pure. */
export function generateOpsReport(snap: MetricsSnapshot, periodLabel = 'current window'): string {
  const insights = generateInsights(snap);
  const b = snap.builds;
  const lines: string[] = [];
  lines.push(`NavBharatAI Ops Report — ${periodLabel}`);
  lines.push(`Metrics since: ${snap.since}`);
  lines.push('');
  lines.push(`Builds: ${b.total} total · ${b.succeeded} passed · ${b.failed} failed · success ${pct(b.successRate)}`);
  lines.push(`Preview reached: ${pct(b.previewRate)} · avg build ${secs(b.avgMs)}`);
  lines.push(`Spend: ${usd(snap.totalCostUsd)} across ${Object.keys(snap.tokens).length} provider(s)`);
  lines.push('');
  lines.push('Insights:');
  if (insights.length === 0) {
    lines.push('- Nothing notable in this window.');
  } else {
    for (const i of insights) lines.push(`- [${i.severity.toUpperCase()}] ${i.headline} — ${i.detail}`);
  }
  return lines.join('\n');
}

export interface QueryAnswer {
  matched: boolean;
  answer: string;
}

/**
 * Answer a common natural-language telemetry question deterministically from the real snapshot.
 * Recognized-intent based (cost / success / speed / providers / preview / volume) — an unrecognized
 * question returns matched:false with an honest list of what CAN be answered (no hallucination).
 */
export function answerMetricQuery(snap: MetricsSnapshot, question: string): QueryAnswer {
  const q = (question || '').toLowerCase();
  const b = snap.builds;

  if (hasNoTelemetry(snap)) {
    return { matched: true, answer: 'No telemetry has been recorded yet, so there is nothing to report for this window.' };
  }

  if (/\b(cost|spend|spent|expense|expensive|kharch|paisa|bill|budget)\b/.test(q)) {
    const providers = Object.entries(snap.tokens).filter(([, u]) => u.requests > 0)
      .sort((a, b) => b[1].costUsd - a[1].costUsd);
    const top = providers[0];
    return {
      matched: true,
      answer: `Total recorded spend is ${usd(snap.totalCostUsd)}` +
        (top ? `; the biggest contributor is ${top[0]} at ${usd(top[1].costUsd)}.` : '.'),
    };
  }

  if (/\b(success|pass|passed|fail|failed|failure|reliab)\b/.test(q)) {
    return {
      matched: true,
      answer: `Build success rate is ${pct(b.successRate)} — ${b.succeeded} of ${b.total} builds passed, ${b.failed} failed.`,
    };
  }

  if (/\b(slow|fast|speed|duration|time|long|quick)\b/.test(q)) {
    return {
      matched: true,
      answer: `The average build takes ${secs(b.avgMs)} across ${b.total} builds.`,
    };
  }

  if (/\b(preview)\b/.test(q)) {
    return {
      matched: true,
      answer: `${pct(b.previewRate)} of builds reached a usable preview (${b.previewAllowed} of ${b.total}).`,
    };
  }

  if (/\b(provider|providers|model|models|cheap|cheapest|tier|route|routing)\b/.test(q)) {
    const providers = Object.entries(snap.tokens).filter(([, u]) => u.requests > 0);
    if (providers.length === 0) return { matched: true, answer: 'No provider calls have been recorded yet.' };
    const byCost = [...providers].sort((a, b) => b[1].costUsd - a[1].costUsd);
    const byCpr = providers.map(([n, u]) => ({ n, cpr: costPerRequest(u)! })).sort((a, b) => a.cpr - b.cpr);
    return {
      matched: true,
      answer: `${providers.length} active provider(s). Highest spend: ${byCost[0][0]} (${usd(byCost[0][1].costUsd)}). ` +
        `Cheapest per request: ${byCpr[0].n} (${usd(byCpr[0].cpr)}/req).`,
    };
  }

  if (/\b(build|builds|how many|volume|count|total)\b/.test(q)) {
    return {
      matched: true,
      answer: `${b.total} builds recorded — ${b.succeeded} passed, ${b.failed} failed, ${b.previewAllowed} reached preview.`,
    };
  }

  return {
    matched: false,
    answer: 'I can answer questions about cost/spend, build success & failure rate, build speed/duration, ' +
      'provider usage & per-request cost, preview rate, and build volume. Try asking about one of those.',
  };
}
