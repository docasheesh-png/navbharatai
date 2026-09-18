// THE GUARD THAT MAKES A DAILY CHARGE HAPPEN EXACTLY ONCE (ROADMAP §11 slice 2.1).
//
// 🔴 `create`, NEVER `set`. Every other store in this codebase writes with `{ merge: true }`, because
// re-writing the same telemetry is harmless. Here it is the opposite: this document IS the proof that
// a real person's wallet has already been debited for this app's this day, and a `set` would happily
// overwrite that proof and let the next run charge them again. Firestore's `create` fails when the
// document exists, and that failure is the feature.
//
// 🔒 THE RESERVATION IS WRITTEN BEFORE THE WALLET MOVES, and that ordering is deliberate in the
// direction that can only ever UNDER-charge. If the reservation lands and the debit then fails, the
// day is skipped and NavBharatAI absorbs one day of one app's hosting — recorded, visible in the
// admin report, and recoverable by hand. The reverse order risks charging somebody twice for the same
// day, which is the one outcome the billing law never permits. When in doubt, we eat it.
//
// 🔴 IT IS KEYED BY OWNER SINCE 2026-09-13, NOT BY APP, AND IT IS NOT OPTIONAL. Billing moved to a
// per-owner traffic allowance, and the running total it bills against is ACCUMULATED — so a job that
// ran twice on the same day would add the same day's GB to that total twice, and the user would be
// charged for traffic that never happened. The old per-app `create` guard was what made a re-run
// harmless; keeping it, re-keyed, is what keeps the new model honest.
//
// Collection: `hosting_billing`   ·   Doc ID: `<ownerId>_<YYYY-MM-DD>`

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { hostingBillKey } from './hostingBillingDay';

const COLLECTION = 'hosting_billing';

export interface HostingBillRecord {
  /** The OWNER this day was processed for — the allowance and the debt are both theirs. */
  subject: string;
  day: string;
  userId: string;
  /** ₹ reserved for this app-day. */
  billedInr: number;
  /** Our own measured cost before markup, in USD. ADMIN-only. */
  costUsd: number;
  /** Did the wallet debit actually land? False ⇒ we absorbed this day and it is visible. */
  debited: boolean;
  reservedAt: number;
}

class HostingBillingStore {
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
   * Claim this app-day. TRUE means the claim is ours and the caller should debit; FALSE means either
   * somebody already billed it or we could not write the guard.
   *
   * 🔒 A DATABASE ERROR RETURNS FALSE — the ONE fail-CLOSED store on this path, and the opposite of
   * `jobLease`, which runs the job anyway when it cannot read its lease. The asymmetry is the point:
   * a purge that runs twice costs reads, while a charge that runs twice takes money from a real
   * person twice. Not billing a day we could not guard is a cost we can carry; billing it twice is
   * not something we can hand back invisibly.
   */
  async claim(rec: Omit<HostingBillRecord, 'reservedAt' | 'debited'>): Promise<boolean> {
    const db = this.getDb();
    if (!db || !rec.subject || !rec.day) return false;
    try {
      await db.collection(COLLECTION).doc(hostingBillKey(rec.subject, rec.day)).create({
        ...rec, debited: false, reservedAt: Date.now(),
      } satisfies HostingBillRecord);
      return true;
    } catch {
      // ALREADY_EXISTS (already billed) and a genuine write failure are both "do not charge". They are
      // not distinguished because the ACTION is the same, and guessing which one it was — then
      // charging on the guess — is exactly the risk this guard exists to remove.
      return false;
    }
  }

  /** Record that the debit really landed. Best-effort: the claim above is what prevents a re-charge. */
  async markDebited(subject: string, day: string, tokensDebited: number): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      // An UPDATE, never a merge-set: the claim above CREATED this doc, and a stamp must never be the
      // first thing written under a bill key — a minted `{ debited: true }` would make the next claim's
      // `create` fail and silently absorb a day (the DeploymentStore.setStatus class, 2026-09-18).
      await db.collection(COLLECTION).doc(hostingBillKey(subject, day)).update(
        { debited: true, tokensDebited, debitedAt: Date.now() },
      );
    } catch { /* the money moved; a telemetry write failing must not undo that fact */ }
  }

  /**
   * Days we RESERVED but never managed to debit — apps NavBharatAI ended up hosting for free.
   *
   * ⚠️ IT SCANS THE MOST RECENT RECORDS AND FILTERS IN MEMORY, rather than asking Firestore for
   * `debited == false` ordered by time. That pairing is an equality filter chained into an `orderBy`
   * on a different field, which needs a composite index this project does not create — and
   * `firestoreIndexSafe` fails CI for exactly that shape, because such a query does not error in a
   * test, it errors in production on the day somebody opens the screen.
   *
   * 🔒 SO THIS IS "the absorbed days among the last N records", NOT "every absorbed day", and the
   * caller is told which it got. An older absorbed day past the scan window is invisible here rather
   * than silently absent from a list that looks complete.
   */
  async absorbed(scan = 200): Promise<{ rows: HostingBillRecord[]; scanned: number; complete: boolean }> {
    const db = this.getDb();
    if (!db) return { rows: [], scanned: 0, complete: false };
    const limit = Math.max(1, Math.min(500, scan));
    try {
      const snap = await db.collection(COLLECTION).orderBy('reservedAt', 'desc').limit(limit).get();
      const all = snap.docs.map((d) => d.data() as HostingBillRecord);
      return { rows: all.filter((r) => r.debited === false), scanned: all.length, complete: all.length < limit };
    } catch {
      return { rows: [], scanned: 0, complete: false };
    }
  }
}

export const hostingBillingStore = new HostingBillingStore();
