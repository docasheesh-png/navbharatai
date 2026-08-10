/**
 * ADMIN AUTHENTICATION — the one gate (audit finding #3, 2026-08-09).
 *
 * WHAT THE AUDIT FOUND. The admin panel is properly protected: a timestamped HMAC token with a TTL, a
 * constant-time signature compare, and TOTP MFA on login. But that gate lived as a closure INSIDE
 * `registerAdminRoutes`, so it could not be imported — and two other route files, needing an admin
 * check, hand-rolled their own:
 *
 *     function adminOk(req) {
 *       return !!process.env.ADMIN_PASSWORD && req.query.admin === process.env.ADMIN_PASSWORD;
 *     }
 *
 * identical in `health.ts` and `observability.ts`. Four real problems, not one:
 *
 *   1. **The admin PASSWORD travels in the URL.** Query strings land in Cloud Run access logs, browser
 *      history, `Referer` headers and every proxy in between. The one credential that (with MFA)
 *      protects the whole admin panel was being written to logs on every request.
 *   2. **`===` on a secret** — not constant-time, while `safeStrEqual` existed six lines away in the
 *      module this was copied from.
 *   3. **No TTL, no MFA, no rate limit.** A password recovered from a log grants these endpoints
 *      forever, whereas a real admin token expires.
 *   4. **No `adminCredential()` normalisation.** A Cloud Run value with a trailing newline makes these
 *      endpoints 403 forever while the admin panel keeps working — a silent split-brain.
 *
 * What sat behind it: observability traces, metrics, error feeds, DORA and LLM telemetry — and
 * `POST /api/admin/backup/firestore`, which triggers a real Firestore export.
 *
 * THE ROOT CAUSE IS THE SAME ONE AS FINDING #2: a security primitive that could not be imported gets
 * re-typed, and the copy is always weaker than the original. So the primitives live here, in a module
 * with no route dependencies, and `routes/admin.ts` re-exports them for its existing callers.
 */

import crypto from 'crypto';
import type { Request } from 'express';

/** Constant-time string compare. Length is not secret; content is. */
export function safeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Admin session lifetime. Default 30 days — long enough not to log the admin out mid-work, but no
 * longer INFINITE: a leaked token expires instead of granting permanent access. Env-tunable
 * (`ADMIN_TOKEN_TTL_HOURS`), clamped to a sane [1h, 365d].
 */
export function adminTokenTtlMs(rawHours?: string): number {
  const h = Number(rawHours);
  const hours = Number.isFinite(h) && h > 0 ? h : 720; // 720h = 30 days
  return Math.min(Math.max(hours, 1), 365 * 24) * 60 * 60 * 1000;
}

/**
 * Mint a TIME-STAMPED admin token: `<issuedAtMs>.<HMAC(pass, "admin:v2:<user>:<issuedAtMs>")>`. The
 * issued-at is part of the signed payload, so it cannot be forged forward. Pure.
 */
export function mintAdminToken(pass: string, username: string, issuedAtMs: number): string {
  const sig = crypto.createHmac('sha256', pass).update(`admin:v2:${username}:${issuedAtMs}`).digest('hex');
  return `${issuedAtMs}.${sig}`;
}

/**
 * Verify a timestamped admin token: signature must match AND the token must be inside the TTL. A
 * malformed / legacy (dotless) / expired token fails — the admin logs in again. Constant-time
 * signature compare. Pure.
 */
export function verifyAdminTokenValue(token: string, pass: string, username: string, nowMs: number, ttlMs: number): boolean {
  if (!token || !pass) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false; // legacy static / malformed → must re-login
  const issuedAt = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
  if (nowMs - issuedAt > ttlMs) return false; // expired
  if (issuedAt - nowMs > 60_000) return false; // issued in the future (clock skew tolerance) → reject
  const expected = crypto.createHmac('sha256', pass).update(`admin:v2:${username}:${issuedAt}`).digest('hex');
  return safeStrEqual(sig, expected);
}

/**
 * Normalise an admin credential read from the environment. Cloud Run / console / gcloud frequently
 * store a value with a trailing newline, stray whitespace or wrapping quotes; if login and
 * token-verification disagree on that, login can succeed while every later call 403s (they would HMAC
 * different keys). Trimming + stripping one layer of surrounding quotes on BOTH sides keeps the
 * issued token and the verifier consistent.
 */
export function adminCredential(raw: string | undefined, fallback = ''): string {
  const norm = (v: string): string => v.trim().replace(/^['"]([\s\S]*)['"]$/, '$1').trim();
  return norm(String(raw ?? '')) || norm(fallback);
}

export const adminUsername = (): string => adminCredential(process.env.ADMIN_USERNAME, 'aashishcpmt09');
export const adminPassword = (): string => adminCredential(process.env.ADMIN_PASSWORD, '');

/**
 * Is this request carrying a valid admin session? THE check every admin-gated route uses.
 *
 * 🔒 The token is read from the `x-admin-token` HEADER and never from the query string or the body.
 * That is the whole point of this module: a credential in a URL is a credential in the logs. A route
 * that needs an admin gate calls this — it does not invent one.
 */
export function adminRequestOk(req: Request): boolean {
  const header = req.headers['x-admin-token'];
  const token = typeof header === 'string' ? header : '';
  if (!token) return false;
  return verifyAdminTokenValue(token, adminPassword(), adminUsername(), Date.now(), adminTokenTtlMs(process.env.ADMIN_TOKEN_TTL_HOURS));
}
