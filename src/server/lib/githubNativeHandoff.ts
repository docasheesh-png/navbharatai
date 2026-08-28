/**
 * THE GITHUB TOKEN MUST STOP RIDING IN A DEEP LINK ANY APP CAN CLAIM.
 *
 * THE FINDING (docs/google-play-2027-security-audit.md, finding 1 — HIGH). The native OAuth flow
 * returned the access token in the fragment of a CUSTOM URI SCHEME:
 *
 *     com.navbharat.ai://github-callback#gh_token=<TOKEN>
 *
 * A custom scheme is not exclusive on Android. Any installed app may declare `com.navbharat.ai` in its
 * own manifest. The user is mid-sign-in, expects to be returned to an app, and taps through the
 * chooser; a malicious handler reads the token and forwards them onward so nothing looks wrong. Our
 * scope is `repo workflow` — full read/write on every private repository the user has.
 *
 * WHY THE EXISTING DEFENCES DID NOT COVER IT. `githubAuth.ts` has an origin allowlist, an open-redirect
 * guard, a fixed server-owned scheme constant deliberately never derived from `state`, and a test
 * pinning that invariant. All correct — and all defending against a crafted `state` sending the token
 * somewhere else. None of them touches another app claiming the scheme, because that attack never goes
 * near `state`. A good mitigation for the wrong threat reads exactly like coverage.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────────────────────────
 *
 * The deep link carries a TICKET instead of the token. The ticket is:
 *
 *   • ENCRYPTED with the server key (AES-256-GCM via lib/secrets) — an interceptor cannot read it;
 *   • BOUND to the uid that started the flow — it can only be redeemed by that user;
 *   • SHORT-LIVED — two minutes, which is generous for a redirect that takes milliseconds.
 *
 * The app redeems it over HTTPS with its Firebase ID token. An intercepting app holds ciphertext it
 * cannot decrypt, for a user it cannot authenticate as. There is nothing to steal.
 *
 * ── WHY IT IS STATELESS, WHICH IS A DELIBERATE TRADE ───────────────────────────────────────────
 *
 * A server-side single-use store would additionally stop replay. It would also mean a new Firestore
 * collection, cross-instance consistency on Cloud Run, and a cleanup job — new machinery on a working
 * auth path. And replay buys an attacker nothing here: redeeming still requires the victim's Firebase
 * ID token, which is the thing they do not have. So the ciphertext is self-contained, and the security
 * rests on authentication rather than on bookkeeping.
 *
 * ── ⚠️ THE ROLLOUT IS THE HARD PART, AND IT IS WHY THERE ARE TWO PATHS ─────────────────────────
 *
 * The app runs from assets baked into the APK (`webDir: 'dist'`, no `server.url`). If the server simply
 * started sending tickets, GitHub sign-in would break for EVERY already-installed app until its user
 * updated — and never breaking the app is the first absolute rule.
 *
 * So the CLIENT declares what it understands, through `state`:
 *
 *     nbai-native      → an app built before this change. Gets the raw token, exactly as before.
 *     nbai-native-v2.… → an app that understands tickets. Gets a ticket.
 *
 * Old installs are byte-identical. The fix lands for each user when they update, and the legacy branch
 * can be deleted once adoption is high.
 *
 * PURE — every decision here is a function of its arguments, so all of it is testable without a
 * network, a device, or a real key.
 */

import crypto from 'crypto';

/** Legacy native state. An app built before tickets existed. Must keep working. */
export const NATIVE_STATE_LEGACY = 'nbai-native';

/** Prefix for the signed v2 state. The uid and expiry follow, then the signature. */
export const NATIVE_STATE_V2 = 'nbai-native-v2';

/** How long a signed state stays valid — the OAuth round trip, generously. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * How long a ticket stays redeemable. The app redeems it the instant the deep link arrives, so this is
 * generous by two orders of magnitude — long enough to survive a slow device wake, short enough that a
 * ciphertext lifted from a log is worthless by the time anyone looks at it.
 */
export const TICKET_TTL_MS = 2 * 60 * 1000;

function hmac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time compare that cannot throw on a length mismatch. */
function sameSignature(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

/**
 * Sign the OAuth `state` for a v2 client: `nbai-native-v2.<uid>.<expiryMs>.<hmac>`.
 *
 * The uid travels in clear inside the state. That is deliberate and safe: a Firebase uid is not a
 * credential — the client already holds it, and it is useless without a token signed for it. The HMAC is
 * what matters, because it stops anyone crafting a state that binds a ticket to a uid of their choosing.
 *
 * Dots are the separator, so a uid containing one would break parsing. Firebase uids are
 * base-58-ish and never contain a dot, and `parseNativeState` fails closed if that ever changes.
 */
export function signNativeState(secret: string, uid: string, expiresAtMs: number): string {
  const payload = `${NATIVE_STATE_V2}.${uid}.${expiresAtMs}`;
  return `${payload}.${hmac(secret, payload)}`;
}

export type NativeState =
  /** Not a native flow at all — the web path. */
  | { kind: 'none' }
  /** An app from before this change. Send it the raw token, exactly as before. */
  | { kind: 'legacy' }
  /** A v2 app, and the state proves which user started the flow. */
  | { kind: 'v2'; uid: string }
  /** Shaped like v2 but unusable. NEVER falls back to legacy — see below. */
  | { kind: 'v2-invalid'; reason: 'malformed' | 'bad-signature' | 'expired' };

/**
 * Classify an incoming `state`.
 *
 * ⚠️ A BROKEN v2 STATE MUST NOT DEGRADE TO LEGACY. That would hand an attacker the whole fix: send a
 * deliberately malformed v2 state and the server helpfully reverts to putting the token in the deep
 * link. `v2-invalid` is its own outcome and the caller refuses it.
 *
 * The signature is checked BEFORE the expiry, so a forged state cannot be told apart from an expired one
 * by timing or by the error it produces.
 */
export function parseNativeState(secret: string, state: unknown, nowMs: number): NativeState {
  const s = typeof state === 'string' ? state : '';
  if (s === NATIVE_STATE_LEGACY) return { kind: 'legacy' };
  if (!s.startsWith(`${NATIVE_STATE_V2}.`)) return { kind: 'none' };

  const parts = s.split('.');
  if (parts.length !== 4) return { kind: 'v2-invalid', reason: 'malformed' };
  const [, uid, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!uid || !Number.isFinite(exp)) return { kind: 'v2-invalid', reason: 'malformed' };

  if (!sameSignature(sig, hmac(secret, `${NATIVE_STATE_V2}.${uid}.${expRaw}`))) {
    return { kind: 'v2-invalid', reason: 'bad-signature' };
  }
  if (nowMs > exp) return { kind: 'v2-invalid', reason: 'expired' };
  return { kind: 'v2', uid };
}

interface TicketPayload {
  /** The GitHub access token. */
  t: string;
  /** The uid allowed to redeem it. */
  u: string;
  /** Absolute expiry, ms. */
  e: number;
}

/**
 * Wrap the access token for the trip through the deep link.
 *
 * `encrypt` is AES-256-GCM, so the ciphertext is authenticated: tampering fails to decrypt rather than
 * yielding an attacker-chosen payload. It also REFUSES the hardcoded dev fallback key in production, so
 * a misconfigured deploy fails loudly here instead of shipping a ticket anyone with the repo could open.
 */
export function makeTicket(
  accessToken: string,
  uid: string,
  nowMs: number,
  encrypt: (plain: string) => string,
): string {
  const payload: TicketPayload = { t: accessToken, u: uid, e: nowMs + TICKET_TTL_MS };
  return encrypt(JSON.stringify(payload));
}

export type TicketResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unreadable' | 'wrong-user' | 'expired' | 'empty' };

/**
 * Open a ticket for a specific, already-authenticated user.
 *
 * `uid` MUST come from a verified Firebase ID token, never from the request body — the whole protection
 * is that the caller proved who they are. Every failure is a plain outcome rather than a throw, because
 * a decrypt failure here is an ordinary thing (an expired link, a retry, a truncated paste), not an
 * exceptional one.
 */
export function readTicket(
  ticket: unknown,
  uid: string,
  nowMs: number,
  decrypt: (cipher: string) => string,
): TicketResult {
  const raw = typeof ticket === 'string' ? ticket.trim() : '';
  if (!raw) return { ok: false, reason: 'empty' };

  let payload: TicketPayload;
  try {
    payload = JSON.parse(decrypt(raw)) as TicketPayload;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!payload || typeof payload.t !== 'string' || typeof payload.u !== 'string') {
    return { ok: false, reason: 'unreadable' };
  }
  // Ownership before expiry: someone else's ticket is a security event, an expired one is routine, and
  // reporting the routine reason for a security event would hide it.
  if (payload.u !== uid) return { ok: false, reason: 'wrong-user' };
  if (!Number.isFinite(payload.e) || nowMs > payload.e) return { ok: false, reason: 'expired' };
  if (!payload.t) return { ok: false, reason: 'empty' };
  return { ok: true, token: payload.t };
}

/** Where the app's OAuth deep link lands. Mirrors GITHUB_DEEP_LINK_PREFIX on the client. */
export const NATIVE_OAUTH_REDIRECT = 'com.navbharat.ai://github-callback';

/**
 * The deep link to send the app, or null when this is not a native flow.
 *
 * ONE function decides the whole return, so the legacy and ticket branches cannot drift apart — and so
 * the `v2-invalid` refusal lives here rather than at a call site that might forget it.
 */
export function nativeReturnUrl(state: NativeState, accessToken: string, ticket: string | null): string | null {
  switch (state.kind) {
    case 'legacy':
      // Unchanged, deliberately: an app built before this change is still out there.
      return `${NATIVE_OAUTH_REDIRECT}#gh_token=${encodeURIComponent(accessToken)}`;
    case 'v2':
      // No ticket means encryption is unavailable. Refuse rather than fall back to the token — a
      // silent downgrade to the insecure path is exactly what this change exists to remove.
      return ticket ? `${NATIVE_OAUTH_REDIRECT}#gh_ticket=${encodeURIComponent(ticket)}` : null;
    case 'v2-invalid':
    case 'none':
    default:
      return null;
  }
}
