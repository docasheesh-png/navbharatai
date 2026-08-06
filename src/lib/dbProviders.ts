// Every database NavBharatAI can connect an app to — ONE definition, shared by the client and the server.
//
// WHY THIS FILE EXISTS (admin 2026-08-06: "user jo chahe db use kare, navbharatai sabhi db ke sath
// compatible … hona chahiye"). The catalogue used to exist TWICE: the settings screen owned the fields
// and a `buildEnvKeys` switch, and the builder's prompt context owned a second map of the same providers
// with a second copy of their env-var names. Two lists of the same thing drift, and the drift is silent
// and expensive in exactly one direction — the screen saves a credential under a name the builder was
// never told to read, so the user connects a database and the app it builds ignores it. Adding a
// provider also meant remembering both places, which is why the list had stopped growing.
//
// Here, a field carries its OWN env-var name. The settings form, the vault write and the builder
// instruction are all DERIVED from that single fact, so a new provider is added once and cannot be
// half-added. PURE and dependency-free so both sides can import it.
//
// WHAT IS DELIBERATELY NOT HERE. A provider whose canonical wiring we cannot actually generate is not
// listed, however popular it is — Cloudflare D1's real path is a `wrangler.toml` binding rather than an
// environment variable, so listing it would offer a connection that quietly does nothing. "Other"
// carries those honestly, with the platform name passed through to the builder.

/** Every database the settings screen offers. Values are PERSISTED in the user's vault marker — never rename one. */
export type DbProviderId =
  | 'supabase' | 'firebase' | 'mongodb' | 'neon' | 'postgres' | 'mysql'
  | 'planetscale' | 'turso' | 'upstash' | 'appwrite' | 'other';

/**
 * What KIND of database this is — which drives the SDK and the schema dialect the builder must use.
 * Two providers of the same family are wired identically apart from the connection string, so the
 * builder's instruction is written once per family rather than once per brand.
 */
export type DbFamily = 'postgres' | 'mysql' | 'sqlite' | 'document' | 'keyvalue' | 'baas' | 'unknown';

export interface DbField {
  /** Form-local id (what the settings screen keys its inputs by). */
  key: string;
  label: string;
  placeholder: string;
  /** Exactly where in THAT provider's own dashboard this specific value lives. */
  where: string;
  /**
   * The `.env` name this value is written under — the same name the builder is told to read.
   * A field with no env name is metadata (e.g. the "Other" platform label), never a credential.
   */
  env?: string;
  /** False for a field the app can run without (e.g. an optional pooled URL). */
  required?: boolean;
}

export interface DbProviderSpec {
  id: DbProviderId;
  label: string;
  /** A one-line "what this is", shown under the provider picker so the choice is informed. */
  blurb: string;
  family: DbFamily;
  /** Where the user finds their credentials. Empty for 'other', which has no single console. */
  keyLink: string;
  /** The real package the builder must use — named so it can never invent its own client. */
  sdk: string;
  fields: DbField[];
}

export const DB_PROVIDERS: DbProviderSpec[] = [
  {
    id: 'supabase', label: 'Supabase', family: 'postgres',
    blurb: 'Postgres with auth, storage and realtime built in. NavBharatAI can create one for you in one tap.',
    keyLink: 'https://supabase.com/dashboard/project/_/settings/api',
    sdk: '@supabase/supabase-js (browser) and the Postgres client / Prisma / Drizzle via DATABASE_URL (server)',
    fields: [
      { key: 'url', label: 'Project URL', placeholder: 'https://xxxx.supabase.co', where: 'Project Settings → API → Project URL', env: 'VITE_SUPABASE_URL' },
      { key: 'anonKey', label: 'Anon Key', placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…', where: 'Project Settings → API → Project API keys → anon / public', env: 'VITE_SUPABASE_ANON_KEY' },
      // A browser key alone cannot serve an Express/Prisma/Drizzle app — that gap is exactly why a
      // one-tap database used to be unusable by any backend. Optional, because a frontend-only app
      // genuinely does not need it.
      { key: 'connectionString', label: 'Postgres Connection String (optional — needed for a backend)', placeholder: 'postgresql://postgres.xxxx:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres', where: 'Project Settings → Database → Connection string → Session pooler (replace [YOUR-PASSWORD])', env: 'DATABASE_URL', required: false },
    ],
  },
  {
    id: 'firebase', label: 'Firebase', family: 'baas',
    blurb: 'Google\'s Firestore database with Auth and Storage. Good for realtime apps and quick logins.',
    keyLink: 'https://console.firebase.google.com/',
    sdk: 'firebase (modular web SDK)',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'AIzaSy…', where: 'Project Settings → General → Your apps → SDK setup and configuration → apiKey', env: 'VITE_FIREBASE_API_KEY' },
      { key: 'authDomain', label: 'Auth Domain', placeholder: 'your-project.firebaseapp.com', where: 'Project Settings → General → Your apps → authDomain', env: 'VITE_FIREBASE_AUTH_DOMAIN' },
      { key: 'projectId', label: 'Project ID', placeholder: 'your-project-id', where: 'Project Settings → General → Project ID', env: 'VITE_FIREBASE_PROJECT_ID' },
      { key: 'storageBucket', label: 'Storage Bucket', placeholder: 'your-project.appspot.com', where: 'Project Settings → General → Your apps → storageBucket', env: 'VITE_FIREBASE_STORAGE_BUCKET' },
      { key: 'messagingSenderId', label: 'Messaging Sender ID', placeholder: '123456789', where: 'Project Settings → Cloud Messaging → Sender ID', env: 'VITE_FIREBASE_MESSAGING_SENDER_ID' },
      { key: 'appId', label: 'App ID', placeholder: '1:123:web:abc', where: 'Project Settings → General → Your apps → appId', env: 'VITE_FIREBASE_APP_ID' },
    ],
  },
  {
    id: 'mongodb', label: 'MongoDB Atlas', family: 'document',
    blurb: 'Document database. Flexible records with no fixed columns — good when the shape of your data changes often.',
    keyLink: 'https://cloud.mongodb.com/',
    sdk: 'mongodb (official driver) or mongoose',
    fields: [
      { key: 'uri', label: 'Connection URI', placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net/mydb', where: 'Atlas → Database → Connect → Drivers → copy the SRV string (replace <password> with your DB user password)', env: 'MONGODB_URI' },
    ],
  },
  {
    id: 'neon', label: 'Neon (Serverless Postgres)', family: 'postgres',
    blurb: 'Postgres that scales to zero — a generous free tier and instant branching.',
    keyLink: 'https://console.neon.tech/',
    sdk: '@neondatabase/serverless, pg, Prisma or Drizzle',
    fields: [
      { key: 'connectionString', label: 'Connection String', placeholder: 'postgresql://user:pass@ep-xxx.neon.tech/neondb', where: 'Neon Console → your project → Dashboard → Connection Details → Connection string (Pooled)', env: 'DATABASE_URL' },
    ],
  },
  {
    // The generic Postgres option was missing entirely — a user with a Render, Railway, Aiven, Supabase
    // or self-hosted Postgres had to pick "Other", which tells the builder nothing about the dialect.
    id: 'postgres', label: 'PostgreSQL (any host)', family: 'postgres',
    blurb: 'Any PostgreSQL you already have — Render, Railway, Aiven, DigitalOcean, or your own server.',
    keyLink: '',
    sdk: 'pg, Prisma (provider = "postgresql") or Drizzle (drizzle-orm/node-postgres)',
    fields: [
      { key: 'connectionString', label: 'Connection String', placeholder: 'postgresql://user:password@host:5432/dbname', where: "Your host's dashboard → Database → Connection string / External Database URL. Add ?sslmode=require if your host needs SSL.", env: 'DATABASE_URL' },
    ],
  },
  {
    // MySQL matters more here than anywhere else: nearly every Indian shared host (Hostinger, cPanel,
    // Bluehost) gives MySQL and nothing else, and those users had no option that named their dialect.
    id: 'mysql', label: 'MySQL / MariaDB (any host)', family: 'mysql',
    blurb: 'The database almost every shared host gives you — Hostinger, cPanel, Bluehost, Aiven.',
    keyLink: '',
    sdk: 'mysql2, Prisma (provider = "mysql") or Drizzle (drizzle-orm/mysql2)',
    fields: [
      { key: 'connectionString', label: 'Connection String', placeholder: 'mysql://user:password@host:3306/dbname', where: 'Your hosting panel → MySQL Databases → your database. Build it as mysql://USER:PASSWORD@HOST:3306/DBNAME from the values shown there.', env: 'DATABASE_URL' },
    ],
  },
  {
    id: 'planetscale', label: 'PlanetScale', family: 'mysql',
    blurb: 'Serverless MySQL with safe schema changes (branches you merge, like git).',
    keyLink: 'https://app.planetscale.com/',
    sdk: '@planetscale/database or mysql2; Prisma (provider = "mysql", relationMode = "prisma")',
    fields: [
      { key: 'connectionString', label: 'Connection String', placeholder: 'mysql://user:pscale_pw_xxx@aws.connect.psdb.cloud/dbname?ssl={"rejectUnauthorized":true}', where: 'PlanetScale → your database → Connect → select your framework → copy DATABASE_URL', env: 'DATABASE_URL' },
    ],
  },
  {
    id: 'turso', label: 'Turso (libSQL)', family: 'sqlite',
    blurb: 'SQLite hosted at the edge — very fast reads, very cheap. Good for read-heavy apps.',
    keyLink: 'https://turso.tech/app',
    sdk: '@libsql/client, or Drizzle (drizzle-orm/libsql)',
    fields: [
      { key: 'databaseUrl', label: 'Database URL', placeholder: 'libsql://your-db-yourname.turso.io', where: 'Turso dashboard → your database → Connect → URL', env: 'TURSO_DATABASE_URL' },
      { key: 'authToken', label: 'Auth Token', placeholder: 'eyJhbGciOi…', where: 'Turso dashboard → your database → Connect → Create Token', env: 'TURSO_AUTH_TOKEN' },
    ],
  },
  {
    id: 'upstash', label: 'Upstash Redis', family: 'keyvalue',
    blurb: 'Redis over HTTP — for sessions, counters, rate limits and caching. Not a replacement for a main database.',
    keyLink: 'https://console.upstash.com/',
    sdk: '@upstash/redis (HTTP client — works on serverless and edge)',
    fields: [
      { key: 'restUrl', label: 'REST URL', placeholder: 'https://xxx.upstash.io', where: 'Upstash Console → your database → REST API → UPSTASH_REDIS_REST_URL', env: 'UPSTASH_REDIS_REST_URL' },
      { key: 'restToken', label: 'REST Token', placeholder: 'AX…', where: 'Upstash Console → your database → REST API → UPSTASH_REDIS_REST_TOKEN', env: 'UPSTASH_REDIS_REST_TOKEN' },
    ],
  },
  {
    id: 'appwrite', label: 'Appwrite', family: 'baas',
    blurb: 'Open-source backend with database, auth and storage. Self-hostable.',
    keyLink: 'https://cloud.appwrite.io/',
    sdk: 'appwrite (web SDK)',
    fields: [
      { key: 'endpoint', label: 'API Endpoint', placeholder: 'https://cloud.appwrite.io/v1', where: 'Appwrite Console → your project → Settings → API Endpoint (Cloud users: https://cloud.appwrite.io/v1)', env: 'VITE_APPWRITE_ENDPOINT' },
      { key: 'projectId', label: 'Project ID', placeholder: 'your-project-id', where: 'Appwrite Console → your project → Settings → Project ID', env: 'VITE_APPWRITE_PROJECT_ID' },
    ],
  },
  {
    id: 'other', label: 'Other', family: 'unknown',
    blurb: 'Anything else — CockroachDB, Xata, Cloudflare D1, SQL Server, or a database only you host.',
    keyLink: '',
    sdk: 'the appropriate client for its connection string',
    fields: [
      { key: 'platformName', label: 'Platform Name', placeholder: 'e.g. CockroachDB, Xata, SQL Server…', where: 'The name of your database provider — used only as a label so v5.0 knows which SDK to wire' },
      { key: 'connectionString', label: 'Connection String / API Key', placeholder: 'postgresql://… or your API key', where: "Your provider's dashboard → Connect / Connection string (or API key)", env: 'DATABASE_URL' },
    ],
  },
];

/** Look one up by id. Returns null for an unknown/legacy value rather than throwing. */
export function dbProvider(id: string | null | undefined): DbProviderSpec | null {
  const key = String(id ?? '').trim().toLowerCase();
  return DB_PROVIDERS.find((p) => p.id === key) ?? null;
}

/**
 * Turn a filled-in form into the `.env` pairs to store — derived from each field's own `env` name, so
 * the screen and the builder can never disagree about what a value is called. Blank values are dropped:
 * an empty line would overwrite a good value with nothing on the next merge.
 */
export function envKeysFor(id: string, credentials: Record<string, string>): Record<string, string> {
  const spec = dbProvider(id);
  if (!spec) return {};
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    if (!f.env) continue;
    const v = (credentials[f.key] ?? '').trim();
    if (v) out[f.env] = v;
  }
  return out;
}

/** Every env name any provider can write. Lets a connection be detected even without the marker. */
export const ALL_DB_ENV_VARS: string[] = Array.from(
  new Set(DB_PROVIDERS.flatMap((p) => p.fields.map((f) => f.env).filter((e): e is string => !!e))),
);

/**
 * Which provider owns an env name.
 *
 * `other` is skipped, and so is any name more than one provider writes — `DATABASE_URL` belongs to
 * Postgres, MySQL, Neon and PlanetScale alike, so claiming a specific brand from it would be a guess
 * presented as a fact. Such a name resolves through the explicit marker or not at all.
 */
export function providerForEnvVar(name: string): DbProviderId | null {
  const owners = DB_PROVIDERS.filter((p) => p.id !== 'other' && p.fields.some((f) => f.env === name));
  return owners.length === 1 ? owners[0].id : null;
}

/** The names a provider's credentials live under, in form order. */
export function envVarsFor(id: string): string[] {
  return (dbProvider(id)?.fields ?? []).map((f) => f.env).filter((e): e is string => !!e);
}

/**
 * How the builder must talk to this KIND of database — the schema dialect and the real client.
 *
 * Family-level rather than brand-level on purpose: PlanetScale and a cPanel MySQL are wired
 * identically apart from the connection string, and writing it per brand is how one brand ends up
 * with worse instructions than another for no reason.
 */
export function familyGuidance(family: DbFamily): string {
  switch (family) {
    case 'postgres':
      return 'PostgreSQL dialect: use `pg` / Prisma (`provider = "postgresql"`) / Drizzle (`drizzle-orm/node-postgres`). Write schema as SQL migrations or a Prisma schema — never SQLite or MySQL syntax.';
    case 'mysql':
      return 'MySQL dialect: use `mysql2` / Prisma (`provider = "mysql"`) / Drizzle (`drizzle-orm/mysql2`). Do NOT use Postgres-only types (`serial`, `jsonb`, `uuid` defaults, `RETURNING`) — they fail on MySQL.';
    case 'sqlite':
      return 'SQLite/libSQL dialect: use `@libsql/client` / Drizzle (`drizzle-orm/libsql`). Do NOT use Postgres-only types or `RETURNING *` on older engines.';
    case 'document':
      return 'Document database: use the official `mongodb` driver or `mongoose`. Model data as collections and documents — do NOT generate SQL tables, migrations or joins.';
    case 'keyvalue':
      return 'Key-value store: use `@upstash/redis` for sessions, counters, rate limits and caching. It is NOT a relational store — if the app also needs records with relationships, say so honestly rather than modelling them in Redis.';
    case 'baas':
      return "Backend-as-a-service: use the provider's own SDK for data, auth and storage. Do NOT add a second database or an ORM on top of it.";
    case 'unknown':
    default:
      return 'Infer the right client from the connection string / platform name the user gave, and use that real SDK — never a placeholder or an in-memory store.';
  }
}
