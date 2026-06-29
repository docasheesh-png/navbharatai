import { describe, it, expect } from 'vitest';
import {
  base32Encode, base32Decode, generateTotpSecret, hotp,
  generateTotp, verifyTotp, totpAuthUri,
} from '../src/server/lib/totp';

/**
 * P-SEC.3 — TOTP (RFC 6238) correctness, verified against the official Appendix-B vectors.
 */
describe('totp — base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = Buffer.from('Hello, NavBharatAI!', 'utf8');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('matches a known RFC 4648 vector', () => {
    // "foobar" → MZXW6YTBOI (RFC 4648 §10)
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
  });

  it('is tolerant of lowercase / spaces / padding', () => {
    expect(base32Decode('mzxw 6ytb oi==').toString()).toBe('foobar');
  });

  it('throws on invalid characters', () => {
    expect(() => base32Decode('0189!')).toThrow();
  });
});

describe('totp — generateTotpSecret', () => {
  it('produces a decodable base32 secret of the expected length', () => {
    const secret = generateTotpSecret(20);
    expect(base32Decode(secret).length).toBe(20);
    expect(generateTotpSecret()).not.toBe(generateTotpSecret()); // random
  });
});

describe('totp — RFC 6238 Appendix-B vectors (SHA1, 8 digits)', () => {
  // The RFC test secret is the ASCII string "12345678901234567890" (20 bytes).
  const secretBuf = Buffer.from('12345678901234567890', 'ascii');
  const step = 30;
  const cases: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [unixSeconds, expected] of cases) {
    it(`T=${unixSeconds} → ${expected}`, () => {
      const counter = Math.floor(unixSeconds / step);
      expect(hotp(secretBuf, counter, 8)).toBe(expected);
    });
  }
});

describe('totp — generate + verify (6-digit, 30s)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

  it('generateTotp matches the truncated RFC vector at T=59 (6 digits)', () => {
    // 8-digit RFC value at T=59 is 94287082 → last 6 digits = 287082.
    expect(generateTotp(secret, { now: 59_000 })).toBe('287082');
  });

  it('verifyTotp accepts a freshly generated code', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(secret, { now });
    expect(verifyTotp(secret, code, { now })).toBe(true);
  });

  it('accepts a code from the adjacent window (clock drift, ±1)', () => {
    const now = 1_700_000_000_000;
    const prevWindowCode = generateTotp(secret, { now: now - 30_000 });
    expect(verifyTotp(secret, prevWindowCode, { now, window: 1 })).toBe(true);
  });

  it('rejects a code two windows away', () => {
    const now = 1_700_000_000_000;
    const farCode = generateTotp(secret, { now: now - 90_000 });
    expect(verifyTotp(secret, farCode, { now, window: 1 })).toBe(false);
  });

  it('rejects malformed / wrong-length / non-numeric input without throwing', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, '', { now })).toBe(false);
    expect(verifyTotp(secret, '12345', { now })).toBe(false);   // too short
    expect(verifyTotp(secret, 'abcdef', { now })).toBe(false);  // non-numeric
    expect(verifyTotp('not!base32', '123456', { now })).toBe(false); // bad secret
  });
});

describe('totp — otpauth URI', () => {
  it('builds a standard provisioning URI', () => {
    const uri = totpAuthUri('JBSWY3DPEHPK3PXP', 'NavBharatAI:admin', 'NavBharatAI');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=NavBharatAI');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
