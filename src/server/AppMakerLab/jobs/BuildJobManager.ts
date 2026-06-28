import admin from 'firebase-admin';
import firebaseConfig from '../../../firebase-applet-config.json';

const JOBS_COLLECTION = 'build_jobs';

import { JobStore } from './store/JobStore';
import { LocalFileJobStore } from './store/LocalFileJobStore';

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
}
