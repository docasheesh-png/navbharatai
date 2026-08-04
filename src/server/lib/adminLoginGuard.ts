// Admin-login brute-force lockout (SEC — admin 2026-07-19). The admin login already has a flat
// 5-requests/minute per-IP rate limit; this adds an ESCALATING lockout on top: once an IP crosses a
// failure threshold, each further attempt is refused for a window that GROWS with the failure count
// (1m → 2m → 4m … capped at 30m). This turns admin-password guessing from "5 tries every minute forever"
// into a cost that compounds, without ever risking the real admin:
//   • a CORRECT login RESETS that IP immediately (recordSuccess), so a legitimate admin who mistypes a
//     few times is never stuck once they get it right;
//   • the lockout is per-IP (an attacker locks their OWN IP, not the admin's account), so it can't be
//     used to lock the admin out;
//   • every lock AUTO-EXPIRES — worst case the admin waits out one window;
//   • it is disabled instantly via `ADMIN_LOGIN_LOCKOUT=off` (kill switch, no redeploy of logic needed).
// Pure escalation math is unit-tested; the small in-memory store is bounded by pruning.

/** The escalating lockout duration (ms) for a given cumulative failure count. 0 = no lock yet. Pure. */
export function lockDurationMs(fails: number): number {
  if (fails < FAIL_THRESHOLD) return 0;
  const step = Math.floor(fails / FAIL_THRESHOLD); // 5→1, 10→2, 15→3 …
  return Math.min(BASE_LOCK_MS * 2 ** (step - 1), MAX_LOCK_MS);
}

/** Failures allowed before the FIRST lock kicks in (aligned with the existing 5/min IP limiter). */
export const FAIL_THRESHOLD = 5;
/** First lock window; doubles each threshold step. */
export const BASE_LOCK_MS = 60_000; // 1 min
/** Hard cap so a lock never becomes effectively permanent. */
export const MAX_LOCK_MS = 30 * 60_000; // 30 min
/** Drop an IP's record after this much idle time (memory hygiene; also a natural fail-count decay). */
const IDLE_FORGET_MS = 60 * 60_000; // 1 h
/** Never let the store grow unbounded (admin login is low-traffic, but be safe). */
const MAX_ENTRIES = 10_000;

interface Attempt { fails: number; lockedUntil: number; last: number }
const attempts = new Map<string, Attempt>();

/** Prune records that have been idle past IDLE_FORGET_MS (and hard-cap the map size). */
function prune(now: number): void {
  for (const [ip, a] of attempts) {
    if (now - a.last > IDLE_FORGET_MS) attempts.delete(ip);
  }
  if (attempts.size > MAX_ENTRIES) {
    // Evict the oldest-touched entries first.
    const sorted = [...attempts.entries()].sort((x, y) => x[1].last - y[1].last);
    for (let i = 0; i < sorted.length - MAX_ENTRIES; i++) attempts.delete(sorted[i][0]);
  }
}

/** Is the admin-login lockout enabled? (Kill switch: `ADMIN_LOGIN_LOCKOUT=off`.) */
export function adminLockoutEnabled(): boolean {
  return process.env.ADMIN_LOGIN_LOCKOUT !== 'off';
}

/** Is this IP currently locked? Returns the remaining wait in ms (0 if not locked). Does not mutate. */
export function checkAdminLock(ip: string, now: number = Date.now()): { locked: boolean; retryAfterMs: number } {
  const a = attempts.get(ip);
  if (a && a.lockedUntil > now) return { locked: true, retryAfterMs: a.lockedUntil - now };
  return { locked: false, retryAfterMs: 0 };
}

/** Record a FAILED admin-login attempt for this IP and (re)compute its escalating lock. */
export function recordAdminFail(ip: string, now: number = Date.now()): void {
  const a = attempts.get(ip) ?? { fails: 0, lockedUntil: 0, last: now };
  a.fails += 1;
  a.last = now;
  const dur = lockDurationMs(a.fails);
  if (dur > 0) a.lockedUntil = now + dur;
  attempts.set(ip, a);
  prune(now);
}

/** Record a SUCCESSFUL admin login — clears this IP's failure history immediately. */
export function recordAdminSuccess(ip: string): void {
  attempts.delete(ip);
}

/** Test-only: wipe all state so cases don't leak into one another. */
export function _resetAdminLoginGuard(): void {
  attempts.clear();
}
