// THE ADMIN LOGIN'S THROTTLE, SHARED ACROSS INSTANCES AND NOT KEYED ONLY BY THE ATTACKER'S ADDRESS
// (admin 2026-10-17, "jo kami mili root cause se fix karo").
//
// THE ROOT CAUSE, in one sentence: the platform's most sensitive credential gate kept its throttle state in each
// server process's memory, keyed by the one thing an attacker controls.
//
//   1. PER-INSTANCE STATE. `adminLimiter` (express-rate-limit's MemoryStore) and `adminLoginGuard`'s lockout both live
//      in the memory of ONE Cloud Run instance. With up to 100 instances (`--max-instances`) an attacker gets a
//      fresh 5/min and a fresh lockout per instance, and a restart forgets both. `DurableRateLimit.ts` exists
//      precisely because of this ("the limit does not actually hold") — the admin login was simply never moved onto it.
//   2. ADDRESS-ONLY KEY. Every limit was per address. An attacker with many addresses (a botnet, or just a pool of
//      proxies) never meets any of them, and nothing counted failures against the ONE account being attacked.
//
// THE FIX has two layers, and a rule that keeps the real admin safe:
//   • the per-address failure record and the per-minute count live in Firestore (shared, durable, fail-open);
//   • a GLOBAL ceiling: when failed admin logins across ALL addresses pass a threshold inside a window, addresses the
//     admin has never successfully logged in from are refused until the window ends;
//   • ⚠️ an address that has logged in successfully before is EXEMPT from the global ceiling, so an attacker cannot lock
//     the real admin out by flooding failures (the old module's own principle: "an attacker locks their OWN IP, never
//     the admin's account"). The admin on a brand-new address waits out at most one window.
//
// Addresses are stored only as a keyed hash (HMAC with the admin secret) — never raw. FAIL-OPEN like every limiter
// here: a store that cannot answer leaves the in-memory guard and the per-address limiter in force.
import crypto from 'crypto';
import * as admin from 'firebase-admin';
import { doc, getDoc, setDoc, getServerDb } from './serverDb';
import { FAIL_THRESHOLD, lockDurationMs } from './adminLoginGuard';

export interface SharedAttempt { fails: number; lockedUntil: number; last: number }

/** The storage the guard needs. Every method may throw; the guard treats a throw as "unknown" and fails open. */
export interface SharedGuardStore {
  readAttempt(key: string): Promise<SharedAttempt | null>;
  writeAttempt(key: string, a: SharedAttempt, now: number): Promise<void>;
  clearAttempt(key: string): Promise<void>;
  /** Add one failure to the global window and return the count after. */
  addGlobalFail(windowIndex: number, windowMs: number, now: number): Promise<number>;
  readGlobalFails(windowIndex: number): Promise<number>;
  isKnownAddress(key: string, now: number): Promise<boolean>;
  markKnownAddress(key: string, now: number): Promise<void>;
}

export const GLOBAL_WINDOW_MS = 15 * 60_000;
export const GLOBAL_THRESHOLD_DEFAULT = 30;
export const KNOWN_ADDRESS_TTL_MS = 30 * 24 * 60 * 60_000;
const IDLE_FORGET_MS = 60 * 60_000;

export function globalCeiling(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.ADMIN_LOGIN_GLOBAL_CEILING ?? '').trim().toLowerCase();
  if (raw === 'off') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : GLOBAL_THRESHOLD_DEFAULT;
}

export interface SharedLockVerdict { locked: boolean; retryAfterMs: number; reason?: 'address' | 'global' }

export function createSharedAdminGuard(store: SharedGuardStore | null, secret: string, env: NodeJS.ProcessEnv = process.env) {
  const keyOf = (address: string): string => crypto.createHmac('sha256', secret || 'nbai-admin').update(String(address)).digest('hex').slice(0, 32);
  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };

  return {
    /** Is this address locked, individually or by the global ceiling? Never throws. */
    async check(address: string, now: number = Date.now()): Promise<SharedLockVerdict> {
      if (!store) return { locked: false, retryAfterMs: 0 };
      const key = keyOf(address);
      const a = await safe(store.readAttempt(key), null);
      if (a && a.lockedUntil > now) return { locked: true, retryAfterMs: a.lockedUntil - now, reason: 'address' };
      const ceiling = globalCeiling(env);
      if (ceiling > 0) {
        const idx = Math.floor(now / GLOBAL_WINDOW_MS);
        const fails = await safe(store.readGlobalFails(idx), 0);
        if (fails >= ceiling) {
          // A failed exemption lookup is UNKNOWN, not proof of a foreign address. Fail open on that
          // partial store failure too; confirmed per-address locks above and the local guards remain.
          const known = await safe<boolean | null>(store.isKnownAddress(key, now), null);
          if (known === false) {
            return { locked: true, retryAfterMs: (idx + 1) * GLOBAL_WINDOW_MS - now, reason: 'global' };
          }
        }
      }
      return { locked: false, retryAfterMs: 0 };
    },
    /** One failed attempt: count it against this address (escalating lock) and against the whole account. */
    async recordFail(address: string, now: number = Date.now()): Promise<void> {
      if (!store) return;
      const key = keyOf(address);
      const prev = await safe(store.readAttempt(key), null);
      const fresh = !prev || now - prev.last > IDLE_FORGET_MS;
      const fails = (fresh ? 0 : prev!.fails) + 1;
      const dur = lockDurationMs(fails);
      await safe(store.writeAttempt(key, { fails, last: now, lockedUntil: dur > 0 ? now + dur : 0 }, now), undefined);
      if (globalCeiling(env) > 0) await safe(store.addGlobalFail(Math.floor(now / GLOBAL_WINDOW_MS), GLOBAL_WINDOW_MS, now), 0);
    },
    /** A correct login: forget this address's failures and remember it as one the admin really uses. */
    async recordSuccess(address: string, now: number = Date.now()): Promise<void> {
      if (!store) return;
      const key = keyOf(address);
      await safe(store.clearAttempt(key), undefined);
      await safe(store.markKnownAddress(key, now), undefined);
    },
  };
}
export { FAIL_THRESHOLD };

// ───────────────────────────── the Firestore store ─────────────────────────────
const COLLECTION = 'admin_login_guard_v1';

/** The shared store, or null when there is no database (a dev machine, a test) — the guard then does nothing and the
 *  in-memory guard stays the only layer, exactly as before. Every document carries `expireAt` for a TTL policy. */
export function firestoreSharedStore(): SharedGuardStore | null {
  if (process.env.VITEST) return null;
  const db = getServerDb() as any;
  if (!db) return null;
  const ts = (ms: number) => admin.firestore.Timestamp.fromDate(new Date(ms));
  return {
    async readAttempt(key) {
      const s = await getDoc(doc(db, COLLECTION, `a_${key}`));
      const d = s.data();
      return d ? { fails: Number(d.fails) || 0, lockedUntil: Number(d.lockedUntil) || 0, last: Number(d.last) || 0 } : null;
    },
    async writeAttempt(key, a, now) {
      await setDoc(doc(db, COLLECTION, `a_${key}`), { ...a, expireAt: ts(now + 2 * IDLE_FORGET_MS) }, { merge: true });
    },
    async clearAttempt(key) {
      await setDoc(doc(db, COLLECTION, `a_${key}`), { fails: 0, lockedUntil: 0, last: 0, expireAt: ts(Date.now() + IDLE_FORGET_MS) }, { merge: true });
    },
    async addGlobalFail(idx, windowMs, now) {
      const ref = doc(db, COLLECTION, `g_${idx}`);
      await setDoc(ref, { count: admin.firestore.FieldValue.increment(1), updatedAt: now, expireAt: ts((idx + 2) * windowMs) }, { merge: true });
      return Number((await getDoc(ref)).data()?.count || 0);
    },
    async readGlobalFails(idx) {
      return Number((await getDoc(doc(db, COLLECTION, `g_${idx}`))).data()?.count || 0);
    },
    async isKnownAddress(key, now) {
      const d = (await getDoc(doc(db, COLLECTION, `k_${key}`))).data();
      return !!d && Number(d.until) > now;
    },
    async markKnownAddress(key, now) {
      await setDoc(doc(db, COLLECTION, `k_${key}`), { until: now + KNOWN_ADDRESS_TTL_MS, expireAt: ts(now + KNOWN_ADDRESS_TTL_MS) }, { merge: true });
    },
  };
}
