// User-connected database context (admin 2026-07-20).
//
// When a user connects their OWN database in Settings → App Settings → Database, the chosen
// provider is saved as the `ENGINEER_DB_PROVIDER` marker and the credentials as encrypted env
// secrets (VITE_SUPABASE_*, DATABASE_URL, …). At build time those secrets are already injected
// into the app's `.env` (loadUserVaultSecrets → setUserSecrets). But that alone was not enough:
// the BUILDER was never TOLD a database is already connected, so it could scaffold its own
// default store, pick a different provider, or ask the user to set one up — ignoring the DB they
// deliberately wired. This turns the connection into an explicit, proactive instruction so the
// builder uses the connected database, with the exact env-var names, and never creates a new one.
//
// Pure + unit-tested. The provider named here is the USER'S OWN database choice (shown in their
// own settings), NOT one of NavBharatAI's internal AI vendors — so naming it is correct, and the
// white-label law (which hides our AI providers) does not apply. This block is injected into the
// builder's system prompt only; it is never shown to the end user.

/** The marker secret written by Settings → Database that records the chosen provider. */
export const DB_PROVIDER_MARKER = 'ENGINEER_DB_PROVIDER';

interface DbProviderSpec {
  label: string;
  /** The real SDK/package the builder must use. */
  sdk: string;
  /** The env-var names this provider's credentials live under (mirrors the client's buildEnvKeys). */
  envVars: string[];
}

const DB_PROVIDERS: Record<string, DbProviderSpec> = {
  supabase: { label: 'Supabase', sdk: '@supabase/supabase-js', envVars: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] },
  firebase: {
    label: 'Firebase', sdk: 'firebase',
    envVars: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID'],
  },
  mongodb: { label: 'MongoDB Atlas', sdk: 'mongodb', envVars: ['MONGODB_URI'] },
  neon: { label: 'Neon (Postgres)', sdk: 'the Postgres client (pg / @neondatabase/serverless / Prisma)', envVars: ['DATABASE_URL'] },
  appwrite: { label: 'Appwrite', sdk: 'appwrite', envVars: ['VITE_APPWRITE_ENDPOINT', 'VITE_APPWRITE_PROJECT_ID'] },
  other: { label: 'the connected database', sdk: 'the appropriate client for its connection string', envVars: ['DATABASE_URL'] },
};

/** All env-var names any known provider can use — lets us detect a connection even without the marker. */
const ALL_DB_ENV_VARS = Array.from(new Set(Object.values(DB_PROVIDERS).flatMap(p => p.envVars)));

/** Which known provider owns a given env-var name (first match wins). */
function providerForEnvVar(name: string): string | null {
  for (const [id, spec] of Object.entries(DB_PROVIDERS)) {
    if (id !== 'other' && spec.envVars.includes(name)) return id;
  }
  return null;
}

/**
 * Build the "a database is already connected — use it, don't create a new one" instruction block
 * for the builder's system prompt, from the user's loaded vault secrets. Returns '' when the user
 * has NOT connected a database (so plain builds and prompt-regression tests are unaffected). Pure.
 *
 * Detection is robust: it trusts the `ENGINEER_DB_PROVIDER` marker when present, and otherwise
 * infers the provider from which DB env-vars are actually populated.
 */
export function userDatabaseContext(vaultSecrets: Record<string, string> | null | undefined): string {
  const secrets = vaultSecrets && typeof vaultSecrets === 'object' ? vaultSecrets : {};
  const nonEmpty = (name: string): boolean => typeof secrets[name] === 'string' && secrets[name].trim() !== '';

  // 1) Resolve the provider id: the marker wins; else infer from populated env-vars.
  let providerId = (secrets[DB_PROVIDER_MARKER] || '').trim().toLowerCase();
  if (!providerId || !DB_PROVIDERS[providerId]) {
    const inferred = ALL_DB_ENV_VARS.filter(nonEmpty).map(providerForEnvVar).find(Boolean);
    providerId = inferred || (nonEmpty('DATABASE_URL') ? 'other' : '');
  }
  if (!providerId || !DB_PROVIDERS[providerId]) return '';

  const spec = DB_PROVIDERS[providerId];
  // 2) Which of this provider's env-vars are actually present (so the builder is told the real ones).
  const presentVars = spec.envVars.filter(nonEmpty);
  // If the marker names a provider but NO credential env-var is present, still guide the builder to
  // that provider (it can surface an honest "set <VAR>" note) — but only if a marker was explicit.
  const hasMarker = !!(secrets[DB_PROVIDER_MARKER] || '').trim();
  if (presentVars.length === 0 && !hasMarker) return '';
  const varsToName = presentVars.length > 0 ? presentVars : spec.envVars;

  return [
    '## CONNECTED DATABASE — USE IT, DO NOT CREATE A NEW ONE',
    `The user has ALREADY connected their own ${spec.label} database (Settings → Database). Its`,
    `credentials are injected into this app's \`.env\` under these exact variables: ${varsToName.join(', ')}.`,
    'You MUST:',
    `- Use the real ${spec.label} SDK (${spec.sdk}) and read these EXACT \`.env\` variables — never hardcode a value.`,
    '- Wire any data/auth/storage the app needs to THIS connected database.',
    'You MUST NOT:',
    '- Provision, scaffold, or spin up a new/different database, an in-memory store, or a local file DB.',
    '- Substitute a different provider, or ask the user to create or configure a database — they already did.',
    `- Invent new env-var names for the database; reuse the ones above.`,
    presentVars.length === 0
      ? `NOTE: the ${spec.label} credentials are not all set yet — wire the real integration and surface an honest "set ${spec.envVars[0]}" note rather than swapping in a different store.`
      : '',
  ].filter(Boolean).join('\n');
}
