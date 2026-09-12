// SIGN IN TO DOWNLOAD AN APK — without breaking the download (admin 2026-09-12:
// "app mart se app play koi bhi user kar sakta hai, signout wala bhi. par download ke liye sign in
// jaruri hai").
//
// ── THE PROBLEM, WHICH IS NOT "ADD AN AUTH CHECK" ────────────────────────────────────────────────
// A download is a browser NAVIGATION, not a `fetch`. The browser opens the URL itself, and in the
// bundled Android app it is handed to the system browser (`window.open(..., '_blank')`) so Android's
// real downloader streams the 5–50 MB file. Neither of those can carry an Authorization header. So
// the obvious implementation — read the Firebase token on `/download/:id` — would authenticate
// nobody and refuse everybody, which is precisely the dead button this route was already fixed for
// once (admin 2026-08-19: "app mart se apk download hi nahi hoti").
//
// ── SO: A TICKET ─────────────────────────────────────────────────────────────────────────────────
// The client calls an ORDINARY authenticated endpoint, which verifies the Firebase token and mints a
// short-lived HMAC ticket bound to (appId, uid, expiry). The browser then navigates to the download
// URL carrying that ticket. Same shape as the preview door (`previewDoor.ts`), for the same reason
// and with the same shared secret, so tokens minted by one Cloud Run instance verify on another.
//
// ── 🔒 WHAT THE TICKET IS AND IS NOT ─────────────────────────────────────────────────────────────
// It proves "a signed-in account asked for THIS app, recently". It is NOT a licence and NOT a
// paywall — App Mart downloads are free, and this exists so a download has a name attached to it.
// The uid is INSIDE the signature, so a ticket cannot be edited to name a different app or stretched
// past its expiry, and a leaked ticket buys an attacker only a file they could have had by signing
// in themselves. Short-lived (minutes) because it travels in a URL, which lands in history and logs.
//
// PURE — signing, verification and parsing. The route owns all I/O.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Kill switch: `NAV_STORE_DOWNLOAD_SIGNIN=off` restores anonymous downloads without a deploy.
 *
 * Default ON — this IS the admin's instruction. The switch exists because this rule locks a door,
 * and every door in this codebase has a key: if requiring sign-in turns out to cost real downloads,
 * the admin can hand it back in seconds rather than wait for a release.
 */
export function downloadSignInRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.NAV_STORE_DOWNLOAD_SIGNIN ?? '').trim().toLowerCase() !== 'off';
}

/** Dev-only fallback secret. Random per process ON PURPOSE: never a guessable constant. */
const processSecret = randomBytes(32).toString('hex');

/** The HMAC key. SECRET_ENCRYPTION_KEY is set in Cloud Run, so prod tickets verify across instances. */
export function ticketSecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.SECRET_ENCRYPTION_KEY ?? '').trim() || processSecret;
}

/**
 * How long a ticket lives.
 *
 * Ten minutes: long enough for a slow phone to start a 50 MB download and for a user to be asked
 * about installing from an unknown source, short enough that a URL sitting in browser history or a
 * shared screenshot is worthless soon after. The download itself is unaffected once started — the
 * ticket is checked when the request opens, never mid-stream.
 */
export const DOWNLOAD_TICKET_TTL_MS = 10 * 60 * 1000;

/** The uid is signed IN, so a ticket cannot be re-pointed at another app or another account. */
export function signDownloadTicket(appId: string, uid: string, expEpochMs: number, secret: string): string {
  return createHmac('sha256', secret).update(`${appId}|${uid}|${expEpochMs}`).digest('hex').slice(0, 48);
}

/** The query string a minted ticket travels in. One place, so the route and the client cannot drift. */
export function downloadTicketQuery(uid: string, expEpochMs: number, sig: string): string {
  return `u=${encodeURIComponent(uid)}&e=${expEpochMs}&t=${sig}`;
}

export type TicketVerdict = 'ok' | 'missing' | 'expired' | 'bad';

/**
 * Verify a ticket. Constant-time, and malformed input is a verdict rather than an exception.
 *
 * The verdicts are separate because the PAGE a refused download shows depends on which one it is:
 * "missing" means sign in, "expired" means press the button again, and both are true statements the
 * user can act on. Collapsing them into one "not allowed" would be the honest-error failure this
 * codebase keeps finding.
 */
export function verifyDownloadTicket(
  appId: string,
  query: { u?: unknown; e?: unknown; t?: unknown },
  secret: string,
  now: number,
): TicketVerdict {
  const uid = String(query.u ?? '').trim();
  const given = String(query.t ?? '').trim();
  const expMs = Number(query.e);
  if (!uid && !given) return 'missing';
  if (!uid || !given || !Number.isFinite(expMs)) return 'bad';
  if (expMs <= now) return 'expired';
  const expected = signDownloadTicket(appId, uid, expMs, secret);
  if (expected.length !== given.length) return 'bad';
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given)) ? 'ok' : 'bad';
  } catch {
    return 'bad';
  }
}

/** What to tell the person, per verdict. Words, not codes — this renders as a full page. */
export function ticketRefusalMessage(verdict: Exclude<TicketVerdict, 'ok'>): string {
  if (verdict === 'expired') return 'That download link has expired. Go back to App Mart and press Download again.';
  if (verdict === 'missing') return 'Please sign in to NavBharatAI to download this app.';
  return 'That download link is not valid. Go back to App Mart and press Download again.';
}
