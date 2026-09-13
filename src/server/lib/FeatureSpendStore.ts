// WHICH FEATURE IS ACTUALLY BEING USED — across every user, per day.
//
// ADMIN 2026-09-13: *"jisse admin yeh dekh sake ki kon sa feature jyada use ho raha hai, kon se
// feacher ko aur strong karna hai, aur jayada kaam karna hai!!"* The per-user breakdown answers
// "where did THIS person's balance go"; this answers the product question behind it.
//
// 🔒 SHARDED BY FEATURE FROM DAY ONE, and that is not premature. `CLAUDE.md`'s SCALE PLAN names the
// exact failure this would otherwise become: Firestore allows roughly ONE sustained write per second
// to a SINGLE document, and a counter that every user's every charge writes into is precisely the
// hot document that breaks first — silently, because a swallowed telemetry failure under-counts
// rather than erroring. One document per feature per day (`2026-09-13_doctor`) divides the write
// rate by the number of features for free, needs no random shard keys, and still reads in one pass.
//
// Best-effort by construction: VITEST-skipped, never throws, and never awaited into a user's
// response. Losing a day of counters is a reporting gap; costing somebody their answer is not.
//
// Collection: `feature_spend` · Doc id: `YYYY-MM-DD_<feature>`

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { WALLET_FEATURES, featureLabel, type WalletFeature } from './walletFeature';

const COLLECTION = 'feature_spend';

export interface FeatureSpendDay {
  feature: WalletFeature;
  label: string;
  inr: number;
  charges: number;
  /** How many DIFFERENT users spent on it — the honest measure of "used", not of "expensive". */
  users: number;
}

/** A day key from the SERVER clock. A device clock can never move a spend bucket. */
export function spendDayKey(nowMs: number = Date.now()): string {
  return new Date(Number.isFinite(nowMs) ? nowMs : 0).toISOString().slice(0, 10);
}

/**
 * Merge one charge into a day's counters. PURE, so the arithmetic is testable without Firestore.
 *
 * ⚠️ `users` counts DISTINCT users, which is why the document keeps a small set of ids rather than a
 * number: a single heavy user would otherwise look exactly like broad adoption, and the admin is
 * deciding which feature to invest in. The set is capped — past the cap the count keeps rising but
 * stops being exact, and `usersExact` says so rather than letting a ceiling masquerade as a total.
 */
export const MAX_TRACKED_USERS = 400;

export function foldFeatureCharge(
  current: Record<string, unknown> | null | undefined,
  input: { inr: number; userId?: string | null },
): { inr: number; charges: number; userIds: string[]; usersOverflow: number; usersExact: boolean } {
  const c = current || {};
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const ids: string[] = Array.isArray(c.userIds) ? (c.userIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const inr = Number.isFinite(input.inr) && input.inr > 0 ? input.inr : 0;

  let userIds = ids;
  let usersOverflow = n(c.usersOverflow);
  const uid = typeof input.userId === 'string' ? input.userId : '';
  if (uid && !ids.includes(uid)) {
    if (ids.length < MAX_TRACKED_USERS) userIds = [...ids, uid];
    else usersOverflow += 1; // may double-count a repeat visitor past the cap — hence `usersExact`
  }

  return {
    inr: Math.round((n(c.inr) + inr) * 100) / 100,
    charges: n(c.charges) + 1,
    userIds,
    usersOverflow,
    usersExact: usersOverflow === 0,
  };
}

class FeatureSpendStore {
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

  /** Fire-and-forget. A transaction because concurrent charges on one feature would otherwise drop counts. */
  async record(feature: WalletFeature, inr: number, userId?: string | null, nowMs: number = Date.now()): Promise<void> {
    const db = this.getDb();
    if (!db || !(inr > 0)) return;
    const date = spendDayKey(nowMs);
    try {
      const ref = db.collection(COLLECTION).doc(`${date}_${feature}`);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const next = foldFeatureCharge(snap.exists ? (snap.data() as Record<string, unknown>) : null, { inr, userId });
        tx.set(ref, { date, feature, ...next, updatedAt: new Date().toISOString() }, { merge: true });
      });
    } catch {
      /* telemetry only — never surfaces, never blocks */
    }
  }

  /** Every feature's totals for one day, biggest first. Returns [] when it cannot be read. */
  async day(date: string): Promise<FeatureSpendDay[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const snaps = await Promise.all(
        WALLET_FEATURES.map((f) => db.collection(COLLECTION).doc(`${date}_${f.id}`).get().catch(() => null)),
      );
      return snaps
        .map((snap, i) => {
          const f = WALLET_FEATURES[i];
          const d = (snap && snap.exists ? snap.data() : null) as Record<string, unknown> | null;
          if (!d) return null;
          const ids = Array.isArray(d.userIds) ? d.userIds.length : 0;
          const overflow = typeof d.usersOverflow === 'number' ? d.usersOverflow : 0;
          return {
            feature: f.id as WalletFeature,
            label: featureLabel(f.id),
            inr: typeof d.inr === 'number' ? d.inr : 0,
            charges: typeof d.charges === 'number' ? d.charges : 0,
            users: ids + overflow,
          };
        })
        .filter((r): r is FeatureSpendDay => r !== null && (r.charges > 0 || r.inr > 0))
        .sort((a, b) => b.inr - a.inr || b.charges - a.charges);
    } catch {
      return [];
    }
  }
}

export const featureSpendStore = new FeatureSpendStore();
