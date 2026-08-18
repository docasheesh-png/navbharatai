/**
 * A2 — how many terminal SECONDS a user has spent today (admin decision 2026-08-18: free, 30 min/day).
 *
 * Deliberately its own store rather than a bucket on ToolUsageStore: that one counts ACTIONS, this
 * counts elapsed seconds, and pretending "count" means both would leave a field whose meaning depends
 * on which caller you happen to be reading. What IS shared is the thing that genuinely is one concept —
 * `istDayKey`, imported rather than re-derived, so "which day is it" can never disagree between the two.
 *
 * FAILURE MODE, matching the stores it mirrors: a read fail-OPENS to 0, so a Firestore glitch can never
 * wrongly lock a legitimate user out of their terminal, and the increment is best-effort. The worst case
 * is a little free overuse — bounded anyway by the sandbox's own idle reaper — while a wrongly-blocked
 * user is the outcome that actually costs us.
 *
 * Collection: `terminal_daily_usage` (doc id = userId)
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { istDayKey } from '../professionals/ProfessionalUsageStore';

interface TerminalUsageDoc {
  userId: string;
  /** IST calendar day this total belongs to. A different day means the total is stale → 0. */
  date: string;
  seconds: number;
  updatedAt: string;
}

class TerminalUsageStore {
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

  /** Seconds used today. No db / error / stale day → 0 (fail-open: never wrongly block). */
  async getTodaySeconds(userId: string, now: number = Date.now()): Promise<number> {
    const db = this.getDb();
    if (!db || !userId) return 0;
    try {
      const snap = await db.collection('terminal_daily_usage').doc(userId).get();
      if (!snap.exists) return 0;
      const data = snap.data() as TerminalUsageDoc | undefined;
      if (!data || data.date !== istDayKey(now)) return 0; // yesterday's total is not today's
      return typeof data.seconds === 'number' && data.seconds > 0 ? Math.floor(data.seconds) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Add elapsed seconds to today's total. Best-effort; never throws.
   *
   * Uses a transaction because several tabs can hold terminals on the same account at once, and a
   * read-modify-write would let two concurrent accruals overwrite each other — quietly handing the user
   * unlimited time, which is the exact liability this whole feature exists to bound.
   */
  async addSeconds(userId: string, seconds: number, now: number = Date.now()): Promise<void> {
    const db = this.getDb();
    const add = Math.floor(seconds);
    if (!db || !userId || !Number.isFinite(add) || add <= 0) return;
    const ref = db.collection('terminal_daily_usage').doc(userId);
    const today = istDayKey(now);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? (snap.data() as TerminalUsageDoc | undefined) : undefined;
        const base = data && data.date === today && typeof data.seconds === 'number' ? data.seconds : 0;
        tx.set(ref, {
          userId,
          date: today,
          seconds: base + add,
          updatedAt: new Date(now).toISOString(),
        } satisfies TerminalUsageDoc);
      });
    } catch {
      /* best-effort — a metering failure must never break someone's terminal */
    }
  }
}

export const terminalUsageStore = new TerminalUsageStore();
