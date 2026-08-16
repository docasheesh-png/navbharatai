/**
 * Per-build history records for the "My Profile" usage history feature.
 *
 * Stores one document per build in `user_build_history`, keyed by a random UUID.
 * Supports listing by period (week / month / custom date range) and summary stats.
 *
 * Pattern: VITEST-skip, best-effort, admin SDK — mirrors UserCostStore.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { listEqNewestFirst } from './firestoreIndexSafe';

/**
 * Upper bound on documents read for one history listing.
 *
 * Above the default index-safe cap because `getSummary` asks for 1000 records and its totals would
 * be wrong — quietly, in the user's own cost figures — if the read stopped short of the period it
 * claims to summarise.
 */
const HISTORY_FETCH_CAP = 1000;

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
        this.db = getServerDb();
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

  /**
   * List builds for a user filtered by a time period or date range.
   *
   * The query is deliberately a SINGLE equality filter on `userId`, with the date range and the
   * newest-first ordering applied in memory. Chaining `.orderBy('createdAt')` or a `createdAt`
   * range onto the `userId` filter makes this a composite-index query, and this project has no
   * deployed composite indexes (`firestore.indexes.json` is not referenced by `firebase.json` and
   * no pipeline applies it). The old version did exactly that and swallowed the resulting
   * FAILED_PRECONDITION into `return []` — so a user with a full build history was shown an empty
   * one, which is a worse outcome than an error because nobody reports it as a bug.
   *
   * `HISTORY_FETCH_CAP` bounds the read: a user past that many builds sees their most recent ones,
   * never a silently truncated arbitrary subset, because the sort happens after the fetch.
   */
  async list(userId: string, opts: BuildHistoryQuery = {}): Promise<BuildRecord[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const { from, to } = this.periodToRange(opts);
      const rows = await listEqNewestFirst<BuildRecord>(
        db.collection('user_build_history'),
        [['userId', userId]],
        'createdAt',
        HISTORY_FETCH_CAP,
        HISTORY_FETCH_CAP,
      );
      const inRange = rows.filter((r) => {
        const at = typeof r.createdAt === 'number' ? r.createdAt : 0;
        if (from && at < from) return false;
        if (to && at > to) return false;
        return true;
      });
      return inRange.slice(0, opts.limit ?? 100);
    } catch (e) {
      // A single-field query needs no index, so reaching here means the database itself is
      // unreachable — not a missing index. Say so in the log instead of failing mute.
      console.warn('[UserBuildHistoryStore] list failed:', (e as Error)?.message || e);
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
