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

const SUPABASE_CLIENT = `import { createClient } from '@supabase/supabase-js';

// Bring-Your-Own Supabase: paste your project URL + anon key into .env (never committed).
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(url, anonKey);
`;

const NEON_CLIENT = `import { neon } from '@neondatabase/serverless';

// Bring-Your-Own Neon: paste your connection string into .env (never committed).
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set — paste your Neon connection string into .env');

export const sql = neon(connectionString);
`;

const POSTGRES_CLIENT = `import { Pool } from 'pg';

// Bring-Your-Own Postgres: paste your connection string into .env (never committed).
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set — paste your Postgres connection string into .env');

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
`;

const FIREBASE_CLIENT = `import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Bring-Your-Own Firebase: paste your web app config into .env (never committed).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

if (!firebaseConfig.projectId) throw new Error('Firebase is not configured — set the VITE_FIREBASE_* vars in .env');

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
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
