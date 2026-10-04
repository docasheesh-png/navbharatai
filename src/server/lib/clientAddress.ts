// The address a request REALLY came from — the one place this server decides it.
//
// 🔴 WHY (forensic audit 2026-10-04). `server.ts` ran `app.set('trust proxy', true)`. Under `true`, Express
// believes EVERY entry of X-Forwarded-For, so `req.ip` is the LEFTMOST entry — the one the caller wrote.
// Every per-IP limit in the server keyed on it (chat 20/min, payment 5/min, admin login 5/min, the
// adaptive bot guard, the OTP and phone-exchange buckets), so a script that sent a fresh
// `X-Forwarded-For: <random>` on each request was a fresh visitor every time and none of those limits
// applied to it. Five more places read the header by hand and took the same leftmost entry. Our own
// app scanner (`SecurityAnalysis.ts`) flags this exact line in the apps users build.
//
// THE FACT IT RESTS ON (already relied on by `guestDailyQuota.ts`, live since 2026-09-27): Cloud Run's
// front end APPENDS the address it saw to X-Forwarded-For. So with ONE trusted hop the LAST entry is the
// one a caller cannot write. `trust proxy` is set to that same hop count, so `req.ip`, express-rate-limit
// and this helper all agree.
//
// `TRUST_PROXY_HOPS` (0–5, default 1) exists for one reason only: if a load balancer or CDN is ever put
// IN FRONT of Cloud Run, it adds a hop, and the right answer moves one entry left. Set it then — never to
// "trust everything".

import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 5;

/** How many proxies in front of this server are trusted to append to X-Forwarded-For. */
export function trustedProxyHops(raw: string | undefined = process.env.TRUST_PROXY_HOPS): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= 0 && n <= MAX_TRUSTED_PROXY_HOPS ? n : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * The caller's address, read exactly as Express reads `req.ip` under `trust proxy = hops`: the socket
 * is the first trusted hop, each further trusted hop consumes one X-Forwarded-For entry from the RIGHT,
 * and the first entry nobody trusted is the answer. A caller can prepend anything; it is never read.
 */
export function clientAddress(
  req: Pick<Request, 'headers' | 'socket'>,
  hops: number = trustedProxyHops(),
): string {
  const socket = req.socket?.remoteAddress || '';
  if (hops <= 0) return socket || 'unknown';
  const header = req.headers?.['x-forwarded-for'];
  const fwd = (Array.isArray(header) ? header.join(',') : String(header ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fwd.length === 0) return socket || 'unknown';
  return fwd[Math.max(0, fwd.length - hops)];
}

/**
 * The rate-limit key for a caller known only by address: the real address (above), with an IPv6 caller
 * grouped by its /56 the way express-rate-limit recommends.
 *
 * 🔴 WHY THIS IS A FUNCTION OF ITS OWN (forensic audit 2026-10-04). The three limiters in `server.ts`
 * were written `keyGenerator: (req) => ipKeyGenerator(req as any)`. `ipKeyGenerator` takes an ADDRESS
 * STRING; handed the request object it returns that object unchanged, and the limiter's store then keys
 * on a value that is new on every request. Every request was its own first request: the chat (20/min),
 * payment (5/min) and admin-login (5/min) limits had never limited anything. The `as any` is what let
 * the type checker stay quiet. Nothing here takes a request where an address belongs.
 */
export function addressRateKey(req: Pick<Request, 'headers' | 'socket'>): string {
  return `ip:${ipKeyGenerator(clientAddress(req))}`;
}

/**
 * The rate-limit key for a route a signed-in person uses: their VERIFIED uid when the request carries a
 * valid ID token, else their address. Keying signed-in traffic on the account, not the address, matters
 * in India in particular: a mobile carrier puts many phones behind one address, and a per-address limit
 * would make strangers share one budget. A forged or expired token is not an identity — it falls back to
 * the address, so it cannot be used to mint fresh buckets.
 */
export async function identityRateKey(
  req: Request,
  verifyUid: (r: Request) => Promise<string | null>,
): Promise<string> {
  const uid = await verifyUid(req).catch(() => null);
  return uid ? `uid:${uid}` : addressRateKey(req);
}
