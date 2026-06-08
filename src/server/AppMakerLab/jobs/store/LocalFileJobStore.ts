import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { BuildJob, JobStatus } from '../BuildJobManager';
import { JobStore } from './JobStore';

export class LocalFileJobStore implements JobStore {
    private storageDir = join(process.cwd(), 'job_storage');

    constructor() {
        mkdir(this.storageDir, { recursive: true }).catch(() => {});
    }

    async saveJob(job: BuildJob): Promise<void> {
        await writeFile(join(this.storageDir, `${job.id}.json`), JSON.stringify(job, null, 2));
    }

    async getJob(jobId: string): Promise<BuildJob | null> {
        try {
            const data = await readFile(join(this.storageDir, `${jobId}.json`), 'utf-8');
            return JSON.parse(data) as BuildJob;
        } catch {
            return null;
        }
    }

    async updateJobStatus(jobId: string, status: JobStatus, progress: number, log?: string): Promise<void> {
        const job = await this.getJob(jobId);
        if (!job) throw new Error("Job not found");
        job.status = status;
        job.progress = progress;
        job.updatedAt = new Date();
        if (log) job.logs.push(log);
        await this.saveJob(job);
    }
}
