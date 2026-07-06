// P-PME.12 — durable persistence for the Requirement Traceability Matrix.
//
// Stores the latest computed matrix per workspace so the IDE can retrieve/download it later (across a
// reload / new instance) instead of only having it in the POST response. Mirrors the repo's store
// pattern (TeamLibraryStore/ShareStore): VITEST-skip, best-effort (never throws), fails soft.
//
// Collection: `workspace_traceability/{workspaceId}` — a single "latest" doc per workspace.

import * as admin from 'firebase-admin';
import type { TraceabilityMatrix } from './RequirementTraceabilityMatrix';

class TraceabilityStore {
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

  private doc(workspaceId: string) {
    const db = this.getDb();
    return db && workspaceId ? db.collection('workspace_traceability').doc(workspaceId) : null;
  }

  /** Persist the latest matrix for a workspace. Best-effort — returns false if storage is unavailable. */
  async save(workspaceId: string, matrix: TraceabilityMatrix): Promise<boolean> {
    const ref = this.doc(workspaceId);
    if (!ref) return false;
    try {
      await ref.set({ ...matrix, workspaceId, updatedAt: Date.now() }, { merge: false });
      return true;
    } catch {
      return false;
    }
  }

  /** Load the latest matrix for a workspace, or null when none/unavailable. */
  async loadLatest(workspaceId: string): Promise<TraceabilityMatrix | null> {
    const ref = this.doc(workspaceId);
    if (!ref) return null;
    try {
      const snap = await ref.get();
      return snap.exists ? (snap.data() as TraceabilityMatrix) : null;
    } catch {
      return null;
    }
  }
}

export const traceabilityStore = new TraceabilityStore();
