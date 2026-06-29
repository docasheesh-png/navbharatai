/**
 * P-SEC.3 — TOTP (Time-based One-Time Password, RFC 6238) — native implementation.
 *
 * Implemented directly on Node's `crypto` (HMAC-SHA1 + dynamic truncation, RFC 4226/6238) so
 * NavBharatAI gains app-based MFA WITHOUT adding a third-party dependency to the supply chain
 * (every dep widens the P-SEC.6/P-SEC.10 attack surface). It is verified against the official
 * RFC 6238 Appendix-B test vectors in `tests/totp.test.ts`, so correctness is provable, not
 * assumed.
 *
 * Compatible with Google Authenticator, Authy, 1Password, Microsoft Authenticator, etc. —
 * standard 6-digit, 30-second, SHA1 codes with a base32 secret and an `otpauth://` enrol URI.
 */
import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode raw bytes to RFC 4648 base32 (no padding) — the format authenticator apps expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode an RFC 4648 base32 string (case-insensitive, padding/space tolerant) to bytes. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a cryptographically-random base32 TOTP secret (default 20 bytes = 160 bits). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

/**
 * Compute the HOTP/TOTP code for a given counter. Pure — exported for vector testing.
 * `digits` defaults to 6; `algorithm` to sha1 (the authenticator-app standard).
 */
export function hotp(secret: Buffer, counter: number, digits = 6, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  // Counter as an 8-byte big-endian buffer.
  const buf = Buffer.alloc(8);
  // Use BigInt to avoid 32-bit overflow for large counters (RFC vectors go past 2^31).
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const hmac = crypto.createHmac(algorithm, secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

export interface TotpOptions {
  /** Step size in seconds (default 30). */
  step?: number;
  /** Number of code digits (default 6). */
  digits?: number;
  /** Unix epoch ms to evaluate at (default: real now). */
  now?: number;
}

/** Generate the current TOTP code for a base32 secret. */
export function generateTotp(base32Secret: string, opts: TotpOptions = {}): string {
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const now = opts.now ?? Date.now();
  const counter = Math.floor(now / 1000 / step);
  return hotp(base32Decode(base32Secret), counter, digits);
}

/**
 * Verify a user-supplied token against the secret, allowing ±`window` steps of clock drift
 * (default 1 → accepts the previous, current, and next 30s window). Constant-ish time per
 * candidate; returns true on first match. Rejects malformed input without throwing.
 */
export function verifyTotp(base32Secret: string, token: string, opts: TotpOptions & { window?: number } = {}): boolean {
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const now = opts.now ?? Date.now();
  const window = opts.window ?? 1;
  const cleaned = String(token || '').replace(/\s+/g, '');
  if (!/^\d+$/.test(cleaned) || cleaned.length !== digits) return false;
  let secret: Buffer;
  try {
    secret = base32Decode(base32Secret);
  } catch {
    return false;
  }
  const counter = Math.floor(now / 1000 / step);
  for (let w = -window; w <= window; w++) {
    const candidate = hotp(secret, counter + w, digits);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleaned))) return true;
  }
  return false;
}

/**
 * Build the `otpauth://totp/...` provisioning URI an authenticator app reads from a QR code
 * (or that the user can paste). `label` is usually "Issuer:account"; `issuer` is shown as the
 * account's provider name in the app.
 */
export function totpAuthUri(base32Secret: string, label: string, issuer: string): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(label)}?secret=${base32Secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
