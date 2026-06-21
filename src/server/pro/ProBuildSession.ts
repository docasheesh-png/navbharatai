/**
 * G1.2 — Refresh-safe build results (Firestore-backed).
 *
 * Stores the completed build result keyed by sessionId so that when the user
 * refreshes the browser (or reopens the tab), the last build result can be
 * immediately restored without re-running the build.
 *
 * Collection: `build_sessions`
 * Document:   sessionId
 *
 * Gracefully degrades: if Firestore is unavailable the build still completes
 * normally — the session store is write-once best-effort, never load-bearing.
 */
import * as admin from 'firebase-admin';

export interface BuildSessionDoc {
  ok: boolean;
  files: Record<string, string>;
  fileCount: number;
  verify?: unknown;
  validation?: unknown;
  previewAllowed?: boolean;
  preview?: unknown;
  memorySummary?: string;
  editLog?: string[];
  partial?: boolean;
  savedAt: number;
}

class ProBuildSessionStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = admin.firestore();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  async save(sessionId: string, result: Omit<BuildSessionDoc, 'savedAt'>): Promise<void> {
    const db = this.getDb();
    if (!db || !sessionId) return;
    try {
      const doc: BuildSessionDoc = { ...result, savedAt: Date.now() };
      // Cap file content at 800KB total to stay under Firestore 1MB doc limit.
      const filePaths = Object.keys(doc.files);
      let totalSize = 0;
      const capped: Record<string, string> = {};
      for (const p of filePaths) {
        const content = doc.files[p] || '';
        if (totalSize + content.length > 800_000) break;
        capped[p] = content;
        totalSize += content.length;
      }
      doc.files = capped;
      await db.collection('build_sessions').doc(sessionId).set(doc);
    } catch {
      // Best-effort — never break the build response
    }
  }

  async load(sessionId: string): Promise<BuildSessionDoc | null> {
    const db = this.getDb();
    if (!db || !sessionId) return null;
    try {
      const snap = await db.collection('build_sessions').doc(sessionId).get();
      if (!snap.exists) return null;
      return snap.data() as BuildSessionDoc;
    } catch {
      return null;
    }
  }
}

export const proBuildSessionStore = new ProBuildSessionStore();
