// U-7 (foundation) — Public API keys: generation, hashing, scope checks, verification.
//
// A pure, crypto-backed core for programmatic access to NavBharatAI. A key is shown to the user
// exactly ONCE at creation; only its SHA-256 hash is ever stored, so a store leak cannot reveal a
// usable key. Verification is timing-safe. Scopes bound what a key may do.
//
// HONESTY / SECURITY: plaintext keys are never persisted or logged; the manager only hands the
// plaintext back to the creator once. Comparisons use crypto.timingSafeEqual to avoid leaking the
// hash byte-by-byte. Nothing here talks to a store or the network — it is pure and unit-tested.

import crypto from 'crypto';

/** The scopes a key can be granted. Keep this the single source of truth. */
export const API_SCOPES = ['read:profile', 'read:usage', 'read:builds'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const KEY_PREFIX = 'nbai_';

export interface GeneratedApiKey {
  /** Opaque id used to reference the key in the store / management UI. */
  id: string;
  /** The full secret — shown to the user ONCE, never stored. */
  plaintext: string;
  /** SHA-256 hex of the plaintext — the ONLY form persisted. */
  hash: string;
  /** Human-friendly prefix for display, e.g. "nbai_a1b2". */
  displayPrefix: string;
  /** Last 4 chars for display, e.g. "…8f3c". */
  last4: string;
}

/** SHA-256 hex of a key's plaintext. The only representation ever stored. */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(String(plaintext), 'utf8').digest('hex');
}

/** Generate a new API key. The plaintext is returned once; persist only `hash`. */
export function generateApiKey(): GeneratedApiKey {
  const secret = crypto.randomBytes(24).toString('base64url'); // 32 url-safe chars
  const plaintext = `${KEY_PREFIX}${secret}`;
  const id = crypto.randomBytes(9).toString('base64url');
  return {
    id,
    plaintext,
    hash: hashApiKey(plaintext),
    displayPrefix: plaintext.slice(0, KEY_PREFIX.length + 4),
    last4: plaintext.slice(-4),
  };
}

/** Timing-safe check that a presented plaintext matches a stored hash. */
export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  if (!plaintext || !storedHash) return false;
  const presented = hashApiKey(plaintext);
  if (presented.length !== storedHash.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

/** Validate + normalize a requested scope list to the known set (dedup, drop unknowns). */
export function normalizeScopes(requested: unknown): ApiScope[] {
  if (!Array.isArray(requested)) return [];
  const set = new Set<ApiScope>();
  for (const s of requested) {
    if (typeof s === 'string' && (API_SCOPES as readonly string[]).includes(s)) set.add(s as ApiScope);
  }
  return [...set];
}

/** Whether a key's granted scopes include the one an endpoint requires. */
export function hasScope(granted: readonly string[] | undefined, required: ApiScope): boolean {
  return Array.isArray(granted) && granted.includes(required);
}

/**
 * Extract a presented API key from a request's headers. Accepts `X-API-Key: nbai_…` or
 * `Authorization: Bearer nbai_…`. Returns null when no NavBharatAI key is present (so a Firebase
 * Bearer token is never mistaken for an API key).
 */
export function extractApiKey(headers: { 'x-api-key'?: unknown; authorization?: unknown }): string | null {
  const x = headers['x-api-key'];
  if (typeof x === 'string' && x.startsWith(KEY_PREFIX)) return x.trim();
  const auth = headers['authorization'];
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1].startsWith(KEY_PREFIX)) return m[1].trim();
  }
  return null;
}
