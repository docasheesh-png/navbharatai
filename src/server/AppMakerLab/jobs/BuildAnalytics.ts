import { BuildJob, JobStatus } from './BuildJobManager';

/**
 * P-BRE.8 — Build analytics aggregation (pure, unit-tested).
 *
 * Turns a list of recent build jobs into pipeline-health metrics: success/failure rate, average +
 * p95 duration, status breakdown, and the top failure signatures. Pure so it can be tested without
 * Firestore; the route just feeds it `BuildJobManager.listRecent()`.
 */

export interface BuildAnalytics {
  totalJobs: number;
  /** Jobs that have reached a terminal state (PREVIEW_READY or FAILED). */
  terminalJobs: number;
  successRate: number;   // 0..1 over terminal jobs
  failureRate: number;   // 0..1 over terminal jobs
  avgDurationMs: number; // mean over terminal jobs
  p95DurationMs: number; // 95th percentile over terminal jobs
  byStatus: Record<string, number>;
  /** Most common failure signatures (from failed jobs' last log line), top 5. */
  topFailureTypes: Array<{ type: string; count: number }>;
}

const TERMINAL = new Set<JobStatus>([JobStatus.PREVIEW_READY, JobStatus.FAILED]);

function durationMs(job: BuildJob): number {
  const start = new Date(job.createdAt).getTime();
  const end = new Date(job.updatedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
}

/** Percentile (nearest-rank) of an unsorted numeric array. Returns 0 for empty. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Normalise a failed job's last log line into a stable failure signature. */
export function failureSignature(job: BuildJob): string {
  const last = job.logs && job.logs.length ? job.logs[job.logs.length - 1] : '';
  const cleaned = String(last)
    .replace(/\s+/g, ' ')
    .replace(/[0-9a-f]{8,}/gi, '<id>')   // collapse hashes/ids
    .replace(/:\d+:\d+/g, '')             // strip line:col
    .trim();
  return cleaned ? cleaned.slice(0, 120) : 'Unknown failure';
}

/** Aggregate recent build jobs into pipeline-health metrics. Pure. */
export function aggregateBuildAnalytics(jobs: BuildJob[]): BuildAnalytics {
  const byStatus: Record<string, number> = {};
  const durations: number[] = [];
  const failureCounts = new Map<string, number>();
  let success = 0;
  let failure = 0;

  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    if (!TERMINAL.has(job.status)) continue;
    durations.push(durationMs(job));
    if (job.status === JobStatus.PREVIEW_READY) success++;
    else if (job.status === JobStatus.FAILED) {
      failure++;
      const sig = failureSignature(job);
      failureCounts.set(sig, (failureCounts.get(sig) || 0) + 1);
    }
  }

  const terminal = success + failure;
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const topFailureTypes = [...failureCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalJobs: jobs.length,
    terminalJobs: terminal,
    successRate: terminal ? success / terminal : 0,
    failureRate: terminal ? failure / terminal : 0,
    avgDurationMs: Math.round(avg),
    p95DurationMs: percentile(durations, 95),
    byStatus,
    topFailureTypes,
  };
}
