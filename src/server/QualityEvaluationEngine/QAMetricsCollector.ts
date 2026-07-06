import { BuildJob, JobStatus } from '../AppMakerLab/jobs/BuildJobManager';

/**
 * P-TQA.13 — MTTD / MTTR reliability metrics (pure, unit-tested).
 *
 * Derives failure-recovery reliability from real build-job history — the same job store the rest of
 * the analytics surface reads (`BuildJobManager.listRecent()`), so it needs no new persistence and no
 * new build-lifecycle hook. Pure so it can be tested without Firestore; the route just feeds it jobs.
 *
 * Definitions (build-pipeline analogs of the classic CI terms, stated honestly):
 *  - **MTTD — Mean Time To Detect:** mean(failedAt − startedAt) over FAILED builds, i.e. how long a
 *    build runs before its failure is detected. (The classic "bad-commit-deployed → tests-caught-it"
 *    framing needs deploy timestamps we do not record for user builds; this is the faithful build-job
 *    equivalent — time from build start to failure surfacing.)
 *  - **MTTR — Mean Time To Repair:** for each app (correlated by `workspaceId`), the time from a build
 *    failing to the NEXT successful build of the SAME app. A failure with no later success for its app
 *    is *unresolved* and contributes to `unresolvedFailures` (never to MTTR — we do not invent a repair
 *    time that has not happened).
 *
 * Honest zeros: with no failures (or no recoveries) the corresponding means are 0 and `sampleSize` is 0,
 * so callers can show "no data yet" instead of a fabricated number.
 */

/** Terminal event time of a job = when it reached its terminal status. */
function eventTimeMs(job: BuildJob): number {
  const t = new Date(job.updatedAt).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function startTimeMs(job: BuildJob): number {
  const t = new Date(job.createdAt).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function mean(values: number[]): number {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

export interface ReliabilityMetrics {
  /** Mean time from build start to failure detection, ms (0 when no failures). */
  mttdMs: number;
  /** Number of FAILED builds that fed MTTD. */
  mttdSampleSize: number;
  /** Mean time from a failure to the next success of the same app, ms (0 when no recoveries). */
  mttrMs: number;
  /** Number of failure→recovery pairs that fed MTTR. */
  mttrSampleSize: number;
  /** Failures that were followed by a later success of the same app. */
  recoveredFailures: number;
  /** Failures with no later success of the same app (still broken / abandoned). */
  unresolvedFailures: number;
  /** recoveredFailures / totalFailures, 0..1 (0 when no failures). */
  recoveryRate: number;
  /** Total FAILED builds seen. */
  totalFailures: number;
}

/**
 * Compute MTTD/MTTR reliability metrics from a batch of build jobs. Pure.
 *
 * MTTR correlation is per-app via `workspaceId`; a failed build with no `workspaceId` cannot be tied to
 * a later success, so it is always counted as unresolved (it still contributes to MTTD).
 */
export function computeReliabilityMetrics(jobs: BuildJob[]): ReliabilityMetrics {
  // MTTD — every FAILED build with a valid start+fail time.
  const detectTimes: number[] = [];
  for (const job of jobs) {
    if (job.status !== JobStatus.FAILED) continue;
    const start = startTimeMs(job);
    const failedAt = eventTimeMs(job);
    if (Number.isFinite(start) && Number.isFinite(failedAt) && failedAt >= start) {
      detectTimes.push(failedAt - start);
    }
  }

  // MTTR — for each app, pair each failure with the next later success of the same app.
  const successesByApp = new Map<string, number[]>(); // workspaceId → sorted success event times
  for (const job of jobs) {
    if (job.status !== JobStatus.PREVIEW_READY || !job.workspaceId) continue;
    const t = eventTimeMs(job);
    if (!Number.isFinite(t)) continue;
    const arr = successesByApp.get(job.workspaceId) || [];
    arr.push(t);
    successesByApp.set(job.workspaceId, arr);
  }
  for (const arr of successesByApp.values()) arr.sort((a, b) => a - b);

  const repairTimes: number[] = [];
  let recovered = 0;
  let unresolved = 0;
  let totalFailures = 0;
  for (const job of jobs) {
    if (job.status !== JobStatus.FAILED) continue;
    totalFailures++;
    const failedAt = eventTimeMs(job);
    const successes = job.workspaceId ? successesByApp.get(job.workspaceId) : undefined;
    const nextSuccess = successes && Number.isFinite(failedAt)
      ? successes.find((t) => t > failedAt)
      : undefined;
    if (nextSuccess !== undefined) {
      recovered++;
      repairTimes.push(nextSuccess - failedAt);
    } else {
      unresolved++;
    }
  }

  return {
    mttdMs: mean(detectTimes),
    mttdSampleSize: detectTimes.length,
    mttrMs: mean(repairTimes),
    mttrSampleSize: repairTimes.length,
    recoveredFailures: recovered,
    unresolvedFailures: unresolved,
    recoveryRate: totalFailures ? recovered / totalFailures : 0,
    totalFailures,
  };
}
