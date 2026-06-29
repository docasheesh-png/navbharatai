import { BuildJob, JobStatus } from '../BuildJobManager';

export interface JobStore {
    saveJob(job: BuildJob): Promise<void>;
    getJob(jobId: string): Promise<BuildJob | null>;
    updateJobStatus(jobId: string, status: JobStatus, progress: number, log?: string): Promise<void>;
    /**
     * P1.4 — find a job previously created with a given idempotency key, so a
     * retried/duplicate request reuses the existing job instead of spawning a second
     * build. Returns null when no job carries that key.
     */
    findJobByIdempotencyKey(key: string): Promise<BuildJob | null>;

    /**
     * P-BRE.8 — return the most recently created jobs (newest first), up to `limit`, for
     * build-analytics aggregation. Best-effort: returns [] when the store is empty/unavailable.
     */
    listRecentJobs(limit: number): Promise<BuildJob[]>;
}
