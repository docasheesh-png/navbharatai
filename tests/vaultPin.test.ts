/**
 * THE 4-DIGIT PIN'S RULES — and why this file is the most important test in the vault.
 *
 * Four digits are 10,000 guesses. The PIN is only a real lock because of three things, and NONE of them
 * is visible by reading the screen: the comparison happens on the server, the wrong attempts are counted
 * and punished with an escalating lock-out, and only a salted scrypt hash is stored. Every one of those
 * is a pure function here, so each is pinned against fixed values rather than trusted.
 *
 * The cases chosen are the ones that would silently turn the lock back into theatre: a lock-out that
 * forgets itself, an attempt that does not count, a code that can be replayed, a daily cap a device
 * clock could reset.
 */
import { describe, it, expect } from 'vitest';
import {
  PIN_LENGTH, MAX_PIN_ATTEMPTS, LOCKOUT_STEPS_MS, pinRejectReason, isValidPin,
  newSalt, hashPin, matchesPin,
  emptyPinRecord, readPinRecord, writePinRecord, hasPin,
  pinGate, afterWrongPin, afterCorrectPin,
  newOtpCode, OTP_LENGTH, OTP_TTL_MS, OTP_MAX_ATTEMPTS, OTP_MAX_PER_DAY, OTP_RESEND_COOLDOWN_MS,
  otpSendGate, afterOtpSent, otpCheck, utcDay,
  maskEmail, maskPhone, otpEmailMessage, otpEmailSubject,
  isFreshSignIn, FRESH_SIGN_IN_MAX_AGE_MS, otpDelivery,
} from '../src/server/lib/vaultPin';

const NOW = 1_800_000_000_000;

describe('what counts as a PIN', () => {
  it('is exactly four digits', () => {
    expect(PIN_LENGTH).toBe(4);
    expect(isValidPin('8274')).toBe(true);
    for (const bad of ['', '1', '123', '12345', '12a4', ' 123', '１２３４']) {
      expect(isValidPin(bad), bad).toBe(false);
    }
  });

  it('refuses the handful an attacker tries first, and says why in plain words', () => {
    for (const weak of ['0000', '1111', '9999', '1234', '4321', '6789']) {
      expect(isValidPin(weak), weak).toBe(false);
      expect(pinRejectReason(weak)).toMatch(/too easy to guess/i);
    }
  });

  it('but does NOT refuse ordinary PINs — a rule that rejects what people remember makes them write it down', () => {
    for (const fine of ['1357', '2580', '4812', '1023', '9137']) {
      expect(isValidPin(fine), fine).toBe(true);
    }
  });

  it('a wrap-around run is still a run (0123 and 3210 are not special cases)', () => {
    expect(isValidPin('0123')).toBe(false);
    expect(isValidPin('3210')).toBe(false);
  });
});

describe('the PIN is stored as a hash, and nothing else', () => {
  it('the stored value is not the PIN, and two users with the same PIN do not share a hash', () => {
    const saltA = newSalt();
    const saltB = newSalt();
    expect(saltA).not.toBe(saltB);
    const a = hashPin('8274', saltA);
    const b = hashPin('8274', saltB);
    // The salt is what stops one precomputed table from opening every account with the same PIN.
    expect(a).not.toBe(b);
    expect(a).not.toContain('8274');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the right PIN and rejects every other one', () => {
    const salt = newSalt();
    const stored = hashPin('8274', salt);
    expect(matchesPin('8274', salt, stored)).toBe(true);
    for (const wrong of ['8275', '2748', '827', '', '8274 ']) {
      expect(matchesPin(wrong, salt, stored), wrong).toBe(false);
    }
  });

  it('a missing salt or hash can never match — an empty record does not open the vault', () => {
    expect(matchesPin('8274', '', hashPin('8274', 'x'))).toBe(false);
    expect(matchesPin('8274', newSalt(), '')).toBe(false);
    expect(hasPin(emptyPinRecord())).toBe(false);
  });
});

describe('🔒 the lock-out, which is the whole reason four digits are enough', () => {
  it('counts down the allowed attempts', () => {
    let r = emptyPinRecord();
    expect(pinGate(r, NOW).attemptsLeft).toBe(MAX_PIN_ATTEMPTS);
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      r = afterWrongPin(r, NOW);
      expect(pinGate(r, NOW).locked, `after ${i} wrong`).toBe(false);
      expect(pinGate(r, NOW).attemptsLeft).toBe(MAX_PIN_ATTEMPTS - i);
    }
  });

  it('locks on the attempt that reaches the limit', () => {
    let r = emptyPinRecord();
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) r = afterWrongPin(r, NOW);
    const gate = pinGate(r, NOW);
    expect(gate.locked).toBe(true);
    expect(gate.lockedForMs).toBe(LOCKOUT_STEPS_MS[0]);
  });

  it('escalates, so waiting out each window does not buy unlimited guesses', () => {
    let r = emptyPinRecord();
    const seen: number[] = [];
    for (let round = 0; round < LOCKOUT_STEPS_MS.length + 1; round++) {
      // Each round: five wrong attempts, then wait the lock-out out completely.
      for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) r = afterWrongPin(r, NOW);
      seen.push(r.lockedUntilMs - NOW);
      r = { ...r, lockedUntilMs: 0 };
    }
    // 🔴 The escalation is the point: if this test ever reads [15m, 15m, 15m…] the lock has become a
    // speed bump — 10,000 guesses at 5 per 15 minutes is survivable for an attacker who is patient.
    expect(seen).toEqual([...LOCKOUT_STEPS_MS, LOCKOUT_STEPS_MS[LOCKOUT_STEPS_MS.length - 1]]);
  });

  it('the lock level survives the clock — only a correct PIN forgives it', () => {
    let r = emptyPinRecord();
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) r = afterWrongPin(r, NOW);
    expect(r.lockLevel).toBe(1);
    // A year later it is still level 1 — time does not launder an attacker's history.
    expect(pinGate(r, NOW + 365 * 24 * 3600_000).locked).toBe(false);
    expect(r.lockLevel).toBe(1);

    const forgiven = afterCorrectPin(r);
    expect(forgiven.lockLevel).toBe(0);
    expect(forgiven.failCount).toBe(0);
    expect(forgiven.lockedUntilMs).toBe(0);
  });

  it('a corrupt stored record reads as LOCKED-capable rather than as unlimited attempts', () => {
    // The danger is the other way round: if junk became `undefined`, `undefined > now` is false and the
    // vault would quietly stop locking. Coercion is what prevents that.
    const r = readPinRecord({ fail_count: 'banana', locked_until_ms: null, lock_level: -4 });
    expect(r.failCount).toBe(0);
    expect(r.lockedUntilMs).toBe(0);
    expect(r.lockLevel).toBe(0);
    expect(pinGate(r, NOW).attemptsLeft).toBe(MAX_PIN_ATTEMPTS);
  });

  it('round-trips through the Firestore shape without losing a field', () => {
    const r = afterOtpSent({ ...emptyPinRecord(), failCount: 3, lockLevel: 2, lockedUntilMs: NOW + 500 }, '123456', 'reset', NOW);
    expect(readPinRecord(writePinRecord(r))).toEqual(r);
  });
});

describe('the code that authorises creating or resetting a PIN', () => {
  it('is six random digits, zero-padded so it is always six on screen', () => {
    expect(OTP_LENGTH).toBe(6);
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = newOtpCode();
      expect(c).toMatch(/^\d{6}$/);
      codes.add(c);
    }
    // 200 draws from a million should not collide into a handful — a constant code would show up here.
    expect(codes.size).toBeGreaterThan(150);
  });

  it('stores only the hash — the record never contains the code', () => {
    const r = afterOtpSent(emptyPinRecord(), '427391', 'create', NOW);
    expect(JSON.stringify(writePinRecord(r))).not.toContain('427391');
    expect(r.otpExpiresAtMs).toBe(NOW + OTP_TTL_MS);
    expect(r.otpPurpose).toBe('create');
  });

  it('accepts the right code once, then BURNS it', () => {
    const r = afterOtpSent(emptyPinRecord(), '427391', 'create', NOW);
    const first = otpCheck(r, '427391', NOW + 1_000);
    expect(first.ok).toBe(true);
    // A code that travelled through an inbox must not be reusable by whoever reads that inbox later.
    expect(otpCheck(first.next, '427391', NOW + 2_000).ok).toBe(false);
  });

  it('expires, and an expired code is cleared rather than left to be retried', () => {
    const r = afterOtpSent(emptyPinRecord(), '427391', 'create', NOW);
    const out = otpCheck(r, '427391', NOW + OTP_TTL_MS + 1);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/expired/i);
    expect(out.next.otpHash).toBe('');
  });

  it('counts a WRONG code, and a MALFORMED one too', () => {
    let r = afterOtpSent(emptyPinRecord(), '427391', 'create', NOW);
    const wrong = otpCheck(r, '000000', NOW);
    expect(wrong.ok).toBe(false);
    expect(wrong.next.otpAttempts).toBe(1);
    // 🔴 A malformed guess that did not count would be unlimited tries: send five letters, then guess.
    const malformed = otpCheck(r, 'abc', NOW);
    expect(malformed.next.otpAttempts).toBe(1);

    r = wrong.next;
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) r = otpCheck(r, '000000', NOW).next;
    const burnt = otpCheck(r, '427391', NOW);
    expect(burnt.ok, 'the right code must not work after the attempts are spent').toBe(false);
    expect(burnt.next.otpHash).toBe('');
  });

  it('refuses to check anything when no code was ever sent', () => {
    const out = otpCheck(emptyPinRecord(), '427391', NOW);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/ask for a code/i);
  });
});

describe('how often a code can be sent', () => {
  it('enforces a cooldown, and says how long to wait', () => {
    const r = afterOtpSent(emptyPinRecord(), '427391', 'create', NOW);
    const blocked = otpSendGate(r, NOW + 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.waitMs).toBe(OTP_RESEND_COOLDOWN_MS - 1_000);
    expect(blocked.reason).toMatch(/wait 59 seconds/i);
    expect(otpSendGate(r, NOW + OTP_RESEND_COOLDOWN_MS).allowed).toBe(true);
  });

  it('caps sends per day, counted on the SERVER clock so a device cannot reset it', () => {
    let r = emptyPinRecord();
    let t = NOW;
    for (let i = 0; i < OTP_MAX_PER_DAY; i++) {
      expect(otpSendGate(r, t).allowed, `send ${i + 1}`).toBe(true);
      r = afterOtpSent(r, newOtpCode(), 'create', t);
      t += OTP_RESEND_COOLDOWN_MS;
    }
    expect(otpSendGate(r, t).allowed).toBe(false);
    expect(otpSendGate(r, t).reason).toMatch(/too many codes/i);

    // The next UTC day starts fresh — and the stamp is what makes that a date, not a sliding window.
    const tomorrow = new Date(utcDay(t) + 'T00:00:00Z').getTime() + 24 * 3600_000 + 1_000;
    expect(utcDay(tomorrow)).not.toBe(utcDay(t));
    expect(otpSendGate(r, tomorrow).allowed).toBe(true);
  });
});

describe('what the user is told about where the code went', () => {
  it('masks an email down to something recognisable but not readable aloud', () => {
    expect(maskEmail('aashishcpmt09@gmail.com')).toBe('aa•••••••••••@gmail.com');
    expect(maskEmail('ab@x.io')).toBe('ab@x.io');
    expect(maskEmail('')).toBe('');
    expect(maskEmail('not-an-email')).toBe('');
  });

  it('masks a phone to its last two digits', () => {
    expect(maskPhone('+919876543210')).toBe('••••••••••10');
    expect(maskPhone('12')).toBe('');
  });

  it('🔒 the email names no vendor and no internal system — the White-Label Law applies to mail too', () => {
    const body = `${otpEmailSubject()} ${otpEmailMessage('427391', 'reset')}`;
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Anthropic', 'Gemini', 'Vertex', 'Grok', 'Resend', 'Firebase', 'scrypt']) {
      expect(body.toLowerCase(), vendor).not.toContain(vendor.toLowerCase());
    }
    expect(body).toContain('NavBharatAI');
    expect(body).toContain('427391');
    expect(otpEmailMessage('427391', 'reset')).toMatch(/reset your Secrets & API Keys PIN/);
    expect(otpEmailMessage('427391', 'create')).toMatch(/set up your Secrets & API Keys PIN/);
  });

  it('the subject carries NO code — a one-time code must not show on a lock screen', () => {
    expect(otpEmailSubject()).not.toMatch(/\d/);
  });
});

describe('the one account that cannot be emailed', () => {
  it('an account with an email is emailed; one with only a phone proves itself by signing in again', () => {
    expect(otpDelivery({ email: 'a@b.com', phone: null })).toEqual({ channel: 'email', destination: maskEmail('a@b.com') });
    expect(otpDelivery({ email: null, phone: '+919876543210' })).toEqual({ channel: 'fresh-sign-in', destination: maskPhone('+919876543210') });
    expect(otpDelivery({ email: null, phone: null })).toEqual({ channel: 'none', destination: '' });
    // An email WINS when both exist: a code we send and verify ourselves is the stronger of the two.
    expect(otpDelivery({ email: 'a@b.com', phone: '+919876543210' }).channel).toBe('email');
  });

  it('a fresh sign-in means minutes, and an unreadable or ancient auth_time is never fresh', () => {
    const nowSec = Math.floor(NOW / 1000);
    expect(isFreshSignIn(nowSec - 10, NOW)).toBe(true);
    expect(isFreshSignIn(nowSec - Math.floor(FRESH_SIGN_IN_MAX_AGE_MS / 1000) + 5, NOW)).toBe(true);
    expect(isFreshSignIn(nowSec - Math.floor(FRESH_SIGN_IN_MAX_AGE_MS / 1000) - 60, NOW)).toBe(false);
    // A small clock skew forward is tolerated; a token from ten minutes in the future is not a proof.
    expect(isFreshSignIn(nowSec + 30, NOW)).toBe(true);
    expect(isFreshSignIn(nowSec + 600, NOW)).toBe(false);
    for (const bad of [undefined, null, 0, -1, 'abc', NaN, {}]) {
      expect(isFreshSignIn(bad as unknown, NOW), String(bad)).toBe(false);
    }
  });
});
