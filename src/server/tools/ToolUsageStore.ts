/**
 * Daily free-usage counter for the Other AI tools (admin 2026-07-27).
 *
 * Separate from the professionals' counter on purpose: a user talking to Doctor AI all day should not
 * lose their App Debugger runs, and image generation — the one tool with a real per-action cost — needs
 * a tighter allowance than the rest. Each bucket therefore counts on its own.
 *
 * The failure mode mirrors ProfessionalUsageStore exactly: a read fail-OPENS to 0 so a Firestore glitch
 * can never wrongly block a legitimate user, and the increment is best-effort. The worst case is a
 * little free overuse; a wrongly-blocked paying user is the outcome that actually costs us.
 *
 * Collection: `tool_daily_usage` (doc id = `<userId>__<bucket>`)
 */
import * as admin from 'firebase-admin';
import { doc, runTransaction, getServerDb } from '../lib/serverDb';
import { istDayKey } from '../professionals/ProfessionalUsageStore';

/** The metered groups. Deterministic tools (minify, diff, versioning, …) are NOT metered — they cost nothing. */
export type ToolBucket = 'ai_tool' | 'image';

interface ToolUsageDoc {
  userId: string;
  bucket: ToolBucket;
  /** IST calendar day this count belongs to. A different day means the count is stale → 0. */
  date: string;
  count: number;
  updatedAt: string;
}

/** PURE: the document id for one user's bucket. Exported so tests can assert the keying. */
export function usageDocId(userId: string, bucket: ToolBucket): string {
  return `${userId}__${bucket}`;
}

class ToolUsageStore {
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

  /** Free actions used today in this bucket. On no-db/error → 0 (fail-open: never wrongly block). */
  async getTodayCount(userId: string, bucket: ToolBucket, now: number = Date.now()): Promise<number> {
    const db = this.getDb();
    if (!db || !userId) return 0;
    try {
      const snap = await db.collection('tool_daily_usage').doc(usageDocId(userId, bucket)).get();
      if (!snap.exists) return 0;
      const data = snap.data() as ToolUsageDoc | undefined;
      if (!data || data.date !== istDayKey(now)) return 0; // stale day → effectively 0
      return Number.isFinite(data.count) && data.count > 0 ? Math.floor(data.count) : 0;
    } catch {
      return 0;
    }
  }

  /** Atomically record ONE free action in this bucket. Resets when the stored day is stale. Best-effort. */
  async increment(userId: string, bucket: ToolBucket, now: number = Date.now()): Promise<number> {
    const db = this.getDb();
    if (!db || !userId) return 0;
    const today = istDayKey(now);
    const nowIso = new Date(now).toISOString();
    try {
      const ref = doc(db, 'tool_daily_usage', usageDocId(userId, bucket));
      return await runTransaction(db, async (t: any) => {
        const snap = await t.get(ref);
        const data = snap.exists() ? (snap.data() as ToolUsageDoc | undefined) : undefined;
        const base = data && data.date === today && Number.isFinite(data.count) && data.count > 0 ? Math.floor(data.count) : 0;
        const count = base + 1;
        t.set(ref, { userId, bucket, date: today, count, updatedAt: nowIso } as ToolUsageDoc);
        return count;
      });
    } catch {
      return 0;
    }
  }
}

export const toolUsageStore = new ToolUsageStore();
