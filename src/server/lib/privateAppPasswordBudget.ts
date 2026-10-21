// A PRIVATE PUBLISHED APP'S PASSWORD HAD NO THROTTLE (found while fixing the admin login's, 2026-10-17).
//
// `/api/nav-store/web/app/:id/open` and `/remix` compare the password a visitor types with the creator's scrypt hash
// and answered "wrong or missing" as often as it was asked — no limiter on the route, no `app.use('/api', …)` above it. A
// creator's password is a human's choice, so unlimited guessing is a real way in (and every guess spends a scrypt
// hash of server CPU). THE CLASS is the same as the admin login's: a credential gate with no throttle. Here the
// throttle is per (app, address), counted in Firestore through the platform's durable limiter so it holds across
// instances. It only counts requests that CARRY a password — the first request, which just asks "is it private?", is free.
//
// Deliberately NOT a per-app global ceiling: that would let one visitor lock every legitimate user out of a creator's app.
import { consumeDurableRate } from './DurableRateLimit';

export const PASSWORD_ATTEMPTS = 20;
export const PASSWORD_WINDOW_MS = 10 * 60_000;

export type ConsumeFn = (name: string, key: string, limit: number, windowMs: number, now: number) => Promise<{ allowed: boolean }>;

/** May this address try another password on this app? Never throws; fail-open (the durable limiter's own rule). */
export async function privateAppPasswordBudget(
  appId: string,
  address: string,
  password: unknown,
  now: number = Date.now(),
  consume: ConsumeFn = consumeDurableRate,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (typeof password !== 'string' || password === '') return { allowed: true, retryAfterSec: 0 }; // not a guess
  try {
    const r = await consume('app-password', `${appId}|${address}`, PASSWORD_ATTEMPTS, PASSWORD_WINDOW_MS, now);
    return r.allowed ? { allowed: true, retryAfterSec: 0 } : { allowed: false, retryAfterSec: Math.ceil((PASSWORD_WINDOW_MS - (now % PASSWORD_WINDOW_MS)) / 1000) };
  } catch {
    return { allowed: true, retryAfterSec: 0 };
  }
}
