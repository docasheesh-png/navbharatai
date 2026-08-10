
const JOBS_COLLECTION = 'build_jobs';

import { JobStore } from './store/JobStore';
import { LocalFileJobStore } from './store/LocalFileJobStore';
import { isStaleInFlight, staleRecoveryLog, DEFAULT_STALE_MS } from './jobRecovery';

export enum JobStatus {
    QUEUED = 'QUEUED',
    PLANNING = 'PLANNING',
    GENERATING = 'GENERATING',
    PATCHING = 'PATCHING',
    BUILDING = 'BUILDING',
    REPAIRING = 'REPAIRING',
    PREVIEW_READY = 'PREVIEW_READY',
    FAILED = 'FAILED'
}

export interface BuildJob {
    id: string;
    prompt: string;
    status: JobStatus;
    progress: number;
    previewUrl?: string;
    workspaceId?: string;
    logs: string[];
    createdAt: Date;
    updatedAt: Date;
    /** P1.4 — the idempotency key this job was created under (if any). */
    idempotencyKey?: string;
}

// P1.4 — a monotonic suffix so two jobs created in the same millisecond never collide
// on `job-<ms>`. Combined with the timestamp this yields a unique, sortable id.
let jobSeq = 0;

/** A FAILED job is terminal — a duplicate request after it MAY legitimately retry. */
function isTerminalFailure(job: BuildJob): boolean {
    return job.status === JobStatus.FAILED;
}

export class BuildJobManager {
    private static store: JobStore = new LocalFileJobStore();

    /** Swap the backing store (used by tests to inject an in-memory store). */
    static useStore(store: JobStore): void {
        this.store = store;
    }

    /**
     * Create a build job. P1.4 — when an `idempotencyKey` is supplied, a duplicate or
     * retried request that reuses the same key returns the SAME existing job instead of
     * spawning a second build (unless the previous attempt terminally FAILED, in which
     * case a fresh attempt is allowed). Without a key, behaviour is unchanged.
     */
    static async createJob(prompt: string, idempotencyKey?: string): Promise<string> {
        if (idempotencyKey) {
            const existing = await this.store.findJobByIdempotencyKey(idempotencyKey);
            if (existing && !isTerminalFailure(existing)) {
                // In-flight or already-succeeded build → reuse it, never double-run.
                return existing.id;
            }
        }
        const jobId = `job-${Date.now()}-${(jobSeq++).toString(36)}`;
        const job: BuildJob = {
            id: jobId,
            prompt,
            status: JobStatus.QUEUED,
            progress: 0,
            logs: ['Job queued'],
            createdAt: new Date(),
            updatedAt: new Date(),
            ...(idempotencyKey ? { idempotencyKey } : {}),
        };
        await this.store.saveJob(job);
        return jobId;
    }

    static async updateStatus(jobId: string, status: JobStatus, progress: number, log?: string) {
        await this.store.updateJobStatus(jobId, status, progress, log);
        // P-BRE.7 — on a terminal status, fire a build notification (webhook). Best-effort +
        // non-blocking: a missing webhook URL or a webhook failure never affects the build.
        if (status === JobStatus.PREVIEW_READY || status === JobStatus.FAILED) {
            this.getJob(jobId)
                .then(async (job) => {
                    if (!job) return;
                    const { notifyBuildResult } = await import('../../NotificationManager');
                    await notifyBuildResult(job);
                    // P-PME.11 — record an SLO violation (best-effort) when the build ran over its target.
                    try {
                        const { evaluateSlo } = await import('../intelligence/BuildSLATracker');
                        const ev = evaluateSlo(job);
                        if (!ev.withinSlo) {
                            const { audit } = await import('../../lib/audit');
                            audit('BUILD_SLO_VIOLATION', {
                                jobId: job.id, complexity: ev.complexity,
                                durationMs: ev.durationMs, sloMs: ev.sloMs, overByMs: ev.overByMs,
                            }, 'warn');
                        }
                    } catch { /* SLO tracking is best-effort */ }
                })
                .catch(() => { /* notifications are best-effort */ });
        }
    }

    static async getJob(jobId: string): Promise<BuildJob | null> {
        return await this.store.getJob(jobId);
    }

    /** P1.4 — find a reusable (non-terminally-failed) job for an idempotency key, else null. */
    static async findExisting(idempotencyKey: string): Promise<BuildJob | null> {
        if (!idempotencyKey) return null;
        const existing = await this.store.findJobByIdempotencyKey(idempotencyKey);
        return existing && !isTerminalFailure(existing) ? existing : null;
    }

    /** P-BRE.8 — the most recent jobs (newest first) for build-analytics aggregation. */
    static async listRecent(limit = 100): Promise<BuildJob[]> {
        return await this.store.listRecentJobs(limit);
    }

    /**
     * P-BRE.6 (durable-recovery core) — find build jobs that were in flight when a previous server
     * instance died/restarted (non-terminal status + a stale `updatedAt` heartbeat) and mark each
     * FAILED with an honest reason. This turns a SILENTLY-lost build (stuck forever in e.g. BUILDING)
     * into an honest terminal state — and, via updateStatus, fires the build notification so the user
     * is told. Best-effort: never throws, so it can run on boot without risking startup. Returns the
     * ids it recovered. (Full queue-based re-EXECUTION remains infra-blocked — Redis / Cloud Tasks.)
     */
    static async recoverStaleJobs(opts?: { nowMs?: number; thresholdMs?: number; scanLimit?: number }): Promise<string[]> {
        const nowMs = opts?.nowMs ?? Date.now();
        const thresholdMs = opts?.thresholdMs ?? DEFAULT_STALE_MS;
        const recovered: string[] = [];
        try {
            const jobs = await this.store.listRecentJobs(opts?.scanLimit ?? 200);
            for (const job of jobs) {
                if (!isStaleInFlight(job, nowMs, thresholdMs)) continue;
                const updated = job.updatedAt instanceof Date ? job.updatedAt.getTime() : new Date(job.updatedAt as any).getTime();
                await this.updateStatus(job.id, JobStatus.FAILED, 0, staleRecoveryLog(nowMs - updated));
                recovered.push(job.id);
            }
        } catch { /* best-effort — recovery must never block or crash boot */ }
        return recovered;
    }
}
