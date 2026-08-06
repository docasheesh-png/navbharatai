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

import { dbProvider, ALL_DB_ENV_VARS, providerForEnvVar, envVarsFor, familyGuidance } from '../../lib/dbProviders';

/** The marker secret written by Settings → Database that records the chosen provider. */
export const DB_PROVIDER_MARKER = 'ENGINEER_DB_PROVIDER';

// The provider catalogue is SHARED with the settings screen (src/lib/dbProviders.ts). It used to be a
// second, independent copy here — and a second copy of an env-var name is how the screen ends up saving
// a credential the builder was never told to read, i.e. the user connects a database and the app
// ignores it. One definition, both consumers derived from it (admin 2026-08-06).

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
  if (!dbProvider(providerId)) {
    // providerForEnvVar deliberately refuses a name more than one provider writes — DATABASE_URL
    // belongs to Postgres, MySQL, Neon and PlanetScale alike, so naming a brand from it would be a
    // guess presented as a fact. Such a connection resolves to the generic entry instead, which still
    // tells the builder to use the real client for that connection string.
    const inferred = ALL_DB_ENV_VARS.filter(nonEmpty).map(providerForEnvVar).find(Boolean);
    providerId = inferred || (nonEmpty('DATABASE_URL') ? 'other' : '');
  }
  const spec = dbProvider(providerId);
  if (!spec) return '';

  // 2) Which of this provider's env-vars are actually present (so the builder is told the real ones).
  const presentVars = envVarsFor(spec.id).filter(nonEmpty);
  // If the marker names a provider but NO credential env-var is present, still guide the builder to
  // that provider (it can surface an honest "set <VAR>" note) — but only if a marker was explicit.
  const hasMarker = !!(secrets[DB_PROVIDER_MARKER] || '').trim();
  if (presentVars.length === 0 && !hasMarker) return '';
  const varsToName = presentVars.length > 0 ? presentVars : envVarsFor(spec.id);

  return [
    '## CONNECTED DATABASE — USE IT, DO NOT CREATE A NEW ONE',
    `The user has ALREADY connected their own ${spec.label} database (Settings → Database). Its`,
    `credentials are injected into this app's \`.env\` under these exact variables: ${varsToName.join(', ')}.`,
    'You MUST:',
    `- Use the real ${spec.label} SDK (${spec.sdk}) and read these EXACT \`.env\` variables — never hardcode a value.`,
    // The DIALECT is the half that used to be missing, and it is the half that breaks an app silently:
    // Postgres-only SQL against a cPanel MySQL fails at the first query, long after the build reported
    // success. Named per FAMILY so every brand of the same engine gets identical, correct instructions.
    `- ${familyGuidance(spec.family)}`,
    '- Wire any data/auth/storage the app needs to THIS connected database.',
    'You MUST NOT:',
    '- Provision, scaffold, or spin up a new/different database, an in-memory store, or a local file DB.',
    '- Substitute a different provider, or ask the user to create or configure a database — they already did.',
    '- Invent new env-var names for the database; reuse the ones above.',
    presentVars.length === 0
      ? `NOTE: the ${spec.label} credentials are not all set yet — wire the real integration and surface an honest "set ${envVarsFor(spec.id)[0]}" note rather than swapping in a different store.`
      : '',
  ].filter(Boolean).join('\n');
}

/**
 * The guidance injected when NO database is connected: if the app being built actually needs to
 * persist data, the builder must proactively tell the user — IN THEIR OWN LANGUAGE — to connect
 * their own database in Settings → Database (never silently use an in-memory store as the final
 * answer, and never NavBharatAI's own database — the user owns their data). If the app does not
 * need persistence, this is ignored. Pure + unit-tested; self-contained on the language rule so it
 * localises correctly for any of India's 20+ languages via the model's language mirroring.
 */
export function noDatabaseConnectedContext(): string {
  return [
    '## DATABASE — NONE CONNECTED YET (guide the user if the app needs one)',
    'The user has NOT connected their own database. IF (and ONLY IF) this app needs to PERSIST data',
    '— accounts/login, saved records, user-generated content, orders, bookings, anything that must',
    'survive a page refresh — then, as part of your reply, you MUST:',
    '- Tell the user CLEARLY that this app needs a database and that they should connect their own at',
    '  **Settings → App Settings → Database** — they can use ANY database they like: Supabase, Firebase,',
    '  MongoDB, Neon, PostgreSQL on any host, MySQL/MariaDB (including shared hosting like Hostinger or',
    '  cPanel), PlanetScale, Turso, Upstash Redis, Appwrite, or any other connection string. Mention that',
    '  NavBharatAI can also create a free one for them in one tap, inside their OWN Supabase account.',
    '  Say in one short line WHY (so their data is saved and stays',
    '  private to them), and that once they connect it you will wire it in automatically on the next build.',
    '- Write this message IN THE USER\'S OWN LANGUAGE — mirror the exact language they wrote their request',
    '  in (Hindi, Hinglish, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Punjabi,',
    '  Odia, English, or any other) — never default to English or Hindi just because of the product.',
    'You MUST NOT:',
    '- Use any NavBharatAI database for the user\'s app — the user owns their data on THEIR OWN database.',
    '- Silently ship an in-memory/local-only store AS IF it were real persistence. You MAY use a clearly',
    '  TEMPORARY local store so the app previews now, but you must state honestly that data will NOT',
    '  persist until they connect their own database.',
    'If the app does NOT need persistence (a static site, a calculator, a stateless tool), IGNORE this',
    'entirely — do not nag the user about a database they do not need.',
  ].join('\n');
}
