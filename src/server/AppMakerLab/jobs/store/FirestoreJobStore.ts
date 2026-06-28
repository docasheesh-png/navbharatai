import * as admin from 'firebase-admin';
import { BuildJob, JobStatus } from '../BuildJobManager';
import { JobStore } from './JobStore';
import { firestoreDatabaseId } from '../../../lib/firestoreDb';

export class FirestoreJobStore implements JobStore {
    private db: admin.firestore.Firestore;
    private collection = 'build_jobs';

    constructor() {
        if (!admin.apps || admin.apps.length === 0) {
            admin.initializeApp({});
        }
        this.db = admin.firestore();
        this.db.settings({ databaseId: firestoreDatabaseId() });
    }

    async saveJob(job: BuildJob): Promise<void> {
        await this.db.collection(this.collection).doc(job.id).set(job);
    }

    async getJob(jobId: string): Promise<BuildJob | null> {
        const doc = await this.db.collection(this.collection).doc(jobId).get();
        return doc.exists ? doc.data() as BuildJob : null;
    }

    async updateJobStatus(jobId: string, status: JobStatus, progress: number, log?: string): Promise<void> {
        const docRef = this.db.collection(this.collection).doc(jobId);
        if (log) {
            // Use a transaction to append + cap at 100 entries — prevents Firestore
            // documents from exceeding the 1MB limit on long/verbose builds.
            await this.db.runTransaction(async tx => {
                const snap = await tx.get(docRef);
                const existing: string[] = snap.exists ? (snap.data()?.logs ?? []) : [];
                const trimmed = [...existing, log].slice(-100);
                tx.set(docRef, { status, progress, updatedAt: new Date(), logs: trimmed }, { merge: true });
            });
        } else {
            await docRef.update({ status, progress, updatedAt: new Date() });
        }
    }

    // P1.4 — look up the most recent job carrying this idempotency key via an indexed
    // Firestore query, so a duplicate/retried request reuses the existing build.
    async findJobByIdempotencyKey(key: string): Promise<BuildJob | null> {
        if (!key) return null;
        const snap = await this.db.collection(this.collection)
            .where('idempotencyKey', '==', key)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        return snap.empty ? null : (snap.docs[0].data() as BuildJob);
    }
}
