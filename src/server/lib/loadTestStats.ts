// P-TQA.3 — Load-test statistics (pure core).
//
// k6 is not available in this CI, so shipping a k6 script that can't run would be non-running
// scaffolding (a fake). Instead the runnable load tester is a dependency-free Node script
// (scripts/loadTest.mjs, uses Node 22's global fetch) — this module is its pure, unit-tested
// statistics core: latency percentiles, error rate, throughput, and a pass/fail against thresholds.

export interface LoadSummary {
  count: number;
  errors: number;
  errorRate: number;
  throughputRps: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/** The p-th percentile (0..100) of a numeric sample via nearest-rank. Pure. */
export function percentile(values: number[], p: number): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clampedP = Math.max(0, Math.min(100, p));
  // Nearest-rank: rank = ceil(p/100 * N), 1-based.
  const rank = Math.max(1, Math.ceil((clampedP / 100) * sorted.length));
  return sorted[rank - 1];
}

/** Summarize raw latency samples (ms) + error count over a wall-clock window. Pure. */
export function summarize(latencies: number[], errors: number, durationMs: number): LoadSummary {
  const count = latencies.length + errors;
  const ok = latencies.length;
  const sum = latencies.reduce((s, v) => s + v, 0);
  const seconds = durationMs > 0 ? durationMs / 1000 : 0;
  return {
    count,
    errors,
    errorRate: count > 0 ? errors / count : 0,
    throughputRps: seconds > 0 ? Math.round((count / seconds) * 100) / 100 : 0,
    minMs: ok > 0 ? Math.min(...latencies) : 0,
    maxMs: ok > 0 ? Math.max(...latencies) : 0,
    meanMs: ok > 0 ? Math.round((sum / ok) * 100) / 100 : 0,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
  };
}

export interface LoadThresholds {
  /** Max acceptable p95 latency (ms). */
  p95Ms?: number;
  /** Max acceptable error rate (0..1). */
  errorRate?: number;
}

export interface ThresholdResult {
  pass: boolean;
  failures: string[];
}

/** Check a summary against thresholds (defaults: p95 < 2000ms, errorRate < 0.01). Pure. */
export function checkThresholds(summary: LoadSummary, thresholds: LoadThresholds = {}): ThresholdResult {
  const p95Limit = thresholds.p95Ms ?? 2000;
  const errLimit = thresholds.errorRate ?? 0.01;
  const failures: string[] = [];
  if (summary.p95Ms > p95Limit) failures.push(`p95 ${summary.p95Ms}ms > ${p95Limit}ms`);
  if (summary.errorRate > errLimit) failures.push(`error rate ${(summary.errorRate * 100).toFixed(2)}% > ${(errLimit * 100).toFixed(2)}%`);
  return { pass: failures.length === 0, failures };
}
