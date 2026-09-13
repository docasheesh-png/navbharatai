/**
 * THE SECRET VAULT'S 4-DIGIT PIN (admin 2026-09-13, verbatim: *"isko aur simple bana do! bas — PIN
 * banao, mobile number/email otp se PIN banao, PIN (4 digit pin se hi open ho) … pin bhul jaye to,
 * forget pin — otp — pin reset! waaki sab hata do … phone unlock etc sab hata do, simple rahne do"*).
 *
 * 🔴 A 4-DIGIT PIN IS 10,000 GUESSES. THAT IS THE WHOLE DESIGN PROBLEM, AND THIS FILE IS THE ANSWER.
 *
 * Four digits are not secret — a machine tries every one of them in under a second. A bank card is four
 * digits too, and it is genuinely safe for exactly three reasons, none of which is the PIN's length:
 *
 *   1. The PIN is checked by the BANK, not by the card. Here: the PIN is verified on the server, and the
 *      browser is never told whether a digit was right. A client-side comparison would make the lock
 *      theatre, which is the failure the vault's own door was rebuilt to avoid.
 *   2. The machine EATS THE CARD after a few wrong tries. Here: five wrong attempts and the vault locks
 *      for fifteen minutes, then an hour, then six, then a day (`afterWrongPin`). Ten thousand guesses
 *      at five per fifteen minutes is years, which is what turns four digits into a real lock.
 *   3. Nobody can read the PIN off the card. Here: only a scrypt hash with a per-user random salt is
 *      stored, so the stored record cannot be turned back into the PIN — not by us, not by anyone who
 *      obtains the database. scrypt is deliberately slow and memory-hard, so even 10,000 candidates
 *      against ONE stolen hash costs real time and RAM rather than microseconds.
 *
 * And the PIN is never the only thing standing between an attacker and a key: it buys a short-lived
 * TICKET (`vaultTicket.ts`), and the routes that can decrypt or delete refuse to act without one.
 *
 * WHY THE OTP EXISTS AT ALL. Setting a PIN must be harder than holding a session, or the PIN would be a
 * door an attacker sitting at an unlocked laptop could fit their own lock to. So creating or resetting
 * one requires a code delivered to the contact the ACCOUNT already owns — which is also, conveniently,
 * the only honest way to offer "forgot my PIN" without a support queue.
 *
 * Everything here is a PURE function over a record and a clock, so every rule above is unit-tested
 * against fixed values instead of being trusted. Firestore lives in the route, as it does for every
 * other rule in this vault.
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import { normaliseLockedAreas, type AppLockArea } from '../../lib/appLockAreas';

// ── The PIN itself ─────────────────────────────────────────────────────────────────────────────────

/** Exactly four digits, because that is what the admin asked for and what a phone keypad is for. */
export const PIN_LENGTH = 4;

/** Consecutive wrong PINs before the vault locks itself. */
export const MAX_PIN_ATTEMPTS = 5;

/**
 * How long each lock-out lasts, escalating.
 *
 * The first step is short on purpose: the overwhelming majority of wrong PINs are the owner misremembering,
 * and a day-long lock-out for a typo would make people stop using the vault — which is its own security
 * failure, because the keys then live in a notes app instead. The escalation is what makes a patient
 * attacker's arithmetic hopeless while a forgetful owner waits a quarter of an hour.
 */
export const LOCKOUT_STEPS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000] as const;

/**
 * PINs refused as too guessable.
 *
 * Kept SMALL and mechanical — 20 values out of 10,000 — rather than a long blocklist. A rule that
 * rejects a PIN somebody has already chosen and remembered pushes them to write it down, so this
 * refuses only the handful an attacker would genuinely try first: the same digit four times, and a
 * straight run up or down.
 */
export function pinRejectReason(pin: string): string {
  const s = String(pin ?? '');
  if (!/^\d{4}$/.test(s)) return 'Your PIN must be exactly 4 digits.';
  if (/^(\d)\1{3}$/.test(s)) return 'That PIN is too easy to guess. Choose four digits that are not all the same.';
  const digits = [...s].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  if (ascending || descending) return 'That PIN is too easy to guess. Avoid runs like 1234 or 4321.';
  return '';
}

export function isValidPin(pin: string): boolean {
  return pinRejectReason(pin) === '';
}

// ── Hashing: scrypt, a fresh salt per secret, and a constant-time compare ──────────────────────────

/**
 * scrypt cost. N=16384 puts one hash at roughly a tenth of a second and 16 MB of memory on this
 * hardware — unnoticeable when a user types their PIN once, and ruinous for anyone grinding a stolen
 * hash through all ten thousand candidates in parallel. Raise N if the server ever gets faster; never
 * lower it for speed, because the slowness IS the protection for a four-digit secret.
 */
export const SCRYPT_N = 16_384;
const SCRYPT_KEYLEN = 32;

export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

/** Hash a PIN or an OTP. Returns hex. Pure given (value, salt). */
export function hashPin(value: string, salt: string): string {
  return scryptSync(String(value ?? ''), String(salt ?? ''), SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex');
}

/**
 * Constant-time comparison of a candidate against a stored hash.
 *
 * Constant-time because a comparison that returns early on the first wrong byte leaks, over many
 * attempts, how much of a hash matched. It cannot be exploited through the lock-out above, but a
 * `===` here would be a habit that later gets copied somewhere it can be.
 */
export function matchesPin(value: string, salt: string, storedHash: string): boolean {
  const stored = String(storedHash ?? '');
  if (!stored || !salt) return false;
  const candidate = hashPin(value, salt);
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── The OTP that authorises creating or resetting a PIN ────────────────────────────────────────────

/** Six digits: long enough that guessing it inside its ten minutes is hopeless, short enough to retype. */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60_000;
/** Wrong codes allowed on ONE sent OTP before it is burnt and a new one must be requested. */
export const OTP_MAX_ATTEMPTS = 5;
/** Shortest gap between two sends, so the button cannot be used to flood somebody's inbox. */
export const OTP_RESEND_COOLDOWN_MS = 60_000;
/** Sends per user per day. A real user needs one or two; this bounds both spam and our own mail bill. */
export const OTP_MAX_PER_DAY = 10;

/** A cryptographically random code, zero-padded so every code is the same length on screen. */
export function newOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

export type OtpPurpose = 'create' | 'reset';

/** The stored state of one user's vault PIN. Every field has a safe zero value — see `emptyPinRecord`. */
export interface VaultPinRecord {
  pinHash: string;
  pinSalt: string;
  /** Consecutive wrong PINs since the last success or lock-out. */
  failCount: number;
  /** Epoch ms until which unlocking is refused. 0 = not locked. */
  lockedUntilMs: number;
  /** How many lock-outs this user has earned in a row — the index into LOCKOUT_STEPS_MS. */
  lockLevel: number;
  otpHash: string;
  otpSalt: string;
  otpExpiresAtMs: number;
  otpAttempts: number;
  otpPurpose: OtpPurpose | '';
  otpSentAtMs: number;
  otpSendsToday: number;
  /** The UTC day `otpSendsToday` counts, so the daily cap cannot be reset by a device clock. */
  otpSendDay: string;
  /**
   * Which parts of the app this PIN guards (admin 2026-09-13 — the generalised App Lock).
   *
   * Stored on the SERVER beside the PIN, never in the browser, because the list IS security
   * configuration: a device-local flag saying "nothing is locked" could be flipped by the same person
   * the lock exists to stop. Always contains the mandatory areas — see `normaliseLockedAreas`.
   */
  lockedAreas: AppLockArea[];
}

export function emptyPinRecord(): VaultPinRecord {
  return {
    pinHash: '', pinSalt: '',
    failCount: 0, lockedUntilMs: 0, lockLevel: 0,
    otpHash: '', otpSalt: '', otpExpiresAtMs: 0, otpAttempts: 0, otpPurpose: '',
    otpSentAtMs: 0, otpSendsToday: 0, otpSendDay: '',
    lockedAreas: normaliseLockedAreas([]),
  };
}

/**
 * Read a record out of whatever Firestore returned, coercing every field.
 *
 * A missing or junk field must become its safe zero rather than `undefined`: `undefined > nowMs` is
 * false, so a corrupt `lockedUntilMs` would silently mean "not locked", and a NaN `failCount` would
 * never reach the attempt limit. Coercing here is what keeps the pure rules below honest about inputs
 * they did not choose.
 */
export function readPinRecord(raw: unknown): VaultPinRecord {
  const d = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const purpose = str(d.otp_purpose);
  return {
    pinHash: str(d.pin_hash),
    pinSalt: str(d.pin_salt),
    failCount: num(d.fail_count),
    lockedUntilMs: num(d.locked_until_ms),
    lockLevel: num(d.lock_level),
    otpHash: str(d.otp_hash),
    otpSalt: str(d.otp_salt),
    otpExpiresAtMs: num(d.otp_expires_at_ms),
    otpAttempts: num(d.otp_attempts),
    otpPurpose: purpose === 'create' || purpose === 'reset' ? purpose : '',
    otpSentAtMs: num(d.otp_sent_at_ms),
    otpSendsToday: num(d.otp_sends_today),
    otpSendDay: str(d.otp_send_day),
    // A missing list is the DEFAULT (only the mandatory areas), never "everything locked" — a corrupt
    // record must not be able to shut somebody out of their own app.
    lockedAreas: normaliseLockedAreas(d.locked_areas),
  };
}

/** The Firestore shape. Kept beside `readPinRecord` so the two can never disagree about a field name. */
export function writePinRecord(r: VaultPinRecord): Record<string, unknown> {
  return {
    pin_hash: r.pinHash,
    pin_salt: r.pinSalt,
    fail_count: r.failCount,
    locked_until_ms: r.lockedUntilMs,
    lock_level: r.lockLevel,
    otp_hash: r.otpHash,
    otp_salt: r.otpSalt,
    otp_expires_at_ms: r.otpExpiresAtMs,
    otp_attempts: r.otpAttempts,
    otp_purpose: r.otpPurpose,
    otp_sent_at_ms: r.otpSentAtMs,
    otp_sends_today: r.otpSendsToday,
    otp_send_day: r.otpSendDay,
    locked_areas: normaliseLockedAreas(r.lockedAreas),
  };
}

export function hasPin(r: VaultPinRecord): boolean {
  return !!r.pinHash && !!r.pinSalt;
}

// ── The lock-out, which is what makes four digits enough ───────────────────────────────────────────

export interface PinGate {
  locked: boolean;
  /** Milliseconds until unlocking is allowed again. 0 when not locked. */
  lockedForMs: number;
  /** Attempts remaining before the next lock-out. */
  attemptsLeft: number;
}

export function pinGate(r: VaultPinRecord, nowMs: number): PinGate {
  const lockedForMs = Math.max(0, r.lockedUntilMs - nowMs);
  return {
    locked: lockedForMs > 0,
    lockedForMs,
    attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - r.failCount),
  };
}

/**
 * The record after a WRONG PIN.
 *
 * On the attempt that reaches the limit the counter resets and the lock level advances, so the next
 * lock-out is longer. The level is NOT reset by time — only by a correct PIN — because an attacker who
 * simply waits out each window would otherwise face the same fifteen minutes for ever.
 */
export function afterWrongPin(r: VaultPinRecord, nowMs: number): VaultPinRecord {
  const failCount = r.failCount + 1;
  if (failCount < MAX_PIN_ATTEMPTS) return { ...r, failCount };
  const step = LOCKOUT_STEPS_MS[Math.min(r.lockLevel, LOCKOUT_STEPS_MS.length - 1)];
  return { ...r, failCount: 0, lockLevel: r.lockLevel + 1, lockedUntilMs: nowMs + step };
}

/** The record after a CORRECT PIN — the only thing that forgives the escalation. */
export function afterCorrectPin(r: VaultPinRecord): VaultPinRecord {
  return { ...r, failCount: 0, lockLevel: 0, lockedUntilMs: 0 };
}

// ── Sending an OTP ─────────────────────────────────────────────────────────────────────────────────

/** The UTC day stamp the daily send cap counts against. Server clock only — a device cannot move it. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export interface OtpSendGate {
  allowed: boolean;
  /** Plain-language refusal for the user's screen. Empty when allowed. */
  reason: string;
  /** How long to wait, when the refusal is a cooldown. */
  waitMs: number;
}

export function otpSendGate(r: VaultPinRecord, nowMs: number): OtpSendGate {
  const waitMs = Math.max(0, r.otpSentAtMs + OTP_RESEND_COOLDOWN_MS - nowMs);
  if (waitMs > 0) {
    const secs = Math.ceil(waitMs / 1000);
    return { allowed: false, reason: `A code was just sent. Please wait ${secs} second${secs === 1 ? '' : 's'} before asking for another.`, waitMs };
  }
  // A day that does not match resets the counter, which is why the stamp is stored alongside it.
  const sentToday = r.otpSendDay === utcDay(nowMs) ? r.otpSendsToday : 0;
  if (sentToday >= OTP_MAX_PER_DAY) {
    return { allowed: false, reason: 'Too many codes requested today. Please try again tomorrow.', waitMs: 0 };
  }
  return { allowed: true, reason: '', waitMs: 0 };
}

/** The record after a code was genuinely SENT. Stores only the hash — never the code. */
export function afterOtpSent(r: VaultPinRecord, code: string, purpose: OtpPurpose, nowMs: number): VaultPinRecord {
  const salt = newSalt();
  const day = utcDay(nowMs);
  return {
    ...r,
    otpHash: hashPin(code, salt),
    otpSalt: salt,
    otpExpiresAtMs: nowMs + OTP_TTL_MS,
    otpAttempts: 0,
    otpPurpose: purpose,
    otpSentAtMs: nowMs,
    otpSendsToday: (r.otpSendDay === day ? r.otpSendsToday : 0) + 1,
    otpSendDay: day,
  };
}

// ── Checking an OTP ────────────────────────────────────────────────────────────────────────────────

export interface OtpCheck {
  ok: boolean;
  reason: string;
  /** The record to store afterwards — a burnt code on success, an incremented attempt on failure. */
  next: VaultPinRecord;
}

/**
 * Check a typed code against the stored hash.
 *
 * A used code is BURNT on success (the hash is cleared), so the same code can never set a PIN twice —
 * which matters because the code travels through an inbox that may be read later.
 */
export function otpCheck(r: VaultPinRecord, code: string, nowMs: number): OtpCheck {
  const typed = String(code ?? '').trim();
  if (!r.otpHash || !r.otpSalt) {
    return { ok: false, reason: 'Ask for a code first, then enter it here.', next: r };
  }
  if (r.otpExpiresAtMs <= nowMs) {
    return { ok: false, reason: 'That code has expired. Ask for a new one.', next: { ...r, otpHash: '', otpSalt: '', otpPurpose: '' } };
  }
  if (r.otpAttempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'Too many wrong codes. Ask for a new one.', next: { ...r, otpHash: '', otpSalt: '', otpPurpose: '' } };
  }
  if (!/^\d+$/.test(typed) || typed.length !== OTP_LENGTH) {
    // Counted as an attempt: a malformed guess is still a guess, and not counting it would hand an
    // attacker unlimited tries simply by sending the wrong number of digits.
    return { ok: false, reason: `Enter the ${OTP_LENGTH}-digit code from your email.`, next: { ...r, otpAttempts: r.otpAttempts + 1 } };
  }
  if (!matchesPin(typed, r.otpSalt, r.otpHash)) {
    const next = { ...r, otpAttempts: r.otpAttempts + 1 };
    const left = Math.max(0, OTP_MAX_ATTEMPTS - next.otpAttempts);
    return {
      ok: false,
      reason: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.',
      next,
    };
  }
  return { ok: true, reason: '', next: { ...r, otpHash: '', otpSalt: '', otpPurpose: '', otpAttempts: 0 } };
}

// ── What the user is told about where the code went ────────────────────────────────────────────────

/**
 * Mask a destination so the screen can confirm WHICH address got the code without reprinting it.
 *
 * Printing the full address would be a small disclosure on a shared screen and, more practically,
 * useless: the user already knows their own email. What they need is enough to recognise it.
 */
export function maskEmail(email: string): string {
  const value = String(email ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1) return '';
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = name.slice(0, Math.min(2, name.length));
  // The dot count is the EXACT number of hidden characters, never a minimum. Padding a two-letter local
  // part with a decorative dot would describe an address the user does not have, and the point of showing
  // a masked destination is recognition — a mask that lies about the length defeats it.
  return `${head}${'•'.repeat(name.length - head.length)}@${domain}`;
}

/** Mask a phone number down to its last two digits, in the same spirit. */
export function maskPhone(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `${'•'.repeat(Math.max(2, digits.length - 2))}${digits.slice(-2)}`;
}

/**
 * The email a user receives. NavBharatAI's own voice — no provider or vendor name anywhere in it, per
 * the White-Label Law, and no hint of which internal system sent it.
 */
export function otpEmailMessage(code: string, purpose: OtpPurpose): string {
  const what = purpose === 'reset' ? 'reset your Secrets & API Keys PIN' : 'set up your Secrets & API Keys PIN';
  const minutes = Math.round(OTP_TTL_MS / 60_000);
  return [
    `Your NavBharatAI verification code is ${code}`,
    '',
    `Enter it in NavBharatAI to ${what}. The code expires in ${minutes} minutes and can be used once.`,
    '',
    'If you did not ask for this, you can ignore this email — nothing has changed, and your saved keys stay locked.',
  ].join('\n');
}

/** Subject line for that email, separate from the Monitor's alert subjects. */
export function otpEmailSubject(): string {
  return 'NavBharatAI — your verification code';
}

// ── The one account that cannot be emailed ──────────────────────────────────────────────────────────

/**
 * How recently a sign-in must have happened to stand in for an emailed code.
 *
 * 🔴 WHY THIS EXISTS AT ALL, since the admin asked for exactly one door. An account that signs in BY
 * MOBILE NUMBER has no email address on it, so there is nowhere to send a code — and a user with no way
 * to create a PIN would be locked out of their own API keys permanently, which breaks the one absolute
 * rule far worse than a second path does. For those accounts the proof is a genuinely fresh sign-in,
 * and the sign-in they perform IS a mobile OTP: Firebase texts the code, and `auth_time` inside the
 * SIGNED token is what we read — so this is still a server-side check and still an OTP to their phone.
 *
 * Fifteen minutes rather than five: the journey is sign out → receive an SMS → type it → come back, and
 * a five-minute window would fail honest users on a slow network.
 */
export const FRESH_SIGN_IN_MAX_AGE_MS = 15 * 60_000;

/**
 * Did this ID token come from a sign-in that happened just now?
 *
 * `auth_time` is stamped by the identity provider, not by our client, which is the entire reason this is
 * a real check: a page cannot turn a token from this morning into a fresh one. Seconds in, because that
 * is the unit the token uses; anything unreadable is stale.
 */
export function isFreshSignIn(authTimeSec: unknown, nowMs: number, maxAgeMs: number = FRESH_SIGN_IN_MAX_AGE_MS): boolean {
  const t = typeof authTimeSec === 'number' ? authTimeSec : Number(authTimeSec);
  if (!Number.isFinite(t) || t <= 0) return false;
  const ageMs = nowMs - t * 1000;
  // A token from the future is a clock problem, not a proof. Allow a small skew, refuse the rest.
  if (ageMs < -60_000) return false;
  return ageMs <= maxAgeMs;
}

/**
 * Which channel a code can be delivered on, and what to show the user.
 *
 * ONE function so the status route, the send route and the screen can never disagree — a screen that
 * offers "email me a code" for an account the server will refuse is the shape of bug that makes a
 * feature feel broken rather than unavailable.
 */
export type OtpChannel = 'email' | 'fresh-sign-in' | 'none';

export interface OtpDelivery {
  channel: OtpChannel;
  /** Masked destination for the screen, or '' when there is nothing to name. */
  destination: string;
}

export function otpDelivery(contact: { email: string | null; phone: string | null }): OtpDelivery {
  const email = String(contact.email ?? '').trim();
  if (email) return { channel: 'email', destination: maskEmail(email) };
  const phone = String(contact.phone ?? '').trim();
  if (phone) return { channel: 'fresh-sign-in', destination: maskPhone(phone) };
  return { channel: 'none', destination: '' };
}
