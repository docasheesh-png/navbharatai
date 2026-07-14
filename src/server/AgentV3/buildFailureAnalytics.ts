// T1-admin-dashboard — build-failure analytics over the daily cost-telemetry aggregates.
//
// The admin dashboard already rolls up COST per day (AgentV3CostTelemetry), but the failure half of
// "build/cost/failure" was never surfaced: each day's doc records totalBuilds + okBuilds, yet nothing
// computed the daily failure RATE or flagged a failure-rate SPIKE. This is that pure rollup + a z-score
// spike detector (reusing AnomalyDetector), so an admin can see reliability at a glance and catch a bad day.
//
// PURE — folds the already-persisted daily docs, no I/O. Unit-tested.

import type { DailyCostTelemetryDoc } from './AgentV3CostTelemetry';
import { detectZAnomalies, mean } from '../lib/AnomalyDetector';

export interface DailyFailure {
  date: string;
  totalBuilds: number;
  failedBuilds: number;
  /** failedBuilds / totalBuilds (0 when there were no builds that day). */
  failureRate: number;
}

export interface BuildFailureReport {
  daily: DailyFailure[];
  overall: { totalBuilds: number; failedBuilds: number; failureRate: number };
  /** Dates whose failure rate is a statistical spike ABOVE the norm (a bad day worth investigating). */
  spikeDates: string[];
}

type DailyInput = Pick<DailyCostTelemetryDoc, 'date' | 'totalBuilds' | 'okBuilds'>;

/**
 * Roll the daily cost-telemetry docs into a build-failure report: per-day failure rate, the overall rate,
 * and the dates whose failure rate is an upward statistical spike. Deterministic; never throws.
 */
export function summarizeBuildFailures(days: ReadonlyArray<DailyInput> | null | undefined): BuildFailureReport {
  const daily: DailyFailure[] = [];
  let totalBuilds = 0;
  let failedBuilds = 0;
  for (const d of days || []) {
    if (!d || typeof d.date !== 'string') continue;
    const total = Math.max(0, Math.floor(d.totalBuilds || 0));
    const ok = Math.max(0, Math.min(total, Math.floor(d.okBuilds || 0)));
    const failed = total - ok;
    totalBuilds += total;
    failedBuilds += failed;
    daily.push({ date: d.date, totalBuilds: total, failedBuilds: failed, failureRate: total > 0 ? failed / total : 0 });
  }
  daily.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Spike = a day whose failure rate is a z-anomaly AND above the average (a genuinely bad day, not an
  // unusually-GOOD one). Needs a few days of history to be meaningful.
  const rates = daily.map((d) => d.failureRate);
  const avg = mean(rates);
  // z ≥ 2 (a standard anomaly bar; with few daily points a single outlier tops out near ~2.2, so a higher
  // bar could never fire). The `> avg` filter below keeps it to genuine UPWARD spikes, not noise.
  const flagged = daily.length >= 4 ? new Set(detectZAnomalies(rates, 2.0)) : new Set<number>();
  const spikeDates = daily.filter((d, i) => flagged.has(i) && d.failureRate > avg).map((d) => d.date);

  return {
    daily,
    overall: { totalBuilds, failedBuilds, failureRate: totalBuilds > 0 ? failedBuilds / totalBuilds : 0 },
    spikeDates,
  };
}
