// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Writes durable rate-limit docs (server-only).
import * as admin from 'firebase-admin';
import { doc, getDoc, setDoc, getServerDb as getDb } from './serverDb';

// SECURITY Phase 1.4 (admin-approved 2026-07-07) — DURABLE rate limiting.
//
// The in-memory limiter (`_rateBuckets` in authMiddleware.ts) is per-INSTANCE and resets on every
// Cloud Run cold start, so on `min-instances=0` a caller bypasses the limit simply by landing on a
// fresh instance or waiting for a recycle — the limit does not actually hold. This module keeps the
// count in Firestore (windowed doc), shared across instances and durable across restarts, so the
// limit is REAL. Plus a GLOBAL anon ceiling: a single shared bucket that caps total anonymous volume
// platform-wide, so a botnet rotating IPs still cannot exceed the whole-platform anon budget.
//
// Same discipline as consumeEngineerQuota / the diagnostics store: VITEST-skipped, bounded, and
// FAIL-OPEN — a Firestore hiccup NEVER blocks a legitimate request (the fast in-memory limiter and
// the Phase-1.3 sign-in gate remain in force regardless).

const COLLECTION = 'rate_limits_v1';

/** Deterministic per-window document id. Pure — the window index is floor(now / windowMs), so every
 *  caller in the same wall-clock window shares one counter, and it rolls over automatically. */
export function windowKey(name: string, key: string, now: number, windowMs: number): string {
  const safe = `${name}__${key}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
  const bucket = Math.floor(now / Math.max(1, windowMs));
  return `${safe}__${bucket}`;
}

/** Pure allow decision: a request is allowed while the pre-increment count is below the limit. */
export function decideRate(usedBefore: number, limit: number): boolean {
  return usedBefore < limit;
}

export interface DurableRateResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * The decision AFTER an atomic increment: allowed while the incremented count is within the limit. PURE.
 *
 * Paired with `consumeDurableRate`, which increments FIRST and reads the result. Two requests can no longer both
 * read "count = limit - 1" and both pass, which is what the old read-then-write did (audit 2026-10-11, D9): every
 * concurrent burst under-counted, on the very limits — build, workspace, OTP — that exist for bursts. At the exact
 * boundary a burst may now be refused one request early; it is never let through one request late.
 */
export function decideAfterIncrement(countAfter: number, limit: number): boolean {
  return countAfter <= limit;
}

/** When a window's counter may be deleted: one day after the window ends (a Firestore TTL policy reads it). PURE. */
export function windowExpiry(now: number, windowMs: number): Date {
  const w = Math.max(1, windowMs);
  return new Date((Math.floor(now / w) + 1) * w + 24 * 60 * 60 * 1000);
}

/** The two storage calls the limiter needs — injectable so the concurrency rule is testable without Firestore. */
export interface RateCounterStore {
  /** Add one to the window's counter and return the count AFTER the add. Atomic per document. */
  incrementAndRead(): Promise<number>;
}

/** Consume one unit through a store. FAIL-OPEN on any store error, like the rest of this module. */
export async function consumeWithStore(store: RateCounterStore, limit: number): Promise<DurableRateResult> {
  try {
    const used = await store.incrementAndRead();
    return { allowed: decideAfterIncrement(used, limit), used, limit };
  } catch {
    return { allowed: true, used: 0, limit }; // fail-open — never block on an infra hiccup
  }
}

/**
 * Atomically consume one unit of a durable, windowed rate bucket: an `increment(1)` (atomic on the document,
 * whatever else is incrementing it) followed by a read of the result. FAIL-OPEN: no DB / any error / a missing
 * key resolves to allowed=true, so infra problems never block a real request.
 *
 * Each counter carries `expireAt` (a day after its window), so a Firestore TTL policy on
 * `rate_limits_v1.expireAt` deletes old windows; without that policy the collection only grows.
 *
 * `now` is injectable for tests; production passes the real clock at the call site.
 */
export async function consumeDurableRate(
  name: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<DurableRateResult> {
  if (process.env.VITEST || !name || !key || !(limit > 0)) return { allowed: true, used: 0, limit };
  const db = getDb() as any;
  if (!db) return { allowed: true, used: 0, limit };
  const ref = doc(db, COLLECTION, windowKey(name, key, now, windowMs));
  return consumeWithStore({
    async incrementAndRead() {
      await setDoc(ref, {
        name, key, windowMs, updatedAt: now,
        count: admin.firestore.FieldValue.increment(1),
        expireAt: admin.firestore.Timestamp.fromDate(windowExpiry(now, windowMs)),
      }, { merge: true });
      const snap = await getDoc(ref);
      return Number(snap.data()?.count || 0);
    },
  }, limit);
}
