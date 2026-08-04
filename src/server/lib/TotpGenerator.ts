// Roadmap breadth — TOTP two-factor authentication (authenticator-app 2FA) recipe.
//
// Distinct from generate_otp (which is SMS/phone one-time codes): this is RFC 6238 TOTP — the 6-digit codes
// from Google Authenticator / Authy / 1Password. It is DEPENDENCY-FREE (node:crypto only): a base32 secret,
// an otpauth:// provisioning URI (pair with generate_qr to show the QR), and a constant-time verify with a
// ±1-step drift window. Real, correct crypto — verified in tests against the official RFC 6238 test vectors,
// not a shaped stub. Pure builder → the caller writes the file. No API key.

// The emitted server/lib/totp.ts. Kept as a single source constant so the recipe test can materialize and
// execute the EXACT emitted code against RFC 6238 vectors (proving correctness, zero drift).
export const TOTP_LIB_SOURCE = `import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP (time-based one-time password) — the codes an authenticator app (Google Authenticator,
// Authy, 1Password) shows. Dependency-free. Flow: on 2FA setup, generateTotpSecret() → store it for the
// user → show totpAuthUrl(...) as a QR (scan it) → later, verifyTotp(secret, codeFromUser) gates login.

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 encode (no padding) — the format authenticator apps expect for the secret. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 4648 base32 decode. Ignores spaces/padding and is case-insensitive (users paste messy secrets). */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a new random base32 secret (default 20 bytes = 160 bits, per RFC 6238). Store it per user. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** HOTP (RFC 4226) — the counter-based primitive TOTP builds on. */
function hotp(keyBuf: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (JS bitwise is 32-bit, so split hi/lo).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', keyBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

export interface TotpOptions {
  /** Code length. Default 6. */
  digits?: number;
  /** Time step in seconds. Default 30. */
  step?: number;
  /** Override the current time (ms since epoch) — for testing. Defaults to Date.now(). */
  now?: number;
}

/** The current TOTP code for a secret. Mostly for tests/debugging — clients compute their own. */
export function generateTotp(secret: string, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? 6;
  const step = opts.step ?? 30;
  const now = opts.now ?? Date.now();
  const counter = Math.floor(now / 1000 / step);
  return hotp(base32Decode(secret), counter, digits);
}

/** Verify a user-supplied code against the secret, allowing ±window steps of clock drift (default ±1).
 *  Constant-time compare so a timing side-channel can't leak the code. */
export function verifyTotp(secret: string, token: string, opts: TotpOptions & { window?: number } = {}): boolean {
  const digits = opts.digits ?? 6;
  const step = opts.step ?? 30;
  const window = opts.window ?? 1;
  const now = opts.now ?? Date.now();
  const clean = String(token).replace(/\\s+/g, '');
  if (!/^[0-9]+$/.test(clean) || clean.length !== digits) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(now / 1000 / step);
  const supplied = Buffer.from(clean);
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(key, counter + i, digits));
    if (candidate.length === supplied.length && timingSafeEqual(candidate, supplied)) return true;
  }
  return false;
}

/** The otpauth:// provisioning URI to render as a QR code (pair with the QR recipe). Scanning it adds the
 *  account to the user's authenticator app. issuer = your app name, account = the user's email/username. */
export function totpAuthUrl(secret: string, opts: { issuer: string; account: string; digits?: number; step?: number }): string {
  const issuer = encodeURIComponent(opts.issuer);
  const account = encodeURIComponent(opts.account);
  const params = new URLSearchParams({
    secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(opts.digits ?? 6),
    period: String(opts.step ?? 30),
  });
  return \`otpauth://totp/\${issuer}:\${account}?\${params.toString()}\`;
}
`;

export interface TotpConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'TOTP two-factor auth wired at server/lib/totp.ts (RFC 6238, dependency-free node:crypto). Flow: on 2FA ' +
  'setup call generateTotpSecret() and store it for the user; render totpAuthUrl({issuer,account}) as a QR ' +
  '(pair with generate_qr) for them to scan into Google Authenticator/Authy; on login, gate with ' +
  'verifyTotp(secret, code) — it allows ±1 step of clock drift and compares in constant time. This is ' +
  'authenticator-app 2FA (distinct from generate_otp, which is SMS one-time codes). No API key, no dependency.';

export function generateTotpIntegration(): TotpConfig {
  return {
    files: { 'server/lib/totp.ts': TOTP_LIB_SOURCE },
    dependencies: [],
    instructions: INSTRUCTIONS,
  };
}
