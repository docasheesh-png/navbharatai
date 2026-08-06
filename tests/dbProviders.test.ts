import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DB_PROVIDERS, dbProvider, envKeysFor, envVarsFor, providerForEnvVar, familyGuidance,
  ALL_DB_ENV_VARS, type DbProviderId,
} from '../src/lib/dbProviders';
import { userDatabaseContext, noDatabaseConnectedContext, DB_PROVIDER_MARKER } from '../src/server/AgentV3/userDatabaseContext';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * "USER JO CHAHE DB USE KARE" (admin 2026-08-06).
 *
 * The catalogue used to exist TWICE — the settings screen owned the fields and a `buildEnvKeys` switch,
 * and the builder's prompt context owned a second map of the same providers with a second copy of their
 * env-var names. Two lists of the same thing drift, and the drift was silent in the worst direction: the
 * screen could save a credential under a name the builder was never told to read, so a user connected
 * their database and the app it built ignored it. Adding a provider also meant remembering both places,
 * which is why the list had stopped growing at six.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('The registry is internally consistent', () => {
  it('every id is unique and every provider is fully described', () => {
    const ids = DB_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of DB_PROVIDERS) {
      expect(p.label, p.id).toBeTruthy();
      expect(p.blurb, p.id).toBeTruthy();   // a longer list is only useful if each entry explains itself
      expect(p.sdk, p.id).toBeTruthy();     // the builder must never have to invent a client
      expect(p.fields.length, p.id).toBeGreaterThan(0);
    }
  });

  it('every credential field names the .env variable it is stored under', () => {
    for (const p of DB_PROVIDERS) {
      for (const f of p.fields) {
        expect(f.label, `${p.id}.${f.key}`).toBeTruthy();
        expect(f.where, `${p.id}.${f.key}`).toBeTruthy(); // "where to find this" is not optional
        // `platformName` is the one deliberate metadata field — a label, not a credential.
        if (f.key !== 'platformName') expect(f.env, `${p.id}.${f.key}`).toBeTruthy();
        if (f.env) expect(f.env, `${p.id}.${f.key}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
      const envs = p.fields.map((f) => f.env).filter(Boolean);
      expect(new Set(envs).size, p.id).toBe(envs.length); // no provider writes one name twice
    }
  });

  it('the ids users already have saved still resolve — a marker is persisted data', () => {
    // Renaming one of these would orphan every user who connected that database before today.
    for (const legacy of ['supabase', 'firebase', 'mongodb', 'neon', 'appwrite', 'other']) {
      expect(dbProvider(legacy), legacy).toBeTruthy();
    }
  });

  it('covers the databases an Indian audience actually has, not just the fashionable ones', () => {
    // MySQL is the one that matters most and was missing entirely: nearly every Indian shared host
    // (Hostinger, cPanel, Bluehost) gives MySQL and nothing else, and those users had to pick "Other",
    // which told the builder nothing about the dialect.
    const ids = DB_PROVIDERS.map((p) => p.id);
    for (const id of ['postgres', 'mysql', 'planetscale', 'turso', 'upstash'] as DbProviderId[]) {
      expect(ids, id).toContain(id);
    }
    expect(dbProvider('mysql')!.family).toBe('mysql');
    expect(dbProvider('postgres')!.family).toBe('postgres');
    expect(dbProvider('mysql')!.blurb.toLowerCase()).toContain('hostinger');
  });
});

describe('envKeysFor — the form becomes .env, derived not hand-mapped', () => {
  it('maps each filled field onto its own env name', () => {
    expect(envKeysFor('supabase', { url: 'https://x.supabase.co', anonKey: 'anon' }))
      .toEqual({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' });
    expect(envKeysFor('mysql', { connectionString: 'mysql://u:p@h:3306/d' })).toEqual({ DATABASE_URL: 'mysql://u:p@h:3306/d' });
    expect(envKeysFor('turso', { databaseUrl: 'libsql://x.turso.io', authToken: 't' }))
      .toEqual({ TURSO_DATABASE_URL: 'libsql://x.turso.io', TURSO_AUTH_TOKEN: 't' });
  });

  it('drops blank values — an empty line would wipe a saved credential on the next merge', () => {
    expect(envKeysFor('supabase', { url: '  ', anonKey: 'anon' })).toEqual({ VITE_SUPABASE_ANON_KEY: 'anon' });
    expect(envKeysFor('neon', {})).toEqual({});
  });

  it('ignores metadata fields and unknown providers', () => {
    expect(envKeysFor('other', { platformName: 'CockroachDB', connectionString: 'postgresql://x' }))
      .toEqual({ DATABASE_URL: 'postgresql://x' });
    expect(envKeysFor('not-a-provider', { connectionString: 'x' })).toEqual({});
  });

  it('a Supabase user can now also give the SERVER connection string, not just the browser keys', () => {
    // A browser anon key cannot serve an Express/Prisma/Drizzle app — that gap is exactly why a
    // one-tap database used to be unusable by any backend.
    expect(envVarsFor('supabase')).toContain('DATABASE_URL');
  });
});

describe('providerForEnvVar — never guesses a brand it cannot know', () => {
  it('resolves a name only one provider writes', () => {
    expect(providerForEnvVar('MONGODB_URI')).toBe('mongodb');
    expect(providerForEnvVar('TURSO_AUTH_TOKEN')).toBe('turso');
    expect(providerForEnvVar('VITE_FIREBASE_API_KEY')).toBe('firebase');
  });

  it('refuses a shared name rather than naming one brand as if it were a fact', () => {
    // DATABASE_URL belongs to Postgres, MySQL, Neon, PlanetScale and Supabase alike.
    expect(providerForEnvVar('DATABASE_URL')).toBeNull();
    expect(providerForEnvVar('NOT_A_DB_VAR')).toBeNull();
  });

  it('ALL_DB_ENV_VARS is the union, with no duplicates', () => {
    expect(new Set(ALL_DB_ENV_VARS).size).toBe(ALL_DB_ENV_VARS.length);
    expect(ALL_DB_ENV_VARS).toContain('DATABASE_URL');
    expect(ALL_DB_ENV_VARS).toContain('UPSTASH_REDIS_REST_URL');
  });
});

describe('The builder is told the DIALECT, not just the brand', () => {
  it('a MySQL connection warns off Postgres-only SQL', () => {
    const ctx = userDatabaseContext({ [DB_PROVIDER_MARKER]: 'mysql', DATABASE_URL: 'mysql://u:p@h:3306/d' });
    expect(ctx).toContain('MySQL');
    // This is the half that used to be missing and the half that breaks an app silently: Postgres-only
    // SQL against a cPanel MySQL fails at the first query, long after the build reported success.
    expect(ctx).toContain('jsonb');
    expect(ctx).toContain('mysql2');
  });

  it('a document database is not told to generate SQL tables', () => {
    const ctx = userDatabaseContext({ [DB_PROVIDER_MARKER]: 'mongodb', MONGODB_URI: 'mongodb+srv://x' });
    expect(ctx).toContain('collections and documents');
    expect(ctx).toContain('do NOT generate SQL tables');
  });

  it('a key-value store is honest that it is not a relational database', () => {
    const ctx = userDatabaseContext({ [DB_PROVIDER_MARKER]: 'upstash', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' });
    expect(ctx).toContain('NOT a relational store');
  });

  it('the instruction names the EXACT env vars that provider stores', () => {
    const ctx = userDatabaseContext({ [DB_PROVIDER_MARKER]: 'turso', TURSO_DATABASE_URL: 'libsql://x', TURSO_AUTH_TOKEN: 't' });
    expect(ctx).toContain('TURSO_DATABASE_URL');
    expect(ctx).toContain('TURSO_AUTH_TOKEN');
  });

  it('every family has real guidance — a new family can never ship as an empty string', () => {
    for (const p of DB_PROVIDERS) {
      expect(familyGuidance(p.family).length, p.id).toBeGreaterThan(40);
    }
  });

  it('an unconnected user is told the full list, including the one-tap option', () => {
    const ctx = noDatabaseConnectedContext();
    expect(ctx).toContain('MySQL');
    expect(ctx).toContain('Hostinger');
    expect(ctx).toContain('one tap');
  });
});

describe('One definition — both consumers derive from it', () => {
  it('the settings screen no longer owns a catalogue or a hand-written env mapping', () => {
    const ui = read('src/components/settings/DatabaseSettings.tsx');
    expect(ui).toContain("from '../../lib/dbProviders'");
    expect(ui).toContain('envKeysFor(');
    expect(ui).not.toContain('function buildEnvKeys');
    expect(ui).not.toContain("case 'planetscale':"); // no switch to forget a provider in
  });

  it('the builder context no longer owns a second copy of the env-var names', () => {
    const ctx = read('src/server/AgentV3/userDatabaseContext.ts');
    expect(ctx).toContain("from '../../lib/dbProviders'");
    expect(ctx).not.toContain('const DB_PROVIDERS: Record<string, DbProviderSpec>');
  });

  it('KB — the database entry lists what is really supported', () => {
    const e = APP_KNOWLEDGE_BASE.find((f) => f.id === 'settings_database');
    expect(e).toBeTruthy();
    expect(e!.description).toContain('MySQL');
    expect(e!.description).toContain('Turso');
    expect(e!.description.toUpperCase()).toContain('DIALECT');
  });
});
