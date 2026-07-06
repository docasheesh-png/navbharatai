// P-BRE.6 (durable-recovery core) — pure, infra-free helpers for detecting build jobs that were
// orphaned by a server restart / crash and honestly marking them terminal.
//
// The full P-BRE.6 vision (a BullMQ/Redis or Cloud Tasks queue that RE-EXECUTES an interrupted build)
// needs external infra this project does not have, so it stays recorded as infra-blocked. But its most
// important symptom — "in-flight jobs are lost SILENTLY" — is fixable now with zero infra: `updatedAt`
// is already bumped on every status transition (a natural heartbeat), so a non-terminal job whose
// `updatedAt` has gone stale is an orphan. Recovery marks it FAILED with an honest reason (which fires
// the existing build notification), so a lost build never sits stuck forever and the user is told the
// truth. This module is a PURE unit so the staleness rule is testable without Firestore or a clock.
//
// NOTE: statuses are string literals equal to the JobStatus enum VALUES on purpose — that keeps this a
// TYPE-ONLY import of BuildJob and avoids a runtime import cycle with BuildJobManager.

import type { BuildJob } from './BuildJobManager';

/** Statuses a job can be stuck in when a worker dies mid-build (everything except the two terminals). */
export const NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'QUEUED', 'PLANNING', 'GENERATING', 'PATCHING', 'BUILDING', 'REPAIRING',
]);

/** No status update for this long on a non-terminal job → treat it as orphaned by a restart. */
export const DEFAULT_STALE_MS = 10 * 60 * 1000; // 10 minutes

function updatedAtMs(job: BuildJob): number {
  const u: unknown = job.updatedAt;
  if (u instanceof Date) return u.getTime();
  const parsed = new Date(u as any).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * True when `job` is a non-terminal build whose last status update is older than `thresholdMs` — i.e.
 * a build that was in flight when the process died and has made no progress since. Terminal jobs
 * (PREVIEW_READY / FAILED) and jobs with an unreadable timestamp are never considered stale.
 */
export function isStaleInFlight(job: BuildJob, nowMs: number, thresholdMs: number = DEFAULT_STALE_MS): boolean {
  if (!NON_TERMINAL_STATUSES.has(job.status)) return false;
  const updated = updatedAtMs(job);
  if (!Number.isFinite(updated)) return false;
  return (nowMs - updated) > thresholdMs;
}

/** The honest failure log recorded when an orphaned job is recovered. */
export function staleRecoveryLog(ageMs: number): string {
  const mins = Math.max(1, Math.round(ageMs / 60000));
  return `Build interrupted — no progress for ~${mins} min (server restart or lost worker). Marked failed so it isn't stuck; please retry.`;
}
