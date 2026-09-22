// Signing the link the browser fetches, and the only thing our relay will fetch back
// (admin-mandated 2026-09-21: free images come from the USER's connection, not ours).
//
// 🔴 WHY A SIGNATURE AT ALL — THE RELAY TAKES A URL FROM THE CLIENT. `/api/image/relay` exists so
// that "Add text", "Crop", "Copy" and "Download" keep working when a browser is not allowed to read
// another site's bytes. It is handed a URL by the page. Without a lock that endpoint is a
// server-side request forgery: any caller could ask OUR server to fetch OUR internal addresses —
// the cloud metadata service, a private service, a port scan — and read the answer.
//
// 🔒 TWO INDEPENDENT LOCKS, and neither is relied on alone:
//   1. `isAllowedImageHost` — an EXACT host allowlist (`src/lib/imageDelivery.ts`), shared with the
//      client so both sides agree on what a legal link is.
//   2. This signature — proof that WE minted that exact URL, after our own safety triage ran on the
//      prompt inside it. A URL the user typed themselves has no signature and is refused.
//
// The second lock is what makes the first sufficient: even a legal host cannot be pointed at an
// arbitrary path, so the relay can never be used to fetch a picture our triage never saw.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Dev-only fallback. Random per process ON PURPOSE — a constant in source would be forgeable. */
const processSecret = randomBytes(32).toString('hex');

/**
 * The HMAC key. `SECRET_ENCRYPTION_KEY` is set in Cloud Run, so a ticket minted by one instance
 * verifies on another — the same reasoning `previewDoor.ts` records for its own tokens.
 */
export function imageTicketSecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.SECRET_ENCRYPTION_KEY ?? '').trim() || processSecret;
}

/** The signature over one exact URL and its expiry. */
export function signImageTicket(url: string, expEpochMs: number, secret: string): string {
  return createHmac('sha256', secret).update(`${url}|${expEpochMs}`).digest('hex').slice(0, 48);
}

/**
 * Constant-time verification. Malformed input is simply `false` — never an exception, and never a
 * different failure shape for "wrong signature" than for "expired", which would leak which it was.
 */
export function verifyImageTicket(
  url: string | null | undefined,
  exp: string | number | null | undefined,
  sig: string | null | undefined,
  secret: string,
  now: number,
): boolean {
  const target = String(url ?? '').trim();
  const expMs = Number(exp);
  const given = String(sig ?? '').trim();
  if (!target || !Number.isFinite(expMs) || !given) return false;
  if (now > expMs) return false;
  const want = signImageTicket(target, expMs, secret);
  const a = Buffer.from(want);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Whether a free generation is handed to the browser instead of fetched here.
 *
 * ⚠️ DEFAULT ON, because this is what the admin asked for and because its worst case is today's
 * behaviour plus one round trip: a browser that cannot fetch falls back to the relay, which does
 * exactly what this server already does. `IMAGE_GEN_CLIENT_FETCH=off` reverts it with no deploy.
 */
export function clientImageFetchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.IMAGE_GEN_CLIENT_FETCH ?? '').trim().toLowerCase() !== 'off';
}
