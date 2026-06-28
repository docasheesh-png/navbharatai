import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
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

    // P1.4 — scan the local job files for a matching idempotency key. Dev/CI-only store,
    // so a linear scan is fine. Returns the most recently created match.
    async findJobByIdempotencyKey(key: string): Promise<BuildJob | null> {
        if (!key) return null;
        try {
            const files = await readdir(this.storageDir).catch(() => [] as string[]);
            const matches: BuildJob[] = [];
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const data = await readFile(join(this.storageDir, file), 'utf-8');
                    const job = JSON.parse(data) as BuildJob;
                    if (job.idempotencyKey === key) matches.push(job);
                } catch { /* skip unreadable/corrupt entries */ }
            }
            if (matches.length === 0) return null;
            matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            return matches[0];
        } catch {
            return null;
        }
    }
}
