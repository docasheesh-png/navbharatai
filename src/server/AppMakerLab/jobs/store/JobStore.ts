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
}
