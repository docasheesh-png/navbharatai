// ONLINE ROYALE — THE DAILY MATCH-START CAP, SHARED BY EVERY INSTANCE (Q-3392, 2026-11-26).
//
// The cap (`QUOTAS.MAX_MATCHES_PER_APP_PER_DAY`) used to be a Map in one Cloud Run instance's memory, so with N
// instances an app could start N × 300 matches a day. This asks one shared counter instead: the durable limiter's
// own Firestore window (`DurableRateLimit.firestoreRateCounter` — an atomic `increment(1)`, then a read), keyed per
// app per UTC day (`windowKey` with a 24 h window: floor(now / 86 400 000) is the UTC day), in `rate_limits_v1`.
//
// WHY NOT A NEW COPY: NavData's daily quota (`navStoreWebData.ts`) does its count inside a transaction that also
// guards the app's total rows, so it is not a reusable helper; the durable limiter's counter is exactly "count one
// unit in a shared window, never let a burst through late", already tested for the concurrent-burst case.
//
// WHY NO SHARDING AND NO LOCAL BATCHING: the document only takes a write when an instance is about to START a
// match. Accepted starts are capped at 300 per app per day (≈ 0.003 writes/s sustained — SCALE_PLAN §1's ~1/s per
// document is three hundred times higher), and refused ones stop at one per instance per day, because the service
// remembers "full today" locally after the first refusal. The burst rate is bounded too: one claim per app at a
// time per instance, and each instance runs at most 5 rooms per app. Batching starts locally would let an
// instance start matches it had not yet counted, which is the over-cap the shared counter exists to prevent.
//
// INCREMENT-THEN-READ: two instances racing the last slot both increment, and the one that reads a count above
// the cap is refused — at the boundary a start can be refused one early, never let through one late.
//
// EXPIRY: every write sets `expireAt` (a day after the UTC day ends). The TTL policy on `rate_limits_v1.expireAt`
// that deletes them is one console step only the admin can take (BUILD_REPORT_QUEUE Q-809); until then the
// documents stay (one per app that played online per day — small).

import { consumeWithStore, firestoreRateCounter, type RateCounterStore } from '../DurableRateLimit';
import { getServerDb } from '../serverDb';

export const DAY_MS = 86_400_000;
export const DAILY_START_COUNTER = 'royale-online-start';

/** ok: this start is counted and may go · full: the shared count is over the cap · unavailable: the store did not answer. */
export type StartClaim = 'ok' | 'full' | 'unavailable';
export type ClaimDailyStart = (appId: string, cap: number, now: number) => Promise<StartClaim>;

/** Build a claimer over any counter store (Firestore in production, a shared fake in tests). */
export function dailyStartClaimer(storeFor: (appId: string, now: number) => RateCounterStore | null): ClaimDailyStart {
  return async (appId, cap, now) => {
    const store = storeFor(appId, now);
    if (!store) return 'unavailable';
    const r = await consumeWithStore(store, cap);
    if (r.unavailable) return 'unavailable';
    return r.allowed ? 'ok' : 'full';
  };
}

/** The production claimer: the shared Firestore window. No database handle ⇒ 'unavailable' (never "allowed"). */
export const claimDailyStartInFirestore: ClaimDailyStart = dailyStartClaimer((appId, now) => {
  const db = getServerDb();
  return db ? firestoreRateCounter(db, DAILY_START_COUNTER, appId, DAY_MS, now) : null;
});
