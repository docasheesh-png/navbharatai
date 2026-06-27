/**
 * Per-build history records for the "My Profile" usage history feature.
 *
 * Stores one document per build in `user_build_history`, keyed by a random UUID.
 * Supports listing by period (week / month / custom date range) and summary stats.
 *
 * Pattern: VITEST-skip, best-effort, admin SDK — mirrors UserCostStore.
 */
import * as admin from 'firebase-admin';

export type BuildStatus = 'completed' | 'failed' | 'cancelled';

export interface BuildRecord {
  id: string;
  userId: string;
  sessionId: string;
  /** First 80 chars of the user prompt, used as the build title in the UI. */
  title: string;
  createdAt: number;
  durationMs: number;
  /** Amount charged to the user in INR (0 for failed, partial for cancelled). */
  costInr: number;
  /** Full cost before any cancellation discount, in INR. */
  fullCostInr: number;
  status: BuildStatus;
  /** Estimated completion percentage for cancelled builds (0–100). */
  progressPercent: number;
  tier: string;
  fileCount: number;
}

export interface BuildHistoryQuery {
  period?: 'week' | 'month' | 'custom';
  from?: number;   // ms timestamp (inclusive)
  to?: number;     // ms timestamp (inclusive)
  limit?: number;
}

export interface BuildSummary {
  totalBuilds: number;
  completedBuilds: number;
  failedBuilds: number;
  cancelledBuilds: number;
  totalCostInr: number;
}

class UserBuildHistoryStore {
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

  /** Record a completed / failed / cancelled build. Best-effort — never throws. */
  async record(rec: BuildRecord): Promise<void> {
    const db = this.getDb();
    if (!db || !rec.userId) return;
    try {
      await db.collection('user_build_history').doc(rec.id).set(rec);
    } catch { /* best-effort */ }
  }

  /** List builds for a user filtered by a time period or date range. */
  async list(userId: string, opts: BuildHistoryQuery = {}): Promise<BuildRecord[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const { from, to } = this.periodToRange(opts);
      let q: admin.firestore.Query = db
        .collection('user_build_history')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(opts.limit ?? 100);
      if (from) q = q.where('createdAt', '>=', from);
      if (to) q = q.where('createdAt', '<=', to);
      const snap = await q.get();
      return snap.docs.map(d => d.data() as BuildRecord);
    } catch {
      return [];
    }
  }

  /** Summary stats for a user over a period. */
  async getSummary(userId: string, opts: BuildHistoryQuery = {}): Promise<BuildSummary> {
    const records = await this.list(userId, { ...opts, limit: 1000 });
    return records.reduce<BuildSummary>((acc, r) => {
      acc.totalBuilds++;
      if (r.status === 'completed') acc.completedBuilds++;
      else if (r.status === 'failed') acc.failedBuilds++;
      else acc.cancelledBuilds++;
      acc.totalCostInr += r.costInr;
      return acc;
    }, { totalBuilds: 0, completedBuilds: 0, failedBuilds: 0, cancelledBuilds: 0, totalCostInr: 0 });
  }

  private periodToRange(opts: BuildHistoryQuery): { from?: number; to?: number } {
    const now = Date.now();
    if (opts.period === 'week') return { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
    if (opts.period === 'month') {
      const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
      return { from: d.getTime(), to: now };
    }
    return { from: opts.from, to: opts.to };
  }
}

export const userBuildHistoryStore = new UserBuildHistoryStore();
