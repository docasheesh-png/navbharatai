/**
 * Phase 19 — Persistent workspace memory backed by Firestore.
 *
 * Engineer AI writes key project decisions and architecture notes to
 * `.engineer/memory.md` inside the E2B sandbox. That file is lost when the
 * sandbox is deleted or recreated. This store persists the memory content to
 * Firestore so it can be restored into a fresh sandbox on the next session,
 * giving the agent continuity across sandbox lifecycles.
 *
 * Collection: `engineer_memory`
 * Document:   workspaceId
 * Fields:     content (string), updatedAt (number)
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

class WorkspaceMemoryStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    // Skip Firestore under the test runner: with no GCP credentials, the
    // google-auth metadata-server lookup hangs for seconds before failing,
    // which would time out unit tests. Production (Cloud Run) sets neither flag.
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) {
          admin.initializeApp({});
        }
        const db = getServerDb();
        this.db = db;
      }
      return this.db;
    } catch {
      return null;
    }
  }

  async save(workspaceId: string, content: string): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    await db
      .collection('engineer_memory')
      .doc(workspaceId)
      .set({ content, updatedAt: Date.now() }, { merge: true });
  }

  async load(workspaceId: string): Promise<string | null> {
    const db = this.getDb();
    if (!db) return null;
    const doc = await db.collection('engineer_memory').doc(workspaceId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return typeof data?.content === 'string' ? data.content : null;
  }
}

export const workspaceMemoryStore = new WorkspaceMemoryStore();
