import { describe, it, expect } from 'vitest';
import { detectNeedsDatabase, envVarNames, buildDevEnvContent, externalSecretVars, externalServiceNote, conjurableSecrets, detectDatabaseProvider, persistentDatabaseAdvisory } from './ImportPreview';

describe('detectNeedsDatabase', () => {
  it('detects a SQL/ORM driver in package.json', () => {
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ dependencies: { 'drizzle-orm': '^0.3', pg: '^8' } }) })).toBe(true);
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ dependencies: { '@prisma/client': '^5' } }) })).toBe(true);
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ devDependencies: { mongoose: '^8' } }) })).toBe(true);
  });
  it('detects a DATABASE_URL reference in source even without a recognised driver', () => {
    expect(detectNeedsDatabase({ 'package.json': '{}', 'server/db.ts': 'const url = process.env.DATABASE_URL;' })).toBe(true);
  });
  it('is false for a plain frontend app', () => {
    expect(detectNeedsDatabase({ 'package.json': JSON.stringify({ dependencies: { react: '^18', vite: '^5' } }), 'src/App.tsx': 'export default () => null;' })).toBe(false);
    expect(detectNeedsDatabase({ 'package.json': 'not json' })).toBe(false);
  });
});

describe('envVarNames', () => {
  it('extracts documented var names from the .env template', () => {
    expect(envVarNames({ '.env.example': 'DATABASE_URL=\nexport CASHFREE_APP_ID=\n# comment\nPORT=5000' }))
      .toEqual(['DATABASE_URL', 'CASHFREE_APP_ID', 'PORT']);
  });
  it('is empty without a template', () => {
    expect(envVarNames({ 'src/x.ts': 'x' })).toEqual([]);
  });
});

describe('buildDevEnvContent', () => {
  it('gives every documented var a value (placeholder or provided) + NODE_ENV, provided wins', () => {
    const content = buildDevEnvContent(['DATABASE_URL', 'CASHFREE_APP_ID', 'GOOGLE_API_KEY'], { DATABASE_URL: 'postgresql://postgres@localhost:5432/myapp' });
    expect(content).toContain('NODE_ENV=development');
    expect(content).toContain('DATABASE_URL=postgresql://postgres@localhost:5432/myapp'); // provisioned value wins
    expect(content).toContain('CASHFREE_APP_ID='); // placeholder — present so the app doesn't crash on undefined
    expect(content).toContain('GOOGLE_API_KEY=');
    expect(content.endsWith('\n')).toBe(true);
  });
  it('works with no documented vars (still sets NODE_ENV + provided)', () => {
    expect(buildDevEnvContent([], { DATABASE_URL: 'x' })).toBe('NODE_ENV=development\nDATABASE_URL=x\n');
  });
});

describe('externalSecretVars + externalServiceNote (honest partial preview)', () => {
  it('flags external-service secrets, not the infra vars we provide', () => {
    const ext = externalSecretVars(['DATABASE_URL', 'NODE_ENV', 'PORT', 'JWT_SECRET', 'CASHFREE_SECRET_KEY', 'GOOGLE_API_KEY', 'FIREBASE_WEBHOOK']);
    expect(ext).toContain('CASHFREE_SECRET_KEY');
    expect(ext).toContain('GOOGLE_API_KEY');
    expect(ext).toContain('FIREBASE_WEBHOOK');
    expect(ext).not.toContain('DATABASE_URL');
    expect(ext).not.toContain('JWT_SECRET');
    expect(ext).not.toContain('PORT');
  });
  it('produces an honest note naming what stays inactive, or "" when none', () => {
    const note = externalServiceNote(['DATABASE_URL', 'CASHFREE_APP_ID', 'GOOGLE_API_KEY']);
    expect(note).toContain('CASHFREE_APP_ID');
    expect(note).toContain("can't be provisioned");
    expect(externalServiceNote(['DATABASE_URL', 'PORT'])).toBe('');
  });
});

// P3 (admin 2026-07-05, "koi aur rasta"): the app's OWN local secrets are CONJURED with real random
// values — an empty SESSION_SECRET is itself a boot-killer (express-session throws "secret option
// required" on '', the exact reason the Mitrify live preview died). Third-party keys stay empty.
describe('conjurableSecrets (real values for self-issued secrets, never third-party keys)', () => {
  it('generates values for SESSION_SECRET/JWT_SECRET-class vars (the Mitrify boot-killer)', () => {
    const out = conjurableSecrets(['SESSION_SECRET', 'JWT_SECRET', 'COOKIE_SECRET', 'SECRET_KEY_BASE']);
    expect(Object.keys(out).sort()).toEqual(['COOKIE_SECRET', 'JWT_SECRET', 'SECRET_KEY_BASE', 'SESSION_SECRET']);
    for (const v of Object.values(out)) {
      expect(v.length).toBeGreaterThanOrEqual(32); // crypto-strong, never ''
    }
  });
  it('NEVER conjures third-party-shaped keys (fake external creds cause confusing real failures)', () => {
    const out = conjurableSecrets(['CASHFREE_SECRET_KEY', 'GOOGLE_API_KEY', 'FIREBASE_API_KEY', 'STRIPE_SECRET_KEY', 'OPENAI_API_KEY', 'DATABASE_URL']);
    expect(out).toEqual({});
  });
  it('is injectable for determinism and each secret is independently generated', () => {
    let i = 0;
    const out = conjurableSecrets(['SESSION_SECRET', 'JWT_SECRET'], () => `fixed-${++i}`);
    expect(out).toEqual({ SESSION_SECRET: 'fixed-1', JWT_SECRET: 'fixed-2' });
  });
  it('conjured secrets flow through buildDevEnvContent as real values (not placeholders)', () => {
    const provided = { DATABASE_URL: 'postgres://local/dev', ...conjurableSecrets(['SESSION_SECRET'], () => 'RANDOM_HEX') };
    const env = buildDevEnvContent(['DATABASE_URL', 'SESSION_SECRET', 'CASHFREE_APP_ID'], provided);
    expect(env).toContain('SESSION_SECRET=RANDOM_HEX');
    expect(env).toContain('DATABASE_URL=postgres://local/dev');
    expect(env).toContain('CASHFREE_APP_ID=\n'); // external key stays an honest empty placeholder
  });
  it('externalSecretVars no longer lists the conjured secrets as "still needed" (honesty)', () => {
    const ext = externalSecretVars(['SESSION_SECRET', 'NEXTAUTH_SECRET', 'CASHFREE_SECRET_KEY']);
    expect(ext).toEqual(['CASHFREE_SECRET_KEY']);
  });
});

describe('detectDatabaseProvider — name the DB an imported app uses (incl. BaaS that detectNeedsDatabase misses)', () => {
  const pkg = (deps: Record<string, string>) => ({ 'package.json': JSON.stringify({ dependencies: deps }) });
  it('names Supabase / Firebase (BaaS — not SQL drivers)', () => {
    expect(detectDatabaseProvider(pkg({ '@supabase/supabase-js': '^2' }))).toBe('Supabase');
    expect(detectDatabaseProvider(pkg({ firebase: '^10' }))).toBe('Firebase');
    // the reason a broader detector is needed: detectNeedsDatabase misses BaaS
    expect(detectNeedsDatabase(pkg({ '@supabase/supabase-js': '^2' }))).toBe(false);
  });
  it('names SQL/ORM providers, most-specific first', () => {
    expect(detectDatabaseProvider(pkg({ '@prisma/client': '^5' }))).toBe('Prisma');
    expect(detectDatabaseProvider(pkg({ mongoose: '^8' }))).toBe('MongoDB');
    expect(detectDatabaseProvider(pkg({ '@neondatabase/serverless': '^0.9' }))).toBe('Neon');
    expect(detectDatabaseProvider(pkg({ pg: '^8' }))).toBe('PostgreSQL');
    expect(detectDatabaseProvider(pkg({ mysql2: '^3' }))).toBe('MySQL');
    expect(detectDatabaseProvider(pkg({ knex: '^3' }))).toBe('a SQL database');
  });
  it('falls back to env/source signals when there is no driver dep', () => {
    expect(detectDatabaseProvider({ '.env.example': 'SUPABASE_URL=\nSUPABASE_ANON_KEY=' })).toBe('Supabase');
    expect(detectDatabaseProvider({ 'src/db.ts': 'const url = process.env.DATABASE_URL;' })).toBe('a database');
  });
  it('returns null for an app with no database', () => {
    expect(detectDatabaseProvider(pkg({ react: '^18', vite: '^5' }))).toBeNull();
    expect(detectDatabaseProvider({})).toBeNull();
  });
});

describe('persistentDatabaseAdvisory — clear problem → solution, suppressed when already connected', () => {
  it('names the provider and points to Settings → Database when NOT connected', () => {
    const msg = persistentDatabaseAdvisory({ provider: 'Supabase', connected: false });
    expect(msg).toContain('Supabase');
    expect(msg).toContain('Settings → App Settings → Database');
    expect(msg).toMatch(/won't persist|temporary data/i);
  });
  it('is EMPTY when a database is already connected (no problem)', () => {
    expect(persistentDatabaseAdvisory({ provider: 'Supabase', connected: true })).toBe('');
  });
  it('is EMPTY when the app uses no database', () => {
    expect(persistentDatabaseAdvisory({ provider: null, connected: false })).toBe('');
  });
  it('does not bold the generic labels', () => {
    expect(persistentDatabaseAdvisory({ provider: 'a database', connected: false })).toContain('uses a database,');
    expect(persistentDatabaseAdvisory({ provider: 'Neon', connected: false })).toContain('**Neon**');
  });
});
