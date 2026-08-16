import * as admin from 'firebase-admin';
import { BuildJob, JobStatus } from '../BuildJobManager';
import { JobStore } from './JobStore';
import { firestoreDatabaseId } from '../../../lib/firestoreDb';
import { getServerDb } from '../../../lib/serverDb';
import { listEqNewestFirst } from '../../../lib/firestoreIndexSafe';

export class FirestoreJobStore implements JobStore {
    private db: admin.firestore.Firestore;
    private collection = 'build_jobs';

    constructor() {
        if (!admin.apps || admin.apps.length === 0) {
            admin.initializeApp({});
        }
        // Collision-free shared admin handle (getFirestore(app, dbId)) — no per-store .settings() race.
        this.db = getServerDb() ?? admin.firestore();
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

    // P1.4 — look up the most recent job carrying this idempotency key, so a duplicate/retried
    // request reuses the existing build instead of starting a second one.
    //
    // Equality filter only, newest-first in memory. The previous `.where(idempotencyKey)
    // .orderBy(createdAt)` chain required a composite index that is not deployed to this project,
    // and the throw propagated to the caller — which is the worst possible place for this
    // particular query to fail, because "I could not check for a duplicate" then looks exactly
    // like "there is no duplicate", and the user is billed for the same build twice.
    async findJobByIdempotencyKey(key: string): Promise<BuildJob | null> {
        if (!key) return null;
        const rows = await listEqNewestFirst<BuildJob>(
            this.db.collection(this.collection), [['idempotencyKey', key]], 'createdAt', 1,
        );
        return rows[0] ?? null;
    }

    // P-BRE.8 — most recent jobs (newest first) via an indexed query, for analytics aggregation.
    async listRecentJobs(limit: number): Promise<BuildJob[]> {
        try {
            const snap = await this.db.collection(this.collection)
                .orderBy('createdAt', 'desc')
                .limit(Math.max(1, limit))
                .get();
            return snap.docs.map(d => d.data() as BuildJob);
        } catch (err) {
            console.error('[FirestoreJobStore] listRecentJobs failed:', err);
            return [];
        }
    }
}
