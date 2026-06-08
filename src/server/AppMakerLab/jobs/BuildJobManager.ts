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
}

export class BuildJobManager {
    private static store: JobStore = new LocalFileJobStore();

    static async createJob(prompt: string): Promise<string> {
        const jobId = `job-${Date.now()}`;
        const job: BuildJob = {
            id: jobId,
            prompt,
            status: JobStatus.QUEUED,
            progress: 0,
            logs: ['Job queued'],
            createdAt: new Date(),
            updatedAt: new Date()
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
}
