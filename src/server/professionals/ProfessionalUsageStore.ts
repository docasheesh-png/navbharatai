/**
 * Professional daily free-usage counter (admin 2026-07-15) — how many FREE professional messages a
 * non-subscriber has used TODAY (across all professionals). The counter resets each IST calendar day.
 *
 * Best-effort + VITEST-skip, mirroring UserProfileStore, but with a QUOTA-safe failure mode: on any
 * Firestore failure the read fail-OPENS to 0 (the user keeps their free messages — a quota glitch must
 * never block a legitimate user) and the increment is best-effort. Worst case is a little free overuse,
 * never a wrongly-blocked user.
 *
 * Collection: `professional_daily_usage` (doc id = userId)
 */
import * as admin from 'firebase-admin';
import { doc, runTransaction } from '../lib/serverDb';
import { getServerDb } from '../lib/serverDb';

interface UsageDoc {
  userId: string;
  /** IST calendar day this count belongs to, 'YYYY-MM-DD'. A different day means the count is stale → 0. */
  date: string;
  count: number;
  updatedAt: string;
}

/** PURE: the IST (Asia/Kolkata) calendar-day key 'YYYY-MM-DD' for a timestamp. The quota is a per-day
 *  allowance in the user's (India) day, so the reset boundary must be IST, not UTC. */
export function istDayKey(now: number = Date.now()): string {
  // en-CA yields 'YYYY-MM-DD'; forcing the IST timezone gives the Indian calendar day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

class ProfessionalUsageStore {
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

  /** Free messages used today (IST). On no-db/error → 0 (fail-open: never wrongly block a user). */
  async getTodayCount(userId: string, now: number = Date.now()): Promise<number> {
    const db = this.getDb();
    if (!db || !userId) return 0;
    try {
      const snap = await db.collection('professional_daily_usage').doc(userId).get();
      if (!snap.exists) return 0;
      const data = snap.data() as UsageDoc | undefined;
      if (!data || data.date !== istDayKey(now)) return 0; // stale day → effectively 0
      return Number.isFinite(data.count) && data.count > 0 ? Math.floor(data.count) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Atomically record ONE free message used today and return the new count. Resets to 1 when the stored
   * day is stale. Best-effort: a failure returns the pre-increment estimate + 1 without throwing.
   */
  async increment(userId: string, now: number = Date.now()): Promise<number> {
    const db = this.getDb();
    if (!db || !userId) return 0;
    const today = istDayKey(now);
    const nowIso = new Date(now).toISOString();
    try {
      const ref = doc(db, 'professional_daily_usage', userId);
      return await runTransaction(db, async (t: any) => {
        const snap = await t.get(ref);
        const data = snap.exists() ? (snap.data() as UsageDoc | undefined) : undefined;
        const base = data && data.date === today && Number.isFinite(data.count) && data.count > 0 ? Math.floor(data.count) : 0;
        const count = base + 1;
        t.set(ref, { userId, date: today, count, updatedAt: nowIso } as UsageDoc);
        return count;
      });
    } catch {
      return 0;
    }
  }
}

export const professionalUsageStore = new ProfessionalUsageStore();
