// P-BRE.11 — AI Build Optimizer.
//
// A pure, dependency-free engine that turns REAL build telemetry (the aggregated BuildAnalytics over the
// job store) into prioritized, actionable optimization suggestions — "80% of your failures share one
// signature", "p95 build time is 3× the average", "average build is slow". Deterministic (rules over
// real recorded metrics), which is more trustworthy for an operator than an LLM guess and needs no model
// call; the FinOps/AiInsights modules follow the same honest pattern.
//
// HONESTY: every suggestion is derived from real numbers. With too few builds (below `minBuilds`) it
// returns NOTHING rather than over-fitting a tiny sample — matching the roadmap's "after 10+ builds".

import type { BuildAnalytics } from './jobs/BuildAnalytics';

export type OptimizationSeverity = 'critical' | 'warning' | 'info';

export interface BuildOptimization {
  id: string;
  severity: OptimizationSeverity;
  title: string;
  detail: string;
}

export interface BuildOptimizerThresholds {
  /** Min terminal builds before any suggestion fires (avoid noise on tiny samples). */
  minBuilds: number;
  /** Failure rate at/above which a "reduce failures" suggestion fires. */
  highFailureRate: number;
  /** Share of failures a single signature must reach to be called "dominant". */
  dominantFailureShare: number;
  /** Average build ms at/above which "builds are slow" fires. */
  slowAvgMs: number;
  /** p95 ÷ avg ratio at/above which "some builds are much slower" fires. */
  tailRatio: number;
}

export const DEFAULT_OPTIMIZER_THRESHOLDS: BuildOptimizerThresholds = {
  minBuilds: 10,
  highFailureRate: 0.2,
  dominantFailureShare: 0.4,
  slowAvgMs: 180_000,
  tailRatio: 2.5,
};

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/**
 * Derive prioritized build optimizations from aggregated build analytics. Deterministic + pure.
 * Ordered critical → warning → info.
 */
export function analyzeBuildOptimizations(
  a: BuildAnalytics,
  thresholds: BuildOptimizerThresholds = DEFAULT_OPTIMIZER_THRESHOLDS,
): BuildOptimization[] {
  const out: BuildOptimization[] = [];
  if (!a || a.terminalJobs < thresholds.minBuilds) return out; // too little data to advise honestly

  const totalFailures = Math.round(a.failureRate * a.terminalJobs);

  // High overall failure rate.
  if (a.failureRate >= thresholds.highFailureRate) {
    out.push({
      id: 'high-failure-rate',
      severity: a.failureRate >= 0.5 ? 'critical' : 'warning',
      title: `${pct(a.failureRate)} of builds are failing`,
      detail: `${totalFailures} of ${a.terminalJobs} recent builds failed. Investigate the top failure types below and tighten the generation/repair path for that class.`,
    });
  }

  // A single failure signature dominates → systemic, high-leverage fix.
  if (totalFailures > 0 && a.topFailureTypes.length > 0) {
    const top = a.topFailureTypes[0];
    const share = top.count / totalFailures;
    if (share >= thresholds.dominantFailureShare) {
      out.push({
        id: 'dominant-failure',
        severity: 'warning',
        title: `${pct(share)} of failures share one cause`,
        detail: `${top.count} of ${totalFailures} failures match "${top.type}". Fixing this single class removes the majority of failures — highest-leverage change.`,
      });
    }
  }

  // Slow average build.
  if (a.avgDurationMs >= thresholds.slowAvgMs) {
    out.push({
      id: 'slow-average',
      severity: 'info',
      title: `Average build takes ${secs(a.avgDurationMs)}`,
      detail: `Builds are slow on average. Consider caching dependencies, trimming the scaffold, or splitting long generation stages.`,
    });
  }

  // Long tail — p95 much slower than the mean.
  if (a.avgDurationMs > 0 && a.p95DurationMs >= a.avgDurationMs * thresholds.tailRatio) {
    const ratio = a.p95DurationMs / a.avgDurationMs;
    out.push({
      id: 'slow-tail',
      severity: 'info',
      title: `Slowest builds are ${ratio.toFixed(1)}× the average`,
      detail: `p95 build time is ${secs(a.p95DurationMs)} vs a ${secs(a.avgDurationMs)} average — a subset of builds is much slower. Look at what those builds have in common (size, retries, a specific stage).`,
    });
  }

  const rank: Record<OptimizationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
