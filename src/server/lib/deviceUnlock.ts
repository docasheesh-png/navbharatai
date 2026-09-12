// THE SECRET VAULT'S DEVICE LOCK (admin 2026-09-12: "user jab secret and api keys par click kare to
// phone lock / face lock / pin dalna pade, tab open ho!" … "real working security ke sath!!!")
//
// 🔴 WHY THIS IS A SERVER MODULE AND NOT A BROWSER PROMPT — the whole point of the feature.
//
// The obvious way to build "ask for Face ID before showing the keys" is to call the browser's
// biometric API, and on success render the list. That is THEATRE, and it is exactly the
// "built but not really working" state the second absolute rule forbids: the values still travel over
// an ordinary `GET /api/secrets/:userId`, so anyone holding the session — a stolen unlocked laptop,
// a browser extension, or simply devtools — reads every key without ever meeting the prompt. The lock
// would protect the SCREEN while leaving the SECRETS open.
//
// So the gate lives here. A device unlock produces a real cryptographic assertion, this module
// VERIFIES it, and only then is a short-lived ticket minted. The route that can hand back a decrypted
// value refuses to do so without that ticket. The prompt is not the security; the verified signature is.
//
// TWO WAYS TO PROVE IT IS REALLY YOU, and both are real:
//
//   1. THE DEVICE LOCK (WebAuthn platform authenticator) — face, fingerprint or the device PIN. The
//      authenticator signs our challenge with a private key that never leaves the device's secure
//      hardware, and sets the User Verified flag only if the person actually passed the device's own
//      check. We verify the signature AND that flag, so "it asked me for my face" becomes something the
//      server can check rather than something the client claims.
//
//   2. A FRESH ACCOUNT SIGN-IN (the fallback) — not every device has a platform authenticator, and a
//      user who cannot unlock their own vault has lost their keys forever, which breaks the one
//      absolute rule far worse than a weaker prompt does. So a genuinely fresh re-authentication also
//      opens the vault: Firebase stamps `auth_time` into the ID token, and `isFreshReauth` requires it
//      to be minutes old. That is ALSO server-enforced — the client cannot fake an old sign-in into a
//      new one, because it cannot mint the token.
//
// Everything here is a pure function over bytes and strings, so every rule above is unit-testable
// against fixed vectors instead of being trusted.

import { createHmac, randomBytes, timingSafeEqual, createHash, createVerify, createPublicKey } from 'crypto';

/**
 * 🔒 DOMAIN SEPARATION, and the reason this module does not borrow `previewDoor`'s signer.
 *
 * Both sign "a payload plus an expiry" with the same `SECRET_ENCRYPTION_KEY`, so sharing one helper
 * looks like the obvious de-duplication. It is the wrong call here: a preview-door token and a vault
 * unlock ticket would then be the same kind of string, and any future payload collision — a workspace
 * id that happens to look like a uid — would let a token minted for a PREVIEW open somebody's KEYS.
 * The labels below make that impossible by construction: a MAC computed under one label can never
 * verify under the other, whatever the payload.
 */
const CHALLENGE_LABEL = 'navbharatai.vault.challenge.v1';
const TICKET_LABEL = 'navbharatai.vault.ticket.v1';

/** How long a freshly-minted challenge may be answered. Short: it exists only to cross one round trip. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * How long ONE unlock lasts.
 *
 * Five minutes is a deliberate middle: long enough to read a key, copy it and delete another without
 * re-authenticating on every tap, short enough that a screen left open on a shared desk closes itself.
 * The ticket is not a session — it is permission to do the next few things, and the vault re-locks
 * on its own when it lapses.
 */
export const TICKET_TTL_MS = 5 * 60 * 1000;

/** How recently the account sign-in must have happened for the fallback path to count as "just now". */
export const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Per-process fallback key, for dev and tests only.
 *
 * In production `SECRET_ENCRYPTION_KEY` is set (it is what encrypts the vault itself), so tickets verify
 * across every Cloud Run instance. Without it each instance would mint tickets only it could verify, and
 * a user would be asked to unlock again every time the load balancer moved them — which is why this is
 * a random per-process value rather than a hardcoded string: a shared constant in source would let
 * anyone with the repo forge an unlock ticket.
 */
const processSecret = randomBytes(32).toString('hex');

/** The HMAC key behind both the challenge and the ticket. */
export function unlockSecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.SECRET_ENCRYPTION_KEY ?? '').trim() || processSecret;
}

// ── base64url, the encoding every WebAuthn field arrives in ────────────────────────────────────────

export function bufferToBase64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url. Returns an EMPTY buffer for anything that is not valid base64url, rather than
 * throwing or silently accepting junk — every caller below treats empty as "reject".
 */
export function base64urlToBuffer(value: string): Buffer {
  const s = String(value ?? '').trim();
  if (!s || !/^[A-Za-z0-9_-]+$/.test(s)) return Buffer.alloc(0);
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

/** Constant-time compare that never throws on a length mismatch. */
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function mac(label: string, payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${label}|${payload}`).digest('hex').slice(0, 48);
}

// ── The challenge: proof that this assertion answers OUR question, not a replayed old one ───────────

/**
 * A signed, stateless challenge.
 *
 * Stateless on purpose. The natural implementation keeps a Map of issued challenges, but this server
 * runs as MANY Cloud Run instances and `CLAUDE.md`'s scale plan records per-instance memory as a
 * standing trap: the instance that issued the challenge is usually not the one answering it, so a Map
 * would fail for most users and "work on my machine" for the rest. Signing the nonce instead means any
 * instance can verify any challenge with no shared store at all.
 */
export function mintChallenge(uid: string, nowMs: number, secret: string): string {
  const nonce = randomBytes(24).toString('hex');
  const exp = nowMs + CHALLENGE_TTL_MS;
  const payload = `${uid}|${nonce}|${exp}`;
  return `${nonce}.${exp}.${mac(CHALLENGE_LABEL, payload, secret)}`;
}

/** Does this challenge string belong to this user, and is it still inside its window? */
export function verifyChallenge(challenge: string, uid: string, nowMs: number, secret: string): boolean {
  const parts = String(challenge ?? '').split('.');
  if (parts.length !== 3) return false;
  const [nonce, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!nonce || !Number.isFinite(exp) || exp <= nowMs) return false;
  return sameSecret(sig, mac(CHALLENGE_LABEL, `${uid}|${nonce}|${exp}`, secret));
}

// ── The ticket: what the reveal and delete routes actually check ────────────────────────────────────

/** How the vault was opened. Recorded on the ticket so the audit trail can say which proof was given. */
export type UnlockMethod = 'device-lock' | 'account-reauth';

export function mintUnlockTicket(uid: string, nowMs: number, secret: string, method: UnlockMethod): string {
  const exp = nowMs + TICKET_TTL_MS;
  const payload = `${uid}|${method}|${exp}`;
  return `${method}.${exp}.${mac(TICKET_LABEL, payload, secret)}`;
}

/**
 * Verify a ticket. Returns the method when valid so the caller can record it, and `null` otherwise —
 * there is deliberately no "valid but expired" shade: to every caller, not-now is not-valid.
 */
export function verifyUnlockTicket(
  ticket: string,
  uid: string,
  nowMs: number,
  secret: string,
): { method: UnlockMethod } | null {
  const parts = String(ticket ?? '').split('.');
  if (parts.length !== 3) return null;
  const [method, expRaw, sig] = parts;
  if (method !== 'device-lock' && method !== 'account-reauth') return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  if (!sameSecret(sig, mac(TICKET_LABEL, `${uid}|${method}|${exp}`, secret))) return null;
  return { method };
}

// ── Which origins and rp ids we accept an assertion from ───────────────────────────────────────────

/**
 * The sites this vault's credentials may be used from.
 *
 * Checked because `clientDataJSON` carries the origin the browser really used, which is what stops a
 * phishing page on another domain from collecting an assertion and replaying it here. Overridable by
 * env so a staging host can be added without a code change; malformed entries are dropped rather than
 * widening the set.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = String(env.VAULT_LOCK_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/[^\s,]+$/.test(s));
  if (configured.length) return configured;
  return [
    'https://navbharatai.com',
    'https://www.navbharatai.com',
    // The Capacitor shell serves the bundled app from this origin. Listed so a native build that DOES
    // have a working platform authenticator is accepted; one that does not falls back to a fresh
    // account sign-in, which is why an unusable entry here costs nothing.
    'https://localhost',
    'http://localhost:5173',
  ];
}

/** The relying-party ids matching those origins — the value the authenticator hashes into authData. */
export function allowedRpIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const ids = new Set<string>();
  for (const origin of allowedOrigins(env)) {
    try {
      ids.add(new URL(origin).hostname);
    } catch {
      /* an origin that will not parse cannot contribute an rpId */
    }
  }
  // A credential created on www. is usable on the bare domain when the rpId was set to the bare domain,
  // so both spellings are accepted; the ORIGIN check above is what actually bounds where it may be used.
  return [...ids];
}

// ── authenticatorData: where the "the user really passed the device check" bit lives ────────────────

export interface AuthenticatorFlags {
  /** Someone interacted with the authenticator at all. */
  userPresent: boolean;
  /** 🔒 The one that matters: the device verified the PERSON (face, fingerprint or PIN). */
  userVerified: boolean;
  hasAttestedCredential: boolean;
  hasExtensions: boolean;
}

export interface ParsedAuthenticatorData {
  rpIdHash: Buffer;
  flags: AuthenticatorFlags;
  signCounter: number;
  /** Present only on a registration response (the attested-credential-data flag is set). */
  credentialId: Buffer | null;
}

/**
 * Parse the fixed-layout prefix of authenticatorData: 32 bytes of rpIdHash, 1 flags byte, a 4-byte
 * big-endian counter, then optional attested credential data.
 *
 * Deliberately NOT a CBOR decoder. The only thing we need out of the variable tail is the credential
 * id, whose length is a plain 16-bit field — so a handful of offsets replaces a parser for a format
 * where a parsing bug would be a security bug. Returns null for anything too short to be real.
 */
export function parseAuthenticatorData(buf: Buffer): ParsedAuthenticatorData | null {
  if (!Buffer.isBuffer(buf) || buf.length < 37) return null;
  const flagsByte = buf[32];
  const flags: AuthenticatorFlags = {
    userPresent: (flagsByte & 0x01) !== 0,
    userVerified: (flagsByte & 0x04) !== 0,
    hasAttestedCredential: (flagsByte & 0x40) !== 0,
    hasExtensions: (flagsByte & 0x80) !== 0,
  };
  let credentialId: Buffer | null = null;
  if (flags.hasAttestedCredential && buf.length >= 55) {
    // 16 bytes AAGUID, then a 2-byte credential-id length, then the id itself.
    const idLen = buf.readUInt16BE(53);
    if (idLen > 0 && buf.length >= 55 + idLen) credentialId = buf.subarray(55, 55 + idLen);
  }
  return {
    rpIdHash: buf.subarray(0, 32),
    flags,
    signCounter: buf.readUInt32BE(33),
    credentialId,
  };
}

/** Does this authenticatorData belong to one of our sites? */
export function rpIdMatches(rpIdHash: Buffer, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const rpId of allowedRpIds(env)) {
    const expected = createHash('sha256').update(rpId, 'utf8').digest();
    if (expected.length === rpIdHash.length && timingSafeEqual(expected, rpIdHash)) return true;
  }
  return false;
}

// ── clientDataJSON: the browser's own statement of what it was asked and by whom ────────────────────

export interface ClientDataCheck {
  ok: boolean;
  /** Why it was refused — for the server log and the admin report, never for the user's screen. */
  reason: string;
}

export function verifyClientData(
  jsonText: string,
  opts: { expectedType: 'webauthn.create' | 'webauthn.get'; uid: string; nowMs: number; secret: string; env?: NodeJS.ProcessEnv },
): ClientDataCheck {
  let parsed: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    parsed = JSON.parse(jsonText) as typeof parsed;
  } catch {
    return { ok: false, reason: 'clientData is not JSON' };
  }
  if (parsed.type !== opts.expectedType) return { ok: false, reason: 'wrong ceremony type' };
  if (parsed.crossOrigin === true) return { ok: false, reason: 'cross-origin ceremony refused' };

  const origin = typeof parsed.origin === 'string' ? parsed.origin : '';
  if (!allowedOrigins(opts.env ?? process.env).includes(origin)) return { ok: false, reason: 'origin not allowed' };

  // The challenge travels as base64url of the bytes we handed the browser, which were the utf8 of our
  // signed challenge string. Verifying the MAC is what makes a replayed old assertion useless.
  const challengeBytes = base64urlToBuffer(typeof parsed.challenge === 'string' ? parsed.challenge : '');
  if (!challengeBytes.length) return { ok: false, reason: 'challenge missing' };
  if (!verifyChallenge(challengeBytes.toString('utf8'), opts.uid, opts.nowMs, opts.secret)) {
    return { ok: false, reason: 'challenge not ours, or expired' };
  }
  return { ok: true, reason: 'ok' };
}

// ── The signature itself ───────────────────────────────────────────────────────────────────────────

/**
 * Algorithms this vault accepts, by COSE identifier: ES256 and RS256.
 *
 * Restricted on purpose. Both verify under a plain SHA-256 digest through Node's `createVerify`, with
 * the key type carried by the SPKI itself — so ONE code path covers both and there is no algorithm
 * switch to get wrong. EdDSA (-8) is excluded precisely because it needs a different call shape, and a
 * silently-unverified signature is worse than a refused one.
 */
export const ACCEPTED_COSE_ALGS = [-7, -257] as const;

export function isAcceptedAlg(alg: unknown): boolean {
  return typeof alg === 'number' && (ACCEPTED_COSE_ALGS as readonly number[]).includes(alg);
}

/**
 * Verify the assertion signature over `authenticatorData || SHA256(clientDataJSON)`.
 *
 * `spkiDer` comes from the browser's own `getPublicKey()` at registration time, which is why this file
 * contains no CBOR: the attestation object would have to be decoded to dig the COSE key out by hand,
 * and the browser already offers the same key in a format Node reads directly.
 */
export function verifyAssertionSignature(args: {
  spkiDer: Buffer;
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
  signature: Buffer;
}): boolean {
  if (!args.spkiDer?.length || !args.authenticatorData?.length || !args.clientDataJSON?.length || !args.signature?.length) {
    return false;
  }
  try {
    const key = createPublicKey({ key: args.spkiDer, format: 'der', type: 'spki' });
    const verifier = createVerify('SHA256');
    verifier.update(Buffer.concat([args.authenticatorData, createHash('sha256').update(args.clientDataJSON).digest()]));
    verifier.end();
    return verifier.verify(key, args.signature);
  } catch {
    // A malformed key or signature is a refusal, never a throw that a caller might catch into success.
    return false;
  }
}

/**
 * Is this signature counter acceptable?
 *
 * A counter that went backwards is the classic sign of a cloned authenticator. But most platform
 * authenticators (phones, laptops) legitimately report a constant 0 forever, so insisting on an
 * increase would lock out exactly the devices this feature is FOR. The rule that holds in both worlds:
 * a counter that has ever been non-zero must keep moving; one that has always been zero may stay zero.
 */
export function signCounterOk(stored: number, incoming: number): boolean {
  if (!Number.isFinite(incoming) || incoming < 0) return false;
  if (!Number.isFinite(stored) || stored <= 0) return true;
  return incoming > stored;
}

// ── The fallback path ──────────────────────────────────────────────────────────────────────────────

/**
 * Did this ID token come from a sign-in that happened JUST NOW?
 *
 * `auth_time` is stamped by the identity provider, not by our client, which is the entire reason this
 * is a real check: a page cannot turn a token from this morning into a fresh one. Seconds in, because
 * that is the unit the token uses; anything unreadable is stale.
 */
export function isFreshReauth(authTimeSec: unknown, nowMs: number, maxAgeMs: number = REAUTH_MAX_AGE_MS): boolean {
  const t = typeof authTimeSec === 'number' ? authTimeSec : Number(authTimeSec);
  if (!Number.isFinite(t) || t <= 0) return false;
  const ageMs = nowMs - t * 1000;
  // A token from the future is a clock problem, not a proof. Allow a small skew, refuse the rest.
  if (ageMs < -60_000) return false;
  return ageMs <= maxAgeMs;
}

// ── What the user's screen is allowed to say ───────────────────────────────────────────────────────

/**
 * The one sentence shown when an unlock is refused.
 *
 * Always the same, whatever the real reason. "Challenge expired", "origin not allowed" and "signature
 * did not verify" are useful to us and useful to an attacker probing the endpoint, so the reason goes
 * to the server log and the screen gets a line that helps an honest user and nobody else.
 */
export const UNLOCK_REFUSED_MESSAGE = 'Could not confirm it is you. Try again, or use your account password.';
