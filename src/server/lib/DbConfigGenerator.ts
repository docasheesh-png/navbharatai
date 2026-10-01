// db-provision (partial) — Bring-Your-Own-Database connection-config generator.
//
// The one-click AUTO-CREATE of a database needs an external provisioning broker (provider management API +
// user OAuth) and stays infra-gated. But the OTHER half — wiring the app to CONNECT to the user's DB (the
// "env written back" + "app is ready once you paste credentials" experience) — is fully deterministic and
// real, exactly like the auth scaffold. For a chosen provider this emits the correct client-init module,
// the `.env.example` keys, the npm dependency, and honest "paste your credentials" instructions. NavBharatAI
// never stores the user's secrets — they live only in the user's own env. PURE builders, unit-tested.

export type DbProvider = 'supabase' | 'neon' | 'firebase' | 'postgres';

export interface DbConfig {
  provider: DbProvider;
  /** path → file content to write into the app. */
  files: Record<string, string>;
  /** The env var names the user must fill in (documented in .env.example). */
  envKeys: string[];
  /** The npm dependency the client needs. */
  dependency: { name: string; version: string };
  /** Honest, human-readable next-steps for the user. */
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

function envBlock(pairs: Array<[string, string]>): string {
  return pairs.map(([k, note]) => `# ${note}\n${k}=`).join('\n') + '\n';
}

// 🔴 NO TEMPLATE THROWS WHILE IT IS BEING IMPORTED (autopsy 2b1f845e, 2026-10-01). Every client below
// used to `throw` at module load when its keys were missing. In a browser that is a white screen for the
// WHOLE app — every screen imports the client, so a user who had not pasted keys yet could not open the
// app at all, not even the screens that never touch the database; on a server it is a process that never
// starts, so the preview never comes up. In that build the model had to remove our template's throw to
// get the app to boot, and what it left behind (`{} as SupabaseClient`) was then flagged by the review as
// a type lie. The class: a missing setting must fail the FEATURE that needs it, at the moment it is used,
// with words that say what to set — never the app, at boot.
//
// So each module exports a flag (`…Configured`) the screens can show a "needs setup" state from, and a
// client that is the REAL client when configured and, when not, an object whose every use throws that
// same clear message. The type stays honest: any use of an unconfigured client fails loudly, never quietly.

/** The one shape every template uses for "not configured yet". Exported for its test. */
export const NOT_CONFIGURED_PROXY = `function notConfigured<T extends object>(message: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      // Promise checks and dev tools probe objects for these; answering them keeps a probe from
      // turning into the error below.
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      throw new Error(message);
    },
  });
}`;

const SUPABASE_CLIENT = `import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Bring-Your-Own Supabase: paste your project URL + anon key into .env (never committed).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const NOT_CONFIGURED = 'Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env';

${NOT_CONFIGURED_PROXY}

/** True once both keys are set. Screens that need the database can show a "needs setup" state from it. */
export const supabaseConfigured = Boolean(url && anonKey);

/** The real client when configured; otherwise every use throws a clear "not configured" error. */
export const supabase: SupabaseClient = supabaseConfigured
  ? createClient(url as string, anonKey as string)
  : notConfigured<SupabaseClient>(NOT_CONFIGURED);
`;

const NEON_CLIENT = `import { neon } from '@neondatabase/serverless';

// Bring-Your-Own Neon: paste your connection string into .env (never committed).
const connectionString = process.env.DATABASE_URL;
const NOT_CONFIGURED = 'DATABASE_URL is not set — paste your Neon connection string into .env';

/** True once DATABASE_URL is set. */
export const databaseConfigured = Boolean(connectionString);

type Sql = ReturnType<typeof neon>;

/** The real query function when configured; otherwise calling it throws a clear "not configured" error. */
export const sql: Sql = connectionString
  ? neon(connectionString)
  : (((..._args: unknown[]) => { throw new Error(NOT_CONFIGURED); }) as unknown as Sql);
`;

const POSTGRES_CLIENT = `import { Pool } from 'pg';

// Bring-Your-Own Postgres: paste your connection string into .env (never committed).
const NOT_CONFIGURED = 'DATABASE_URL is not set — paste your Postgres connection string into .env';

${NOT_CONFIGURED_PROXY}

/** True once DATABASE_URL is set. */
export const databaseConfigured = Boolean(process.env.DATABASE_URL);

// Without a connection string \`pg\` would quietly try a database on this machine — so an unconfigured
// pool is one whose every use says what to set instead.
export const pool: Pool = databaseConfigured
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : notConfigured<Pool>(NOT_CONFIGURED);
`;

const FIREBASE_CLIENT = `import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

// Bring-Your-Own Firebase: paste your web app config into .env (never committed).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

const NOT_CONFIGURED = 'Firebase is not configured — set the VITE_FIREBASE_* vars in .env';

${NOT_CONFIGURED_PROXY}

/** True once the project id and api key are set. */
export const firebaseConfigured = Boolean(firebaseConfig.projectId && firebaseConfig.apiKey);

export const app: FirebaseApp = firebaseConfigured ? initializeApp(firebaseConfig) : notConfigured<FirebaseApp>(NOT_CONFIGURED);
export const db: Firestore = firebaseConfigured ? getFirestore(app) : notConfigured<Firestore>(NOT_CONFIGURED);
`;

/** Generate the BYO connection config for a provider. Deterministic; unknown provider → throws (caller guards). */
export function generateDbConfig(provider: DbProvider): DbConfig {
  switch (provider) {
    case 'supabase':
      return {
        provider, dependency: { name: '@supabase/supabase-js', version: '^2' },
        envKeys: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
        files: {
          'src/lib/supabase.ts': SUPABASE_CLIENT,
          [ENV_EXAMPLE]: envBlock([['VITE_SUPABASE_URL', 'Your Supabase project URL (Project Settings → API)'], ['VITE_SUPABASE_ANON_KEY', 'Your Supabase anon/public key (Project Settings → API)']]),
        },
        instructions: 'Create a free Supabase project, copy its URL + anon key from Project Settings → API, and paste them into .env. Then import { supabase } from "@/lib/supabase". Your keys stay in YOUR env — NavBharatAI never stores them.',
      };
    case 'neon':
      return {
        provider, dependency: { name: '@neondatabase/serverless', version: '^0.9' },
        envKeys: ['DATABASE_URL'],
        files: {
          'src/lib/db.ts': NEON_CLIENT,
          [ENV_EXAMPLE]: envBlock([['DATABASE_URL', 'Your Neon connection string (Dashboard → Connection Details)']]),
        },
        instructions: 'Create a free Neon project, copy its connection string, and paste it into DATABASE_URL in .env. Then import { sql } from "./lib/db". Your connection string stays in YOUR env.',
      };
    case 'postgres':
      return {
        provider, dependency: { name: 'pg', version: '^8' },
        envKeys: ['DATABASE_URL'],
        files: {
          'src/lib/db.ts': POSTGRES_CLIENT,
          [ENV_EXAMPLE]: envBlock([['DATABASE_URL', 'Your Postgres connection string (postgres://user:pass@host:5432/db)']]),
        },
        instructions: 'Point DATABASE_URL at any Postgres instance (local or hosted) in .env. Then import { pool } from "./lib/db".',
      };
    case 'firebase':
      return {
        provider, dependency: { name: 'firebase', version: '^10' },
        envKeys: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_APP_ID'],
        files: {
          'src/lib/firebase.ts': FIREBASE_CLIENT,
          [ENV_EXAMPLE]: envBlock([
            ['VITE_FIREBASE_API_KEY', 'Firebase web app apiKey (Project Settings → General → Your apps)'],
            ['VITE_FIREBASE_AUTH_DOMAIN', 'Firebase authDomain'],
            ['VITE_FIREBASE_PROJECT_ID', 'Firebase projectId'],
            ['VITE_FIREBASE_STORAGE_BUCKET', 'Firebase storageBucket'],
            ['VITE_FIREBASE_APP_ID', 'Firebase appId'],
          ]),
        },
        instructions: 'Create a Firebase project, register a Web app, copy its config values into the VITE_FIREBASE_* vars in .env. Then import { db } from "@/lib/firebase". Your config stays in YOUR env.',
      };
    default:
      throw new Error(`Unknown database provider: ${provider}`);
  }
}

/** Valid provider guard for the tool layer. */
export function isDbProvider(v: unknown): v is DbProvider {
  return v === 'supabase' || v === 'neon' || v === 'firebase' || v === 'postgres';
}
