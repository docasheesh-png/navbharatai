// Durable home for the "why do builds fail?" ledger — one document per calendar day.
//
// The decision lives in failureLedger.ts (pure, tested); this is only its storage, and it mirrors
// AssistantSpendStore exactly: VITEST-skipped, best-effort, never throws, one doc per day keyed
// 'YYYY-MM-DD', folded in a transaction because several builds finish at once and a read-modify-write
// without one would silently drop counts — which would understate precisely the thing this exists to
// measure.
//
// The day is stamped from the SERVER clock in Asia/Kolkata. A device clock cannot move a
// failure into another day, and a UTC key cannot either: a build that fails at 01:30 IST is
// still that IST calendar day, which is what the admin's "last 7 days" means.
//
// Documents written BEFORE this change are keyed by UTC (`toISOString().slice(0, 10)`).
// A ranking that crosses the deploy can overlap or skip one day. That mismatch is accepted.
//
// 🔒 ADMIN-ONLY DATA. The money in these documents is NavBharatAI's own spend on builds that produced
// nothing; it is not a user's bill and must never reach a user-facing surface.
//
// Collection: `build_failures`   ·   Doc ID: `YYYY-MM-DD` (IST)

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { foldFailure, rankFailures, type FailureDay, type FailureEntry, type FailureRanking } from './failureLedger';

const COLLECTION = 'build_failures';
const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** IST calendar day of `now`, `YYYY-MM-DD`. `en-CA` is the locale that formats that way. */
export function dayKey(now = Date.now()): string {
  return IST_DAY.format(now);
}

/** IST day key of the first day in a window of `days` ending on `now` (inclusive). */
export function cutoffDayKey(now: number, days: number): string {
  return dayKey(now - (days - 1) * 86_400_000);
}

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

  /** Fold one failed build into today's IST document. Best-effort — telemetry never affects a build. */
  async record(entry: FailureEntry): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    const date = dayKey();
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
   * The ranking over the last N IST calendar days, plus whether the read was complete.
   *
   * A date window, not `limit(n)` documents. A quiet day is a day, and skipping it is how a
   * 7-day question starts answering about a month. `fromDay`/`toDay` say which window was asked.
   *
   * 🔒 A READ FAILURE IS NOT "no failures". It returns `complete: false` with an empty ranking, so a
   * Firestore hiccup reads as "we could not tell you" rather than as a perfect week — the same
   * distinction `listWithCompleteness` exists to preserve on the deployment registry.
   */
  async ranking(days = 14): Promise<{ ranking: FailureRanking; complete: boolean; fromDay: string; toDay: string }> {
    const n = Math.max(1, Math.min(365, Math.floor(days)));
    const fromDay = cutoffDayKey(Date.now(), n);
    const toDay = dayKey();
    const db = this.getDb();
    if (!db) return { ranking: rankFailures([]), complete: false, fromDay, toDay };
    try {
      const snap = await db.collection(COLLECTION).where('date', '>=', fromDay).orderBy('date', 'desc').get();
      return { ranking: rankFailures(snap.docs.map((d) => d.data() as FailureDay)), complete: true, fromDay, toDay };
    } catch {
      return { ranking: rankFailures([]), complete: false, fromDay, toDay };
    }
  }
}

export const failureLedgerStore = new FailureLedgerStore();
