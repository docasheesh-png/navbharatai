/**
 * Professional daily free-usage counter (admin 2026-07-15) — how many FREE professional messages a
 * non-subscriber has used TODAY (across all professionals). The counter resets each IST calendar day.
 *
 * Best-effort + VITEST-skip, mirroring UserProfileStore, but with a QUOTA-safe failure mode: on any
 * Firestore failure the read fail-OPENS to 0 (the user keeps their free messages — a quota glitch must
 * never block a legitimate user) and the increment is best-effort. Worst case is a little free overuse,
 * never a wrongly-blocked user.
 *
 * Collections: `professional_daily_usage` (messages) and `professional_exam_usage` (exam questions),
 * doc id = userId in both.
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

  /** One store per allowance: the chat messages and the exam questions are counted SEPARATELY (admin
   *  2026-09-23), so neither can spend the other, and neither write can clobber the other's document. */
  constructor(private readonly collection: string) {}

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
      const snap = await db.collection(this.collection).doc(userId).get();
      if (!snap.exists) return 0;
      const data = snap.data() as UsageDoc | undefined;
      if (!data || data.date !== istDayKey(now)) return 0; // stale day → effectively 0
      return Number.isFinite(data.count) && data.count > 0 ? Math.floor(data.count) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Atomically record `by` (default ONE) free uses today and return the new count. Resets when the
   * stored day is stale. Best-effort: a failure returns 0 without throwing.
   */
  async increment(userId: string, now: number = Date.now(), by: number = 1): Promise<number> {
    const db = this.getDb();
    const step = Number.isFinite(by) && by > 0 ? Math.floor(by) : 0;
    if (!db || !userId || step === 0) return 0;
    const today = istDayKey(now);
    const nowIso = new Date(now).toISOString();
    try {
      const ref = doc(db, this.collection, userId);
      return await runTransaction(db, async (t: any) => {
        const snap = await t.get(ref);
        const data = snap.exists() ? (snap.data() as UsageDoc | undefined) : undefined;
        const base = data && data.date === today && Number.isFinite(data.count) && data.count > 0 ? Math.floor(data.count) : 0;
        const count = base + step;
        t.set(ref, { userId, date: today, count, updatedAt: nowIso } as UsageDoc);
        return count;
      });
    } catch {
      return 0;
    }
  }
}

export const professionalUsageStore = new ProfessionalUsageStore('professional_daily_usage');

/** Free Exam-mode QUESTIONS used today (IST) — a separate allowance from the chat messages. */
export const professionalExamUsageStore = new ProfessionalUsageStore('professional_exam_usage');
