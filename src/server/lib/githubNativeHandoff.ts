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
 * ── Q-629 (admin decision 2026-10-05, option a): THE DEVICE NONCE, AND NO MORE QUIET FALLBACK ──
 *
 * The uid ticket needed a signed-in user, so the server FELL BACK to the token-in-URL path whenever the
 * identity check failed — a request that asked for the safe flow was given the unsafe one, and a user
 * signing IN with GitHub on the phone always hit it. Two changes:
 *
 *     nbai-native-v3.… → the current app. A ticket bound to the HASH of a one-time nonce the app made
 *                        (works signed-out), redeemed once by presenting that nonce.
 *     handoff=ticket with no verified identity → REFUSED. Never the legacy state.
 *
 * The bare legacy state is now served only while `GITHUB_NATIVE_LEGACY_TOKEN_RETURN` is on (default on,
 * for pre-2026-08-28 installs) — see `legacyTokenReturnEnabled`.
 *
 * PURE — every decision here is a function of its arguments, so all of it is testable without a
 * network, a device, or a real key.
 */

import crypto from 'crypto';

/** Legacy native state. An app built before tickets existed. Must keep working. */
export const NATIVE_STATE_LEGACY = 'nbai-native';

/** Prefix for the signed v2 state. The uid and expiry follow, then the signature. */
export const NATIVE_STATE_V2 = 'nbai-native-v2';

/**
 * Prefix for the signed DEVICE state (Q-629, admin decision 2026-10-05, option a). The challenge — the
 * SHA-256 of a one-time nonce the app generated — and the expiry follow, then the signature.
 *
 * WHY A DEVICE NONCE AND NOT A UID. The v2 ticket is bound to a Firebase uid, so it needs the user to be
 * signed in to NavBharatAI before connecting GitHub. A user signing IN with GitHub on the phone has no
 * Firebase identity yet — and that is exactly the request that used to fall back to the token-in-URL
 * path. A nonce the app made itself needs no account: the ticket can only be redeemed by whoever holds
 * the nonce, and only the app that started the flow does.
 *
 * Only the HASH of the nonce ever enters `state`. `state` travels through the browser, GitHub and our
 * own request logs; the nonce itself travels exactly twice, both times over HTTPS in a header or a POST
 * body — to start the flow and to redeem the ticket. An app that intercepts the deep link sees a
 * ticket, and nothing it can redeem it with.
 */
export const NATIVE_STATE_DEVICE = 'nbai-native-v3';

/**
 * The header a client sends its one-time OAuth nonce in, for BOTH the web flow (Q-623) and the native
 * device flow (Q-629). A header, not a query parameter, so the nonce is not written into request logs.
 * Mirrors GITHUB_NONCE_HEADER in src/lib/githubOauthNonce.ts.
 */
export const GITHUB_NONCE_HEADER = 'x-nbai-github-nonce';

/** A client nonce: 32 random bytes as lowercase hex. Anything else is refused, never normalised. */
const OAUTH_NONCE_RE = /^[a-f0-9]{64}$/;

export function isOauthNonce(value: unknown): value is string {
  return typeof value === 'string' && OAUTH_NONCE_RE.test(value);
}

/** The challenge signed into a device state: base64url(SHA-256(nonce)). 43 chars, never a dot. */
export function deviceChallenge(nonce: string): string {
  return crypto.createHash('sha256').update(nonce, 'utf8').digest('base64url');
}

/** How long a signed state stays valid — the OAuth round trip, generously. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * How long a ticket stays redeemable. The app redeems it the instant the deep link arrives, so this is
 * generous by two orders of magnitude — long enough to survive a slow device wake, short enough that a
 * ciphertext lifted from a log is worthless by the time anyone looks at it.
 */
export const TICKET_TTL_MS = 2 * 60 * 1000;

/**
 * HMAC-SHA256 over a state payload. Exported so every signed GitHub OAuth `state` — native and web —
 * is signed by this ONE function with the ONE key (`handoffSecret()` in the route). Two signers would
 * be two places for the key handling to drift.
 */
export function hmac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time compare that cannot throw on a length mismatch. */
export function sameSignature(a: string, b: string): boolean {
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
  | { kind: 'v2-invalid'; reason: 'malformed' | 'bad-signature' | 'expired' }
  /** A device-nonce app (Q-629). The state proves which nonce challenge started the flow. */
  | { kind: 'device'; challenge: string }
  /** Shaped like a device state but unusable. Refused exactly like `v2-invalid`, never downgraded. */
  | { kind: 'device-invalid'; reason: 'malformed' | 'bad-signature' | 'expired' };

/** Sign a device state: `nbai-native-v3.<challenge>.<expiryMs>.<hmac>`. */
export function signDeviceState(secret: string, challenge: string, expiresAtMs: number): string {
  const payload = `${NATIVE_STATE_DEVICE}.${challenge}.${expiresAtMs}`;
  return `${payload}.${hmac(secret, payload)}`;
}

/** A native state that must be refused outright: no token, no ticket, no fallback. */
export function isRefusedNativeState(
  state: NativeState,
): state is Extract<NativeState, { kind: 'v2-invalid' | 'device-invalid' }> {
  return state.kind === 'v2-invalid' || state.kind === 'device-invalid';
}

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
  if (s.startsWith(`${NATIVE_STATE_DEVICE}.`)) return parseDeviceState(secret, s, nowMs);
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

/** Same rules as the v2 parse: signature before expiry, and a broken state is its own outcome. */
function parseDeviceState(secret: string, s: string, nowMs: number): NativeState {
  const parts = s.split('.');
  if (parts.length !== 4) return { kind: 'device-invalid', reason: 'malformed' };
  const [, challenge, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !Number.isFinite(exp)) {
    return { kind: 'device-invalid', reason: 'malformed' };
  }
  if (!sameSignature(sig, hmac(secret, `${NATIVE_STATE_DEVICE}.${challenge}.${expRaw}`))) {
    return { kind: 'device-invalid', reason: 'bad-signature' };
  }
  if (nowMs > exp) return { kind: 'device-invalid', reason: 'expired' };
  return { kind: 'device', challenge };
}

interface TicketPayload {
  /** The GitHub access token. */
  t: string;
  /** The uid allowed to redeem it (v2 ticket). */
  u?: string;
  /** The device challenge the redeemer's nonce must hash to (device ticket, Q-629). */
  c?: string;
  /** Absolute expiry, ms. */
  e: number;
  /** One-time id, so a device ticket is redeemed once (device ticket). */
  i?: string;
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
    // A device ticket has no `u`, so it can never be opened through the uid path either.
    return { ok: false, reason: 'unreadable' };
  }
  // Ownership before expiry: someone else's ticket is a security event, an expired one is routine, and
  // reporting the routine reason for a security event would hide it.
  if (payload.u !== uid) return { ok: false, reason: 'wrong-user' };
  if (!Number.isFinite(payload.e) || nowMs > payload.e) return { ok: false, reason: 'expired' };
  if (!payload.t) return { ok: false, reason: 'empty' };
  return { ok: true, token: payload.t };
}

/**
 * Remembers which device tickets have been redeemed, so each is redeemed ONCE.
 *
 * In memory, and that is an honest limit rather than a hidden one: Cloud Run may run several instances,
 * so a replay that lands on a DIFFERENT instance inside the two-minute TTL is not caught here. That
 * replay still needs the device nonce, which never leaves the app except in the HTTPS body of the one
 * redemption — so the ledger is defence in depth and the nonce is the protection. Entries are swept on
 * every claim, so the map holds at most two minutes of sign-ins.
 */
export class TicketLedger {
  private readonly used = new Map<string, number>();

  /** True the first time an id is claimed; false on every later claim until the ticket has expired. */
  claim(id: string, expiresAtMs: number, nowMs: number): boolean {
    for (const [k, exp] of this.used) if (exp < nowMs) this.used.delete(k);
    if (this.used.has(id)) return false;
    this.used.set(id, expiresAtMs);
    return true;
  }
}

/**
 * Wrap the access token for a device-nonce flow. Bound to the challenge, never to a uid, so it works for
 * a user who is not signed in to NavBharatAI yet. `ticketId` is injectable for tests only.
 */
export function makeDeviceTicket(
  accessToken: string,
  challenge: string,
  nowMs: number,
  encrypt: (plain: string) => string,
  ticketId: string = crypto.randomBytes(16).toString('hex'),
): string {
  const payload: TicketPayload = { t: accessToken, c: challenge, e: nowMs + TICKET_TTL_MS, i: ticketId };
  return encrypt(JSON.stringify(payload));
}

export type DeviceTicketResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unreadable' | 'bad-nonce' | 'wrong-device' | 'expired' | 'replayed' | 'empty' };

/**
 * Open a device ticket for whoever presents the nonce it was minted for — once.
 *
 * Order mirrors `readTicket`: possession first (a wrong nonce is the security event worth logging), then
 * expiry, then single use. A failed possession check does NOT consume the ticket: the nonce is 256 bits,
 * so a wrong guess costs an attacker nothing to make and must not let them burn the real user's sign-in.
 */
export function readDeviceTicket(
  ticket: unknown,
  nonce: unknown,
  nowMs: number,
  decrypt: (cipher: string) => string,
  ledger: TicketLedger,
): DeviceTicketResult {
  const raw = typeof ticket === 'string' ? ticket.trim() : '';
  if (!raw) return { ok: false, reason: 'empty' };
  if (!isOauthNonce(nonce)) return { ok: false, reason: 'bad-nonce' };

  let payload: TicketPayload;
  try {
    payload = JSON.parse(decrypt(raw)) as TicketPayload;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!payload || typeof payload.t !== 'string' || typeof payload.c !== 'string' || typeof payload.i !== 'string') {
    // A uid ticket has no `c`, so the device path can never open one.
    return { ok: false, reason: 'unreadable' };
  }
  if (!sameSignature(payload.c, deviceChallenge(nonce))) return { ok: false, reason: 'wrong-device' };
  if (!Number.isFinite(payload.e) || nowMs > payload.e) return { ok: false, reason: 'expired' };
  if (!payload.t) return { ok: false, reason: 'empty' };
  if (!ledger.claim(payload.i, payload.e, nowMs)) return { ok: false, reason: 'replayed' };
  return { ok: true, token: payload.t };
}

/**
 * THE ONE SWITCH for the legacy token-in-URL return (Q-629). DEFAULT ON — deliberately, dated 2026-10-05.
 *
 * App builds from before 2026-08-28 (#2706) send the bare `nbai-native` state and can ONLY read a raw
 * token off the deep link; they run from assets baked into their APK and no server deploy changes them.
 * Turning this off breaks GitHub sign-in on those installs, so it stays on until the admin decides that
 * enough users run a bundle with the device-nonce flow. Set `GITHUB_NATIVE_LEGACY_TOKEN_RETURN=off` to
 * retire the path; nothing else needs to change.
 *
 * ⚠️ While it is on, the risk this module describes is still live on any phone that has an app claiming
 * our scheme: a crafted GitHub authorize link with `state=nbai-native` makes the server put the token in
 * the deep link. A current build never asks for that — the exposure is this switch, not the app.
 */
export const LEGACY_TOKEN_RETURN_ENV = 'GITHUB_NATIVE_LEGACY_TOKEN_RETURN';

export function legacyTokenReturnEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = String(env[LEGACY_TOKEN_RETURN_ENV] ?? '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no');
}

/** Where the app's OAuth deep link lands. Mirrors GITHUB_DEEP_LINK_PREFIX on the client. */
export const NATIVE_OAUTH_REDIRECT = 'com.navbharat.ai://github-callback';

/**
 * The deep link to send the app, or null when this is not a native flow.
 *
 * ONE function decides the whole return, so the legacy and ticket branches cannot drift apart — and so
 * the `v2-invalid` refusal lives here rather than at a call site that might forget it.
 */
export function nativeReturnUrl(
  state: NativeState,
  accessToken: string,
  ticket: string | null,
  legacyTokenReturn: boolean,
): string | null {
  switch (state.kind) {
    case 'legacy':
      // An app built before tickets existed can only read a raw token. Served only while the switch is
      // on (see legacyTokenReturnEnabled) — and NEVER for any other state kind, whatever went wrong.
      return legacyTokenReturn ? `${NATIVE_OAUTH_REDIRECT}#gh_token=${encodeURIComponent(accessToken)}` : null;
    case 'v2':
    case 'device':
      // No ticket means encryption is unavailable. Refuse rather than fall back to the token — a
      // silent downgrade to the insecure path is exactly what this change exists to remove.
      return ticket ? `${NATIVE_OAUTH_REDIRECT}#gh_ticket=${encodeURIComponent(ticket)}` : null;
    case 'v2-invalid':
    case 'device-invalid':
    case 'none':
    default:
      return null;
  }
}
