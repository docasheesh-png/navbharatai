/**
 * Phase 5.4 — Error pattern learning: Firestore store.
 *
 * Records build failures so NavBharatAI can learn from them over time.
 * Each failed session gets its accumulated error hints saved here; on
 * the next invocation for the same session, the hints are retrieved and
 * injected into the agent's prompt so it avoids repeating known mistakes.
 *
 * Collection layout:
 *   session_error_hints/{sessionId}   — { hints: string[], updatedAt: string, count: number }
 *   error_pattern_stats/{patternKey}  — { pattern, count, lastSeen } for aggregate learning
 *
 * Never throws. VITEST-skipped. All writes are best-effort fire-and-forget.
 */
import * as admin from 'firebase-admin';

interface SessionHints {
  hints: string[];
  updatedAt: string;
  count: number;
}

const MAX_HINTS_PER_SESSION = 10;

class ErrorPatternStore {
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

  /**
   * Save error hints for a session so the next retry can retrieve them.
   * Merges with any existing hints (deduped, capped at MAX_HINTS_PER_SESSION).
   * Fire-and-forget — build must never wait on this.
   */
  async saveHints(sessionId: string, newHints: string[]): Promise<void> {
    if (!newHints.length) return;
    const db = this.getDb();
    if (!db) return;
    try {
      const ref = db.collection('session_error_hints').doc(sessionId);
      const snap = await ref.get();
      const existing: string[] = snap.exists ? (snap.data() as SessionHints).hints ?? [] : [];
      const merged = [...new Set([...existing, ...newHints])].slice(0, MAX_HINTS_PER_SESSION);
      const payload: SessionHints = {
        hints: merged,
        updatedAt: new Date().toISOString(),
        count: (snap.exists ? (snap.data() as SessionHints).count ?? 0 : 0) + 1,
      };
      await ref.set(payload, { merge: true });
    } catch { /* never blocks build */ }
  }

  /**
   * Retrieve error hints saved from previous failed attempts on this session.
   * Returns empty array on any error or when no hints exist.
   */
  async getHints(sessionId: string): Promise<string[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const snap = await db.collection('session_error_hints').doc(sessionId).get();
      if (!snap.exists) return [];
      return (snap.data() as SessionHints).hints ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Clear hints after a successful build so stale hints don't carry forward
   * to future (unrelated) work on the same session.
   */
  async clearHints(sessionId: string): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      await db.collection('session_error_hints').doc(sessionId).delete();
    } catch { /* non-fatal */ }
  }

  /**
   * Increment the occurrence counter for a pattern key (e.g. 'ERESOLVE', 'cannot_find_module').
   * Used for aggregate analytics — the most common patterns can be promoted to hard-coded
   * entries in ErrorPatternMatcher. Fire-and-forget.
   */
  bumpPatternStat(patternKey: string): void {
    const db = this.getDb();
    if (!db) return;
    db.collection('error_pattern_stats').doc(patternKey).set(
      { pattern: patternKey, count: admin.firestore.FieldValue.increment(1), lastSeen: new Date().toISOString() },
      { merge: true },
    ).catch(() => { /* non-fatal */ });
  }
}

export const errorPatternStore = new ErrorPatternStore();
