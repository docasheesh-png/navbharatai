/**
 * Phase 74/75/76/77/78 — Pro Cross-Session Memory (Firestore-backed).
 *
 * Persists a Pro session's rolling memory (summary + edit log + architectural
 * decisions + user preferences) so it survives browser refreshes, new devices,
 * and time gaps between sessions. Each Pro session ID maps to one document.
 *
 * Collection: `pro_memories`
 * Document:   sessionId
 * Fields:     memorySummary, editLog, decisions, preferences, stack, dbProvider
 *
 * Integration:
 *   - Build route READS at start (supplements in-request memory from frontend)
 *   - Build route WRITES after completion (persists updated summary + editLog)
 *   - Gracefully degrades: if Firestore is unavailable, the in-request memory
 *     from the frontend still works — Firestore is additive, not load-bearing.
 */
import * as admin from 'firebase-admin';

export interface ProMemoryDoc {
  memorySummary: string;
  editLog: string[];
  /** Key architectural decisions made during the project (Phase 76). */
  decisions: string[];
  /** User coding preferences learned across builds (Phase 77). */
  preferences: Record<string, string>;
  /** Detected/chosen tech stack (e.g. "React + Express + PostgreSQL") */
  stack?: string;
  /** DB provider chosen (supabase/firebase/mongodb/etc.) */
  dbProvider?: string;
  /** Error patterns seen + fixes applied (Phase 78). */
  errorPatterns: Array<{ pattern: string; fix: string }>;
  updatedAt: number;
}

class ProMemoryStore {
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

  async load(sessionId: string): Promise<Partial<ProMemoryDoc> | null> {
    const db = this.getDb();
    if (!db || !sessionId) return null;
    try {
      const doc = await db.collection('pro_memories').doc(sessionId).get();
      if (!doc.exists) return null;
      return doc.data() as Partial<ProMemoryDoc>;
    } catch {
      return null;
    }
  }

  async save(sessionId: string, patch: Partial<ProMemoryDoc>): Promise<void> {
    const db = this.getDb();
    if (!db || !sessionId) return;
    try {
      await db
        .collection('pro_memories')
        .doc(sessionId)
        .set({ ...patch, updatedAt: Date.now() }, { merge: true });
    } catch {
      // Non-fatal — session memory still works in-request via frontend state
    }
  }

  /**
   * Phase 76 — log an architectural decision with rationale.
   * Future sessions will see WHY a choice was made.
   */
  async logDecision(sessionId: string, decision: string): Promise<void> {
    const db = this.getDb();
    if (!db || !sessionId) return;
    try {
      const ref = db.collection('pro_memories').doc(sessionId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const existing: string[] = snap.exists ? (snap.data()?.decisions ?? []) : [];
        const trimmed = [...existing, decision].slice(-50);
        tx.set(ref, { decisions: trimmed, updatedAt: Date.now() }, { merge: true });
      });
    } catch {}
  }

  /**
   * Phase 77 — save a user coding preference (e.g. 'framework' = 'React').
   */
  async savePreference(sessionId: string, key: string, value: string): Promise<void> {
    const db = this.getDb();
    if (!db || !sessionId) return;
    try {
      await db.collection('pro_memories').doc(sessionId).set(
        { [`preferences.${key}`]: value, updatedAt: Date.now() },
        { merge: true },
      );
    } catch {}
  }

  /**
   * Phase 78 — record an error pattern and its fix so Pro can apply it
   * immediately next time the same error occurs.
   */
  async logErrorPattern(sessionId: string, pattern: string, fix: string): Promise<void> {
    const db = this.getDb();
    if (!db || !sessionId) return;
    try {
      const ref = db.collection('pro_memories').doc(sessionId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const existing: Array<{ pattern: string; fix: string }> = snap.exists ? (snap.data()?.errorPatterns ?? []) : [];
        const trimmed = [...existing, { pattern, fix }].slice(-20);
        tx.set(ref, { errorPatterns: trimmed, updatedAt: Date.now() }, { merge: true });
      });
    } catch {}
  }
}

export const proMemoryStore = new ProMemoryStore();
