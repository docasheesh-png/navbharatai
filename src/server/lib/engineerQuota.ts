// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Writes engineer_quota (server-only).
import { doc, getDoc, setDoc, getServerDb as getDb } from './serverDb';

/**
 * Per-user daily quota for Engineer AI builds — a real cost guard so a single
 * runaway/abusive user cannot spin up unlimited sandboxes + model calls.
 *
 * Backed by Firestore (`engineer_quota/{userId}__{YYYY-MM-DD}`) so the count is
 * shared across Cloud Run instances and survives restarts. Best-effort: if
 * Firestore is unavailable it fails OPEN (never blocks a legitimate build on an
 * infra hiccup).
 */

function dailyLimit(): number {
  // Explicit kill switch: `off` / `0` / `unlimited` → no cap at all (env-authoritative, instant revert).
  const raw = (process.env.ENGINEER_DAILY_LIMIT || '').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'unlimited') return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * Atomically check + consume one unit of a user's daily Engineer-AI quota.
 * Returns allowed=false when the limit is already reached (without incrementing).
 */
export async function consumeEngineerQuota(userId: string): Promise<QuotaResult> {
  const limit = dailyLimit();
  if (limit <= 0) {
    // Cap disabled (ENGINEER_DAILY_LIMIT=off) → never counts, never blocks.
    return { allowed: true, used: 0, limit: 0 };
  }
  const db = getDb() as any;
  if (!db || !userId) {
    // No DB or no identified user → don't block here (IP rate-limiter still applies).
    return { allowed: true, used: 0, limit };
  }
  const id = `${userId.replace(/[^A-Za-z0-9_-]/g, '_')}__${todayKey()}`;
  const ref = doc(db, 'engineer_quota', id);
  try {
    const snap = await getDoc(ref);
    const used = snap.exists() ? Number(snap.data()?.count || 0) : 0;
    if (used >= limit) {
      return { allowed: false, used, limit };
    }
    await setDoc(ref, { userId, date: todayKey(), count: used + 1, updatedAt: Date.now() }, { merge: true });
    return { allowed: true, used: used + 1, limit };
  } catch {
    // Fail open on Firestore errors — never block a real build on an infra hiccup.
    return { allowed: true, used: 0, limit };
  }
}
