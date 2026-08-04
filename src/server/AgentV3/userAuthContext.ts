// User-connected authentication context (admin 2026-07-29).
//
// When a user connects a dedicated AUTH provider in Settings → App Settings → Authentication, the
// chosen provider is saved as the `AUTH_PROVIDER` marker and the credentials as encrypted env
// secrets. At build time those secrets are already injected into the app's `.env`. This turns the
// connection into an explicit, proactive instruction so the builder uses THAT provider for all
// login/signup/session — with the exact env-var names — instead of inventing its own auth.
//
// COHERENCE with the connected-DATABASE context: Supabase and Firebase provide auth as PART of their
// database connection, and their auth env-vars are the SAME as their DB env-vars. So:
//   • Clerk / Auth0 have AUTH-SPECIFIC env-vars → we can infer them even without the marker.
//   • Supabase / Firebase share env-vars with the DB → we require the explicit AUTH_PROVIDER marker,
//     so a DB-only connection is never mistaken for a separate auth choice (no double instruction).
// The emitted block also tells the builder: if a database is ALSO connected, use the DB for DATA and
// this provider for AUTH — so the two contexts never conflict.
//
// Pure + unit-tested. Names the USER'S OWN auth provider (correct — not a NavBharatAI AI vendor), so
// the white-label law does not apply. Builder system prompt only; never shown to the end user.

/** The marker secret written by Settings → Authentication that records the chosen provider. */
export const AUTH_PROVIDER_MARKER = 'AUTH_PROVIDER';

interface AuthProviderSpec {
  label: string;
  /** The real SDK/package the builder must use. */
  sdk: string;
  /** The env-var names this provider's credentials live under (mirrors the client). */
  envVars: string[];
  /** True when these env-vars are unique to auth (Clerk/Auth0). False when shared with the DB
   *  connection (Supabase/Firebase) — those require the explicit marker to count as an auth choice. */
  authSpecific: boolean;
}

const AUTH_PROVIDERS: Record<string, AuthProviderSpec> = {
  clerk: {
    label: 'Clerk',
    sdk: '@clerk/clerk-react',
    envVars: ['VITE_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'],
    authSpecific: true,
  },
  auth0: {
    label: 'Auth0',
    sdk: '@auth0/auth0-react',
    envVars: ['VITE_AUTH0_DOMAIN', 'VITE_AUTH0_CLIENT_ID'],
    authSpecific: true,
  },
  supabase: {
    label: 'Supabase Auth',
    sdk: '@supabase/supabase-js',
    envVars: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    authSpecific: false,
  },
  firebase: {
    label: 'Firebase Auth',
    sdk: 'firebase',
    envVars: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'],
    authSpecific: false,
  },
};

/** Only the AUTH-SPECIFIC env-var names (Clerk/Auth0) are safe to infer a connection from. */
const AUTH_SPECIFIC_ENV_VARS = Array.from(
  new Set(Object.values(AUTH_PROVIDERS).filter(p => p.authSpecific).flatMap(p => p.envVars)),
);

/** Which auth-specific provider owns a given env-var name (first match wins). */
function providerForEnvVar(name: string): string | null {
  for (const [id, spec] of Object.entries(AUTH_PROVIDERS)) {
    if (spec.authSpecific && spec.envVars.includes(name)) return id;
  }
  return null;
}

/**
 * Build the "an auth provider is already connected — use it" instruction block for the builder's
 * system prompt, from the user's loaded vault secrets. Returns '' when no dedicated auth provider is
 * connected (so plain builds and prompt-regression tests are unaffected). Pure.
 *
 * The AUTH_PROVIDER marker wins. Without a marker, only Clerk/Auth0 can be inferred (from their
 * auth-specific env-vars) — Supabase/Firebase are NOT inferred, because their keys belong to the DB
 * connection and are already handled by userDatabaseContext.
 */
export function userAuthContext(vaultSecrets: Record<string, string> | null | undefined): string {
  const secrets = vaultSecrets && typeof vaultSecrets === 'object' ? vaultSecrets : {};
  const nonEmpty = (name: string): boolean => typeof secrets[name] === 'string' && secrets[name].trim() !== '';

  let providerId = (secrets[AUTH_PROVIDER_MARKER] || '').trim().toLowerCase();
  const hasMarker = !!providerId && !!AUTH_PROVIDERS[providerId];
  if (!hasMarker) {
    // No valid marker → only infer the auth-specific providers (Clerk/Auth0).
    const inferred = AUTH_SPECIFIC_ENV_VARS.filter(nonEmpty).map(providerForEnvVar).find(Boolean);
    providerId = inferred || '';
  }
  if (!providerId || !AUTH_PROVIDERS[providerId]) return '';

  const spec = AUTH_PROVIDERS[providerId];
  const presentVars = spec.envVars.filter(nonEmpty);
  // With only the marker (no credentials yet), still guide the builder + surface an honest "set" note.
  if (presentVars.length === 0 && !hasMarker) return '';
  const varsToName = presentVars.length > 0 ? presentVars : spec.envVars;

  return [
    '## CONNECTED AUTHENTICATION — USE IT, DO NOT BUILD YOUR OWN',
    `The user has ALREADY connected ${spec.label} for login/signup (Settings → App Settings →`,
    `Authentication). Its credentials are injected into this app's \`.env\` under these exact`,
    `variables: ${varsToName.join(', ')}.`,
    'You MUST:',
    `- Use the real ${spec.label} SDK (${spec.sdk}) for ALL authentication — signup, login, logout, sessions, protected routes — reading these EXACT \`.env\` variables (never hardcode a value).`,
    '- If a database is ALSO connected, use the database for DATA and this provider for AUTH.',
    'You MUST NOT:',
    '- Roll your own password/session auth, or substitute a different auth provider.',
    '- Ask the user to set up authentication — they already did.',
    '- Invent new env-var names for auth; reuse the ones above.',
    presentVars.length === 0
      ? `NOTE: the ${spec.label} credentials are not all set yet — wire the real integration and surface an honest "set ${spec.envVars[0]}" note rather than building your own auth.`
      : '',
  ].filter(Boolean).join('\n');
}
