// THE CALLER'S ADDRESS, READ FROM THE ONE PLACE A CALLER CANNOT WRITE (security checklist, 2026-10-04).
//
// navbharatai.com resolves to Google's Cloud Run front end (216.239.38.21), which APPENDS the address it
// saw to X-Forwarded-For. So in "a, b, c" only the LAST entry was written by Google; everything before
// it is whatever the caller sent. Reading the FIRST entry — which is what `req.ip` returned while the
// server ran `app.set('trust proxy', true)`, and what three routes parsed by hand — let anyone choose
// their own address with one header, and so walk past every per-address limit: the admin login
// lockout, the OTP send limit (real SMS money), the adaptive bot guard and the auth rate limits.
//
// `guestDailyQuota.ts` found this on 2026-09-27 and fixed it for itself only. This module is that fix
// made the ONE definition, and `server.ts` now sets `trust proxy` to exactly one hop so `req.ip` gives
// the same answer for every caller that reads it (express-rate-limit included).
//
// PURE.

import type { Request } from 'express';

/** How many proxies sit between the internet and this server: Google's front end, and nothing else. */
export const TRUSTED_PROXY_HOPS = 1;

/** The address the trusted front end saw. Never an entry the caller could have written. */
export function clientAddress(req: Pick<Request, 'headers' | 'socket'>): string {
  const raw = req.headers['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
  const entries = header.split(',').map((s) => s.trim()).filter(Boolean);
  return entries[entries.length - 1] || req.socket?.remoteAddress || 'unknown';
}
