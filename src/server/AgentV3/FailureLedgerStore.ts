// Durable home for the "why do builds fail?" ledger — one document per calendar day.
//
// The decision lives in failureLedger.ts (pure, tested); this is only its storage, and it mirrors
// AssistantSpendStore exactly: VITEST-skipped, best-effort, never throws, one doc per day keyed
// 'YYYY-MM-DD', folded in a transaction because several builds finish at once and a read-modify-write
// without one would silently drop counts — which would understate precisely the thing this exists to
// measure.
//
// The day is stamped from the SERVER clock. A device clock cannot move a failure into another day.
//
// 🔒 ADMIN-ONLY DATA. The money in these documents is NavBharatAI's own spend on builds that produced
// nothing; it is not a user's bill and must never reach a user-facing surface.
//
// Collection: `build_failures`   ·   Doc ID: `YYYY-MM-DD`

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { foldFailure, rankFailures, type FailureDay, type FailureEntry, type FailureRanking } from './failureLedger';

const COLLECTION = 'build_failures';

class FailureLedgerStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private dayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Fold one failed build into today's document. Best-effort — telemetry never affects a build. */
  async record(entry: FailureEntry): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    const date = this.dayKey();
    try {
      const ref = db.collection(COLLECTION).doc(date);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as FailureDay) : null;
        tx.set(ref, foldFailure(existing, date, entry), { merge: false });
      });
    } catch { /* best-effort — a telemetry write must never cost a user their build */ }
  }

  /**
   * The ranking over the last N days, plus whether the read was complete.
   *
   * 🔒 A READ FAILURE IS NOT "no failures". It returns `complete: false` with an empty ranking, so a
   * Firestore hiccup reads as "we could not tell you" rather than as a perfect week — the same
   * distinction `listWithCompleteness` exists to preserve on the deployment registry.
   */
  async ranking(days = 14): Promise<{ ranking: FailureRanking; complete: boolean }> {
    const db = this.getDb();
    const n = Math.max(1, Math.min(365, Math.floor(days)));
    if (!db) return { ranking: rankFailures([]), complete: false };
    try {
      const snap = await db.collection(COLLECTION).orderBy('date', 'desc').limit(n).get();
      return { ranking: rankFailures(snap.docs.map((d) => d.data() as FailureDay)), complete: true };
    } catch {
      return { ranking: rankFailures([]), complete: false };
    }
  }
}

export const failureLedgerStore = new FailureLedgerStore();
