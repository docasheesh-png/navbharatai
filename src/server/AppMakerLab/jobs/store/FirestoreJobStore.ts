import * as admin from 'firebase-admin';
import { BuildJob, JobStatus } from '../BuildJobManager';
import { JobStore } from './JobStore';
import firebaseConfig from '../../../../firebase-applet-config.json';

export class FirestoreJobStore implements JobStore {
    private db: admin.firestore.Firestore;
    private collection = 'build_jobs';

    constructor() {
        if (!admin.apps || admin.apps.length === 0) {
            admin.initializeApp({});
        }
        this.db = admin.firestore();
        this.db.settings({ databaseId: firebaseConfig.firestoreDatabaseId });
    }

    async saveJob(job: BuildJob): Promise<void> {
        await this.db.collection(this.collection).doc(job.id).set(job);
    }

    async getJob(jobId: string): Promise<BuildJob | null> {
        const doc = await this.db.collection(this.collection).doc(jobId).get();
        return doc.exists ? doc.data() as BuildJob : null;
    }

    async updateJobStatus(jobId: string, status: JobStatus, progress: number, log?: string): Promise<void> {
        const update: any = { status, progress, updatedAt: new Date() };
        if (log) {
            update.logs = admin.firestore.FieldValue.arrayUnion(log);
        }
        await this.db.collection(this.collection).doc(jobId).update(update);
    }
}
