// User-connected file-storage context (admin 2026-07-29).
//
// When a user connects a STANDALONE file-storage provider in Settings → App Settings → Storage, the
// chosen provider is saved as the `STORAGE_PROVIDER` marker and the credentials as encrypted env
// secrets (S3_BUCKET / AWS_ACCESS_KEY_ID / CLOUDINARY_* …). At build time those secrets are already
// injected into the app's `.env` (loadUserVaultSecrets → setUserSecrets), and `StorageGenerator`
// already knows how to wire real direct-to-storage uploads for these exact env-var names. But the
// BUILDER was never TOLD a storage provider is connected, so it could invent its own upload path,
// pick a different provider, or ask the user to set one up — ignoring the storage they deliberately
// wired. This turns the connection into an explicit, proactive instruction so the builder uses the
// connected storage, with the exact env-var names, and never creates a new one.
//
// Note on scope: Firebase/Supabase already provide storage as part of their DATABASE connection
// (Settings → Database) — so this standalone context is for the S3-compatible + Cloudinary case. If
// a DB provider that includes storage is connected, `userDatabaseContext` already covers it.
//
// Pure + unit-tested. The provider named here is the USER'S OWN storage choice (shown in their own
// settings), NOT one of NavBharatAI's internal AI vendors — so naming it is correct, and the
// white-label law (which hides our AI providers) does not apply. Builder system prompt only; never
// shown to the end user.

/** The marker secret written by Settings → Storage that records the chosen provider. */
export const STORAGE_PROVIDER_MARKER = 'STORAGE_PROVIDER';

interface StorageProviderSpec {
  label: string;
  /** The real SDK/package the builder must use. */
  sdk: string;
  /** The env-var names this provider's credentials live under (mirrors StorageGenerator + the client). */
  envVars: string[];
  /** Extra guidance unique to this provider (upload flow). */
  note: string;
}

const STORAGE_PROVIDERS: Record<string, StorageProviderSpec> = {
  s3: {
    label: 'S3-compatible storage',
    sdk: '@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner',
    envVars: ['S3_BUCKET', 'S3_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    note: 'Upload via a server-issued presigned PUT URL so the browser uploads DIRECTLY to storage (the secret never leaves the server). Works with AWS S3, Cloudflare R2, Supabase Storage or MinIO (set the optional S3_ENDPOINT).',
  },
  cloudinary: {
    label: 'Cloudinary',
    sdk: 'cloudinary',
    envVars: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    note: 'Upload via a server-issued signature so the browser uploads DIRECTLY to Cloudinary (the api_secret never leaves the server).',
  },
};

/** All env-var names any known provider can use — lets us detect a connection even without the marker. */
const ALL_STORAGE_ENV_VARS = Array.from(new Set(Object.values(STORAGE_PROVIDERS).flatMap(p => p.envVars)));

/** Which known provider owns a given env-var name (first match wins). */
function providerForEnvVar(name: string): string | null {
  for (const [id, spec] of Object.entries(STORAGE_PROVIDERS)) {
    if (spec.envVars.includes(name)) return id;
  }
  return null;
}

/**
 * Build the "a storage provider is already connected — use it, don't create a new one" instruction
 * block for the builder's system prompt, from the user's loaded vault secrets. Returns '' when the
 * user has NOT connected standalone storage (so plain builds and prompt-regression tests are
 * unaffected). Pure.
 *
 * Detection is robust: it trusts the `STORAGE_PROVIDER` marker when present, and otherwise infers the
 * provider from which storage env-vars are actually populated.
 */
export function userStorageContext(vaultSecrets: Record<string, string> | null | undefined): string {
  const secrets = vaultSecrets && typeof vaultSecrets === 'object' ? vaultSecrets : {};
  const nonEmpty = (name: string): boolean => typeof secrets[name] === 'string' && secrets[name].trim() !== '';

  // 1) Resolve the provider id: the marker wins; else infer from populated env-vars.
  let providerId = (secrets[STORAGE_PROVIDER_MARKER] || '').trim().toLowerCase();
  if (!providerId || !STORAGE_PROVIDERS[providerId]) {
    const inferred = ALL_STORAGE_ENV_VARS.filter(nonEmpty).map(providerForEnvVar).find(Boolean);
    providerId = inferred || '';
  }
  if (!providerId || !STORAGE_PROVIDERS[providerId]) return '';

  const spec = STORAGE_PROVIDERS[providerId];
  const presentVars = spec.envVars.filter(nonEmpty);
  const hasMarker = !!(secrets[STORAGE_PROVIDER_MARKER] || '').trim();
  // If neither the marker nor any credential is present, there is nothing connected.
  if (presentVars.length === 0 && !hasMarker) return '';
  const varsToName = presentVars.length > 0 ? presentVars : spec.envVars;

  return [
    '## CONNECTED FILE STORAGE — USE IT, DO NOT CREATE A NEW ONE',
    `The user has ALREADY connected their own ${spec.label} for file/image uploads (Settings → App`,
    `Settings → Storage). Its credentials are injected into this app's \`.env\` under these exact`,
    `variables: ${varsToName.join(', ')}.`,
    'You MUST:',
    `- Use the real ${spec.label} integration (${spec.sdk}) and read these EXACT \`.env\` variables — never hardcode a value.`,
    `- ${spec.note}`,
    '- Wire any file/image/media upload the app needs to THIS connected storage.',
    'You MUST NOT:',
    '- Provision, scaffold, or spin up a new/different storage bucket or a local-disk upload folder.',
    '- Substitute a different provider, or ask the user to create or configure storage — they already did.',
    '- Invent new env-var names for storage; reuse the ones above.',
    presentVars.length === 0
      ? `NOTE: the ${spec.label} credentials are not all set yet — wire the real integration and surface an honest "set ${spec.envVars[0]}" note rather than swapping in a different store.`
      : '',
  ].filter(Boolean).join('\n');
}
