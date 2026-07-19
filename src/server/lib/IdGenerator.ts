// U-4 (verified recipe modules) — secure IDs & tokens (dependency-free, node:crypto).
//
// Apps constantly need generated identifiers: a public order/record id, a short share code, and — critically
// — the secret token in a password-reset or email-verification link. The common mistake is generating these
// with Math.random(), which is NOT cryptographically secure: its output is predictable, so an attacker can
// guess a reset token and hijack an account. This recipe ships the correct primitives, all backed by the
// CSPRNG in node:crypto: newId() (a standard UUID v4), shortId() (a compact URL-safe code for share links),
// and secureToken() (a long, unguessable token for reset/verify/API-key flows). No dependency, no env keys.
// PURE builder; correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export interface IdConfig {
  files: Record<string, string>;
  instructions: string;
}

const ID_SERVER = `import crypto from 'node:crypto';

// A standard UUID v4 (e.g. "3f2504e0-4f89-41d3-9a0c-0305e82c3301"). Great as a primary key or public record
// id — unguessable and collision-safe. Uses the crypto RNG (NOT Math.random).
export function newId(): string {
  return crypto.randomUUID();
}

// A compact, URL-safe id of the requested length (default 12), e.g. "Xk9fA2bQ7mLp". Uses a base62 alphabet
// (no ambiguous URL-unsafe chars) with rejection sampling so every character is uniformly random — no modulo
// bias. Good for short share links, coupon/referral codes, slugs' uniqueness suffix.
export function shortId(length = 12): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      // 252 = floor(256 / 62) * 62 — reject the top bytes to keep the distribution uniform (no modulo bias).
      if (bytes[i] < 252) out += alphabet[bytes[i] % 62];
    }
  }
  return out;
}

// A long, high-entropy, URL-safe secret token (default 32 bytes → 43 base64url chars). Use this for
// password-reset links, email-verification links, and API keys. Store only a HASH of it (e.g. SHA-256), the
// same way you never store a raw password — then compare hashes on redemption.
export function secureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Hash a token for at-rest storage (so a DB leak does not expose live reset/verify tokens or API keys).
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
`;

const INSTRUCTIONS =
  'Secure IDs/tokens wired at server/lib/ids.ts (no dependency — node:crypto). Use newId() for a UUID v4 ' +
  'primary key / public record id, shortId() for a compact URL-safe share/referral code, and secureToken() ' +
  'for password-reset / email-verification links and API keys — all from the crypto CSPRNG, never ' +
  'Math.random() (which is predictable and would let an attacker guess a reset token). Store only ' +
  'hashToken(token) at rest and compare hashes on redemption, the same way you never store a raw password. ' +
  'No API key needed.';

export function generateIdIntegration(): IdConfig {
  return {
    files: { 'server/lib/ids.ts': ID_SERVER },
    instructions: INSTRUCTIONS,
  };
}
