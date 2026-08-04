// Supabase OAuth — the PURE core of "connect your database in one click" (ROADMAP #1 Phase 1.1).
//
// WHY THIS EXISTS. Today a user who wants a real database has to leave NavBharatAI, create a Supabase
// project, find two keys and paste them into Settings → Database. That is the single biggest reason a
// non-technical user gives up (CAPABILITY_AUDIT: Database 15/20 — "connect" is solid, "provision" is
// missing). Lovable and Replit both hand the user a working database the moment the app is created.
//
// WHY IT IS OAUTH AND NOT "WE HOST THE DATABASE". CLAUDE.md is explicit: user apps NEVER run on
// NavBharatAI's own Firebase/GCP billing. So we do not host their data — we ask THEIR Supabase account
// for permission and create the project INSIDE it. Their data, their bill, their account; we only do
// the work. That keeps the standing rule intact while removing all of the friction.
//
// SECURITY, stated once because every function below depends on it:
//   • PKCE (S256) — the authorization code is useless without the verifier, so an intercepted redirect
//     cannot be replayed by anyone else.
//   • SIGNED, EXPIRING STATE — `state` is an HMAC over (userId, nonce, expiry). This is CSRF protection
//     AND the binding that proves the callback belongs to the user who started the flow; without the
//     binding, an attacker could complete a flow in a victim's session and attach THEIR Supabase
//     account to the victim's apps. Verified in constant time.
//   • NO TOKENS HERE — this module never stores or logs a token. Token storage is the caller's job and
//     must go through the existing encrypted secret store.
//
// Pure + dependency-injected (randomness and clock are parameters) so every branch is unit-testable
// without network, without a real clock, and without a real secret.

import crypto from 'crypto';

/** Supabase's OAuth endpoints. Hosts are fixed — never taken from user input. */
export const SUPABASE_AUTHORIZE_URL = 'https://api.supabase.com/v1/oauth/authorize';
export const SUPABASE_TOKEN_URL = 'https://api.supabase.com/v1/oauth/token';

/**
 * The scopes we request, and NOTHING more.
 *
 * A smaller consent screen is a real product feature: the user is being asked to let a third party
 * into their database account, and every extra permission is a reason to say no. These five are the
 * minimum for Phase 1 (create the project, read its keys, run migrations, configure auth):
 *   projects:write  — create the project. Without it there is no feature at all.
 *   organizations:read — the create call needs an org_id; we cannot invent one.
 *   secrets:read    — read the new project's anon key so the app is wired automatically.
 *   auth:write      — Phase 1.3 one-click login (configure providers).
 *   database:write  — Phase 1.2 migrations + generated types.
 * Deliberately NOT requested: analytics, domains, edge functions, environments, REST, storage.
 */
export const SUPABASE_SCOPES = [
  'projects.write',
  'organizations.read',
  'secrets.read',
  'auth.write',
  'database.write',
] as const;

/** How long a started flow stays valid. Long enough to sign in + consent, short enough to limit replay. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface PkcePair {
  /** Kept server-side (never sent to Supabase in the authorize step). */
  verifier: string;
  /** Sent in the authorize step; Supabase checks the verifier against it at token exchange. */
  challenge: string;
}

/**
 * Create a PKCE verifier/challenge pair (S256).
 *
 * `randomBytes` is injectable so tests can pin the value; production uses the CSPRNG. The verifier is
 * base64url (RFC 7636 requires 43–128 chars of the unreserved set) — 32 random bytes gives 43.
 */
export function createPkcePair(randomBytes: (n: number) => Buffer = crypto.randomBytes): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Sign the OAuth `state`: `<userId>.<expiryMs>.<nonce>.<hmac>`.
 *
 * The userId is INSIDE the signed payload, so the callback can prove which account began the flow
 * rather than trusting whoever's cookie happens to arrive. Nonce makes two flows by the same user in
 * the same millisecond distinct.
 */
export function signOAuthState(
  secret: string,
  userId: string,
  expiresAtMs: number,
  nonce: string,
): string {
  const payload = `${userId}.${expiresAtMs}.${nonce}`;
  const sig = crypto.createHmac('sha256', secret).update(`supabase-oauth:${payload}`).digest('hex');
  return `${payload}.${sig}`;
}

export type StateFailure = 'malformed' | 'bad-signature' | 'expired';
export type StateResult =
  | { ok: true; userId: string }
  | { ok: false; reason: StateFailure };

/**
 * Verify a `state` produced by signOAuthState. Constant-time signature compare; expiry checked AFTER
 * the signature so a forged state can never be distinguished from an expired one by timing.
 *
 * Returns a REASON rather than a bare false, because the callback must tell the user something true
 * ("this link expired, please try again") instead of a generic failure.
 */
export function verifyOAuthState(secret: string, state: string, nowMs: number): StateResult {
  const parts = String(state ?? '').split('.');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [userId, expiryRaw, nonce, sig] = parts;
  const expiresAtMs = Number(expiryRaw);
  if (!userId || !nonce || !Number.isFinite(expiresAtMs)) return { ok: false, reason: 'malformed' };
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`supabase-oauth:${userId}.${expiryRaw}.${nonce}`)
    .digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };
  if (nowMs > expiresAtMs) return { ok: false, reason: 'expired' };
  return { ok: true, userId };
}

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/** Build the URL the user is sent to in order to grant access. Pure — no side effects, no network. */
export function buildSupabaseAuthorizeUrl(input: AuthorizeUrlInput): string {
  const u = new URL(SUPABASE_AUTHORIZE_URL);
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', input.state);
  u.searchParams.set('code_challenge', input.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('scope', SUPABASE_SCOPES.join(' '));
  return u.toString();
}

/** The form body for the code→token exchange (Supabase expects application/x-www-form-urlencoded). */
export function tokenExchangeBody(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): string {
  const p = new URLSearchParams();
  p.set('grant_type', 'authorization_code');
  p.set('code', input.code);
  p.set('redirect_uri', input.redirectUri);
  p.set('code_verifier', input.codeVerifier);
  return p.toString();
}

/** The form body for refreshing an expired access token. */
export function refreshTokenBody(refreshToken: string): string {
  const p = new URLSearchParams();
  p.set('grant_type', 'refresh_token');
  p.set('refresh_token', refreshToken);
  return p.toString();
}

/**
 * The HTTP Basic header Supabase's token endpoint expects (client_id:client_secret).
 *
 * Returned as a string the caller puts straight into the Authorization header — the secret never
 * reaches a query string or a log line this way.
 */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export type CallbackParse =
  | { ok: true; code: string; state: string }
  | { ok: false; reason: string };

/**
 * Validate what came back on the redirect.
 *
 * Supabase reports a refusal as `error`/`error_description` rather than an HTTP failure, so the
 * happy-path check alone would treat "user clicked Cancel" as a malformed request. The provider's
 * own description is passed through — it is the truest explanation available, and the caller is
 * responsible for showing it in NavBharatAI's voice.
 */
export function parseCallbackParams(query: Record<string, unknown>): CallbackParse {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const error = str(query.error);
  if (error) {
    const desc = str(query.error_description);
    return { ok: false, reason: desc || error };
  }
  const code = str(query.code);
  const state = str(query.state);
  if (!code) return { ok: false, reason: 'Supabase did not return an authorization code.' };
  if (!state) return { ok: false, reason: 'The security token was missing from the response.' };
  return { ok: true, code, state };
}

/** True when both OAuth credentials are configured — the honest gate for showing the feature at all. */
export function supabaseOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SUPABASE_OAUTH_CLIENT_ID && env.SUPABASE_OAUTH_CLIENT_SECRET);
}

/**
 * A user-facing message for a failed connect, in NavBharatAI's voice.
 *
 * WHITE-LABEL LAW: the user must never meet a raw provider error. But Supabase is the USER'S OWN
 * account here — they chose it and they are looking at its consent screen — so naming it is correct
 * and clearer than hiding it. What must never leak is our INTERNAL provider routing (which AI built
 * the app); that is a different surface entirely and is handled by redactProviderError.
 */
export function connectFailureMessage(reason: StateFailure | 'not-configured' | 'exchange-failed' | string): string {
  switch (reason) {
    case 'expired':
      return 'That connection link expired. Please tap "Connect database" again — it only stays valid for a few minutes.';
    case 'bad-signature':
    case 'malformed':
      return 'We could not verify that this connection request came from your session. Please start again from Settings → Database.';
    case 'not-configured':
      return 'Database connection is not available yet on this deployment.';
    case 'exchange-failed':
      return 'Supabase accepted the sign-in but we could not complete the connection. Please try once more.';
    default:
      return reason || 'The connection could not be completed.';
  }
}
