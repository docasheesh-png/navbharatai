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

/**
 * The scopes a key can be granted. Keep this the single source of truth.
 *
 * 🔴 EVERY SCOPE HERE MUST HAVE AN ENDPOINT THAT REQUIRES IT (admin 2026-09-17: "api keys farzi nahi
 * ho"). Before that date `read:usage` and `read:builds` were tickable in the UI and required by NOTHING —
 * a user could grant them, and nothing anywhere changed. That is the second absolute rule's forbidden
 * state, the same one the inert "Provider Kill Switches" were removed for. `developerApi.test.ts`
 * asserts each scope against the route that enforces it, so a new scope cannot ship as a label.
 *
 *   all               → every route below, AND anything added later. See `FULL_ACCESS_SCOPE`.
 *   read:profile      → GET  /api/v1/me
 *   read:usage        → GET  /api/v1/usage   (and the usage half of /me)
 *   read:builds       → GET  /api/v1/builds
 *   ai:chat           → POST /api/v1/chat/completions — NavBharatAI's AI, on the holder's wallet
 *   ai:professionals  → POST /api/v1/professionals/:id/chat — the ~80 expert AIs, by id
 *   ai:images         → POST /api/v1/images/generations — NavBharatAI Pro images, ₹1 each
 */
export const API_SCOPES = [
  'all', 'read:profile', 'read:usage', 'read:builds', 'ai:chat', 'ai:professionals', 'ai:images',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/**
 * 🔑 FULL ACCESS — one scope that satisfies every check, present and FUTURE (admin 2026-09-22).
 *
 * The admin asked for it, and it is what every API a developer already uses offers: a key you make
 * once for your own backend and never revisit. Ticking six boxes to reach six endpoints is friction
 * that buys nothing when the answer is "all of them".
 *
 * ⚠️ **THE HONEST COST, WRITTEN DOWN RATHER THAN DISCOVERED: it auto-grants scopes that do not exist
 * yet.** A key made today carries whatever door NavBharatAI opens next, without the holder deciding.
 * That is genuinely what "full access" means, so the answer is not to weaken it but to SAY it — the
 * screen where the key is made spells it out, and the narrow scopes remain the recommended default
 * for a key that leaves your own machine. The per-key daily ₹ cap still binds a full-access key
 * exactly as it binds any other: `all` widens WHAT a key may do, never HOW MUCH it may spend.
 */
export const FULL_ACCESS_SCOPE = 'all';

/** Every scope EXCEPT `all` — the ones that name exactly one door, which is what `SCOPE_ROUTES` maps. */
export type SpecificApiScope = Exclude<ApiScope, 'all'>;
export const SPECIFIC_API_SCOPES: readonly SpecificApiScope[] =
  API_SCOPES.filter((s): s is SpecificApiScope => s !== FULL_ACCESS_SCOPE);

/**
 * What each scope lets a key do, in the words the user reads when choosing it.
 *
 * Scopes are how the user controls WHAT they share (admin 2026-09-17: "user is api se kya kya share
 * karna chahta hai, woh bhi control kar sake"). A code like `read:usage` is not a description, so the
 * screen shows this beside it — and it is served by the server, not typed twice in the client, so the
 * two cannot drift.
 */
export const API_SCOPE_DESCRIPTIONS: Readonly<Record<ApiScope, { title: string; detail: string }>> = {
  // ⚠️ The warning is part of the description, not a footnote elsewhere: this is the one scope whose
  // meaning changes after the key is made, and the moment it is ticked is the only moment to say so.
  all: { title: 'Full access', detail: 'Everything below, and anything added to the API later — without you editing this key. Convenient for your own backend; prefer the specific permissions for a key that leaves your machine. Your daily limit still applies.' },
  'read:profile': { title: 'Profile', detail: 'Your display name and account id.' },
  'read:usage': { title: 'Usage & balance', detail: "Your wallet balance and this month's builds and spend." },
  'read:builds': { title: 'Your apps', detail: 'The list of apps you have built, with their live links.' },
  'ai:chat': { title: "NavBharatAI's AI", detail: 'Ask NavBharatAI questions from your own program or app. Costs come from your wallet, up to the daily limit you set on the key.' },
  'ai:professionals': { title: 'Expert AIs', detail: 'Ask any NavBharatAI expert by name — Teacher, Lawyer, Doctor-side health helpers, Kisan, Accountant and the rest. Same wallet, same daily limit.' },
  'ai:images': { title: 'Image generation', detail: 'Make images from your own program, on the Pro engine. Each image costs ₹1 from your wallet and counts towards this key\u2019s daily limit.' },
};

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

/**
 * Whether a key's granted scopes include the one an endpoint requires.
 *
 * 🔑 `all` satisfies EVERY check — that is the whole of what full access means, and putting it here
 * (in the ONE function every guard already calls) is what makes it true for routes nobody has written
 * yet. A route that asked `scopes.includes(x)` directly would silently refuse a full-access key, so
 * there must be no second way to ask this question.
 */
export function hasScope(granted: readonly string[] | undefined, required: ApiScope): boolean {
  if (!Array.isArray(granted)) return false;
  return granted.includes(FULL_ACCESS_SCOPE) || granted.includes(required);
}

/**
 * The scopes a key really carries, expanded. `['all']` reads back as every scope.
 *
 * Used where a key must SHOW what it can do (`GET /api/v1/key`) rather than be checked against one
 * requirement — a developer debugging a 403 needs the list, and "all" alone is not a list.
 */
export function effectiveScopes(granted: readonly string[] | undefined): ApiScope[] {
  if (!Array.isArray(granted)) return [];
  if (granted.includes(FULL_ACCESS_SCOPE)) return [...API_SCOPES];
  return API_SCOPES.filter((s) => granted.includes(s));
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
