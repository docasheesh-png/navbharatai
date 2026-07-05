/**
 * Phase 4.2 — Per-user monthly AI cost accumulation.
 *
 * Stores a running total of estimated AI spend per user per calendar month so
 * the Billing panel can show "This Month's AI Cost" without guessing. Data is
 * display-only — the actual wallet/credits flow runs separately.
 *
 * Collection: `user_costs`
 * Doc ID:     `{userId}_{YYYY-MM}` (one doc per user per month)
 * Fields:     userId, month, totalBuilds, totalCostUsd, updatedAt
 *
 * Pattern mirrors MetricsStore / ProMemory:
 *   - VITEST-skip so tests never touch Firestore
 *   - Best-effort: never throws, never blocks a build
 *   - Uses set+merge so a missing doc is created atomically
 */
import * as admin from 'firebase-admin';

export interface MonthlyUsageDoc {
  userId: string;
  month: string;
  totalBuilds: number;
  totalCostUsd: number;
  updatedAt: number;
}

/**
 * A cost is recordable only if it is a FINITE, POSITIVE number. This rejects `NaN` and `Infinity` —
 * a plain `costUsd <= 0` check does NOT (`NaN <= 0` is `false`), and a single NaN would then
 * permanently poison the stored monthly total (`existing + NaN === NaN` forever). Pure + tested.
 */
export function isRecordableCost(costUsd: number): boolean {
  return Number.isFinite(costUsd) && costUsd > 0;
}

class UserCostStore {
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

  private monthKey(): string {
    return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  }

  /** Add a build's estimated cost to the user's monthly running total. */
  async record(userId: string, costUsd: number): Promise<void> {
    const db = this.getDb();
    // Reject non-finite/non-positive costs at the single entry point (see isRecordableCost) so a
    // NaN can never permanently poison the stored monthly total.
    if (!db || !userId || !isRecordableCost(costUsd)) return;
    const month = this.monthKey();
    const docId = `${userId}_${month}`;
    try {
      const ref = db.collection('user_costs').doc(docId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as MonthlyUsageDoc) : null;
        tx.set(ref, {
          userId,
          month,
          totalBuilds: (existing?.totalBuilds ?? 0) + 1,
          totalCostUsd: Math.round(((existing?.totalCostUsd ?? 0) + costUsd) * 1_000_000) / 1_000_000,
          updatedAt: Date.now(),
        }, { merge: false });
      });
    } catch { /* best-effort — never block a build */ }
  }

  /** Fetch a user's monthly usage. Defaults to the current month. */
  async get(userId: string, month?: string): Promise<MonthlyUsageDoc | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    const m = month ?? this.monthKey();
    try {
      const snap = await db.collection('user_costs').doc(`${userId}_${m}`).get();
      if (!snap.exists) return null;
      return snap.data() as MonthlyUsageDoc;
    } catch {
      return null;
    }
  }
}

export const userCostStore = new UserCostStore();
