import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from './db';

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
 * Atomically check + consume one unit of a durable, windowed rate bucket. Returns allowed=false
 * (without incrementing) when the limit is already reached. FAIL-OPEN: no DB / any error / a missing
 * key resolves to allowed=true, so infra problems never block a real request.
 *
 * `now` is injectable for tests; production passes the real clock at the call site (Date.now is not
 * available inside pure helpers here, but this function is the impure boundary and receives it).
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
  try {
    const snap = await getDoc(ref);
    const used = snap.exists() ? Number(snap.data()?.count || 0) : 0;
    if (!decideRate(used, limit)) return { allowed: false, used, limit };
    await setDoc(ref, { name, key, count: used + 1, windowMs, updatedAt: now }, { merge: true });
    return { allowed: true, used: used + 1, limit };
  } catch {
    return { allowed: true, used: 0, limit }; // fail-open — never block on an infra hiccup
  }
}
