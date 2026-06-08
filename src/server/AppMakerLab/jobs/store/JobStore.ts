import { BuildJob, JobStatus } from '../BuildJobManager';

export interface JobStore {
    saveJob(job: BuildJob): Promise<void>;
    getJob(jobId: string): Promise<BuildJob | null>;
    updateJobStatus(jobId: string, status: JobStatus, progress: number, log?: string): Promise<void>;
}
