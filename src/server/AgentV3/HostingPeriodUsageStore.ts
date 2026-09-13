// THE RUNNING TRAFFIC TOTAL FOR ONE PLAN PERIOD — what the overage rule is measured against.
//
// The allowance a user bought is MONTHLY ("5 GB every 30 days") and the billing job runs DAILY, so
// there has to be somewhere to keep the running total. That is this document, and it exists for one
// reason: without it, a daily job can only compare one day against a monthly allowance, which is
// wrong in both directions — nothing is charged until a single day exceeds 5 GB, and then the whole
// allowance is granted again the next day.
//
// 🔒 IT ALSO RECORDS WHAT HAS ALREADY BEEN BILLED, and that is what makes the charge idempotent in
// the way that matters here. The job charges the DIFFERENCE between "GB over the allowance now" and
// "GB already charged for", so a day that runs twice charges the second time for nothing at all.
//
// Keyed by the plan PERIOD, not the calendar month: the allowance resets when the plan renews, which
// is 30 days from whenever it was bought, not on the 1st.
//
// Collection: `hosting_period_usage`   ·   Doc ID: `<userId>_<periodStartISODate>`

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import type { PeriodUsage } from '../lib/hostingOverage';

const COLLECTION = 'hosting_period_usage';

export interface PeriodUsageRecord extends PeriodUsage {
  userId: string;
  /** The plan period this total belongs to, as a date — the allowance resets with it. */
  periodStart: string;
  /** ₹ charged for overage in this period so far. Admin-visible; the user sees ledger rows. */
  inrBilled: number;
  /** ₹ charged but NOT paid — the wallet was empty. Drives the reminder and, eventually, offline. */
  owedInr: number;
  /** When the unpaid debt was first recorded. Cleared when it is paid. */
  owedSince: string | null;
  updatedAt: number;
}

const EMPTY = (userId: string, periodStart: string): PeriodUsageRecord => ({
  userId, periodStart, gbBefore: 0, gbBilled: 0, inrBilled: 0, owedInr: 0, owedSince: null, updatedAt: 0,
});

function docId(userId: string, periodStart: string): string {
  return `${userId}_${periodStart}`;
}

class HostingPeriodUsageStore {
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

  /**
   * This period's totals.
   *
   * 🔒 AN UNREADABLE RECORD RETURNS NULL, NOT AN EMPTY ONE. An empty record means "no traffic yet",
   * which would hand the user their whole allowance a second time and, worse, would make the job
   * re-charge GB it had already charged for. The caller skips the app instead — under-charging by a
   * day, which is the only direction the billing law allows being wrong in.
   */
  async read(userId: string, periodStart: string): Promise<PeriodUsageRecord | null> {
    const db = this.getDb();
    if (!db || !userId || !periodStart) return null;
    try {
      const snap = await db.collection(COLLECTION).doc(docId(userId, periodStart)).get();
      return snap.exists ? { ...EMPTY(userId, periodStart), ...(snap.data() as PeriodUsageRecord) } : EMPTY(userId, periodStart);
    } catch {
      return null;
    }
  }

  /** Record a day's measured traffic and whatever was charged for it. Best-effort. */
  async record(userId: string, periodStart: string, patch: {
    periodGb: number;
    gbBilled: number;
    addInrBilled: number;
    owedInr: number;
    owedSince: string | null;
  }): Promise<void> {
    const db = this.getDb();
    if (!db || !userId || !periodStart) return;
    try {
      await db.collection(COLLECTION).doc(docId(userId, periodStart)).set({
        userId,
        periodStart,
        gbBefore: Math.max(0, Number(patch.periodGb) || 0),
        gbBilled: Math.max(0, Number(patch.gbBilled) || 0),
        inrBilled: admin.firestore.FieldValue.increment(Math.max(0, Number(patch.addInrBilled) || 0)),
        owedInr: Math.max(0, Number(patch.owedInr) || 0),
        owedSince: patch.owedSince,
        updatedAt: Date.now(),
      }, { merge: true });
    } catch (e) {
      // Loud, because a total that stopped moving means the allowance silently resets every day.
      console.error(`[hosting-bill] could not record period usage for ${userId}:`, e);
    }
  }
}

export const hostingPeriodUsageStore = new HostingPeriodUsageStore();
