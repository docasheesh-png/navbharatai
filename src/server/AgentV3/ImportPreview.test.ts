import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { detectNeedsDatabase, envVarNames, buildDevEnvContent, externalSecretVars, externalServiceNote, conjurableSecrets, detectDatabaseProvider, persistentDatabaseAdvisory, previewBootFailureAdvisory, previewServeNarration, halfBootCause, detectMigrationCommand, shellEnvAssignment, schemaMissingFromLog } from './ImportPreview';

describe('previewBootFailureAdvisory (honest DB state, admin 2026-07-24) — a failed boot names the real cause', () => {
  it('DB-needed + not provisioned → tells the user to connect their own database', () => {
    const msg = previewBootFailureAdvisory({ needsDb: true, provider: 'PostgreSQL', externalVars: [], dbProvisioned: false });
    expect(msg).toMatch(/didn't boot/i);
    expect(msg).toMatch(/PostgreSQL/);
    expect(msg).toMatch(/Settings → App Settings → Database/);
    expect(msg).toMatch(/Diagnose/);
  });
  it('DB-needed + provisioned → explains a temp DB was used and the real one may be required', () => {
    const msg = previewBootFailureAdvisory({ needsDb: true, provider: 'Drizzle', externalVars: [], dbProvisioned: true });
    expect(msg).toMatch(/provisioned a temporary local one/i);
    expect(msg).toMatch(/Drizzle/);
  });
  it('external secrets → names them and points to Settings → Secrets & Keys', () => {
    const msg = previewBootFailureAdvisory({ needsDb: false, provider: null, externalVars: ['GOOGLE_CLIENT_ID', 'CASHFREE_APP_ID'], dbProvisioned: false });
    expect(msg).toMatch(/GOOGLE_CLIENT_ID/);
    expect(msg).toMatch(/Settings → Secrets & Keys/);
  });
  it('needs neither a DB nor external secrets → empty (caller keeps the generic line)', () => {
    expect(previewBootFailureAdvisory({ needsDb: false, provider: null, externalVars: [], dbProvisioned: false })).toBe('');
  });
  it('never leaks an AI vendor/model name', () => {
    const forbidden = /\b(gemini|claude|anthropic|glm|kimi|grok|openai|gpt|bedrock|vertex)\b/i;
    const msg = previewBootFailureAdvisory({ needsDb: true, provider: 'MongoDB', externalVars: ['STRIPE_KEY'], dbProvisioned: true });
    expect(msg).not.toMatch(forbidden);
  });
});

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

// EARN THE PREVIEW VERDICT (admin 2026-08-03, "Cannot GET /customer/home" was shown as ✅ live): a bound
// port is NOT the app serving. previewServeNarration turns the home-route probe result into an HONEST line.
describe('previewServeNarration — "✅ up" is EARNED by the home route rendering', () => {
  it('claims success ONLY when the home route actually rendered', () => {
    const v = previewServeNarration({ rendered: true, problems: [], port: 5000, needsDb: true });
    expect(v.ok).toBe(true);
    expect(v.text).toContain('Live preview is up on port 5000');
  });

  it('does NOT claim success when the server 404s its own client routes (the reported bug)', () => {
    const v = previewServeNarration({
      rendered: false,
      problems: ['the server returned 404 / "Cannot GET" — the dev server is not serving the app at this path'],
      port: 5000,
      needsDb: true,
    });
    expect(v.ok).toBe(false);
    expect(v.text).not.toContain('✅');
    expect(v.text).not.toMatch(/is up on port/);
    expect(v.text.toLowerCase()).toContain('cannot get');           // the real WHY is surfaced
    expect(v.text.toLowerCase()).toContain('only its api');         // full-stack-specific guidance
    expect(v.text).toMatch(/reload|diagnose/i);                     // an actionable next step
  });

  it('surfaces a build-error overlay honestly (not a fake up)', () => {
    const v = previewServeNarration({
      rendered: false,
      problems: ['the dev server is showing a build-error overlay (the app failed to compile)'],
      port: 3000,
      needsDb: false,
    });
    expect(v.ok).toBe(false);
    expect(v.text.toLowerCase()).toContain('build-error overlay');
  });

  it('handles an unreachable preview without a fake success', () => {
    const v = previewServeNarration({ rendered: false, problems: ['the preview could not be reached to verify it'], port: 8080, needsDb: false });
    expect(v.ok).toBe(false);
    expect(v.text).toMatch(/could not be reached/i);
  });
});

/**
 * halfBootCause (admin task 2, 2026-08-05). On Mitrify build d5f0a2bc the boot log NAMED the cause —
 * ECONNREFUSED at ensureSchema — and the verdict still guessed "only its API is serving", wrong even
 * about the API. The verdict must say what the log proves, and guess only when it proves nothing.
 */
describe('halfBootCause — the verdict reads the log we already captured', () => {
  // Condensed from the REAL Mitrify boot log — the exact failure this exists for.
  const MITRIFY_LOG = `
11:05:22 AM [express] serving on port 5000
UNHANDLED REJECTION — server kept alive: AggregateError [ECONNREFUSED]:
    at async ensureSchema (/home/user/workspace/server/ensureSchema.ts:15:18)
    Error: connect ECONNREFUSED 127.0.0.1:5432
`;

  it('names the database cause from the real Mitrify log', () => {
    const cause = halfBootCause(MITRIFY_LOG);
    expect(cause).toContain('could not reach its database');
    expect(cause).toContain('stopped booting half-way');
    expect(cause).toContain('Cannot GET');
  });

  it('names a missing key, with the key, when that is what the log shows', () => {
    const cause = halfBootCause('Error: Missing STRIPE_SECRET_KEY\n  at boot');
    expect(cause).toContain('required key');
    expect(cause).toContain('STRIPE_SECRET_KEY');
    expect(cause).toContain('Settings');
  });

  it('returns null rather than guessing — a wrong specific cause is worse than an honest generic one', () => {
    // port_in_use / generic crash / empty: the half-boot story is not proven, so the generic verdict
    // stands. False alarms are what teach people to ignore the verdict.
    expect(halfBootCause('Error: listen EADDRINUSE: address already in use :::5000')).toBeNull();
    expect(halfBootCause('some unrelated noise')).toBeNull();
    expect(halfBootCause('')).toBeNull();
    expect(halfBootCause(null)).toBeNull();
    expect(halfBootCause(undefined)).toBeNull();
  });
});

describe('previewServeNarration with a NAMED cause (task 2) and a fix offer (task 3)', () => {
  it('the named cause REPLACES the guess — never decorates it', () => {
    const v = previewServeNarration({
      rendered: false, problems: ['the server returned 404 / "Cannot GET"'], port: 5000, needsDb: true,
      bootCause: 'Your app started but could not reach its database (connection refused), so it stopped booting half-way — its pages were never mounted. That is why pages answer "Cannot GET"',
    });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('could not reach its database');
    // The old guess ("only its API") must be gone — it was wrong even about the API.
    expect(v.text).not.toContain('only its API');
  });

  it('appends the permission ask when the engine knows the repair — the reply IS the permission', () => {
    const v = previewServeNarration({
      rendered: false, problems: [], port: 5000, needsDb: true,
      bootCause: 'Your app started but could not reach its database…',
      fixOffer: 'I can make this app serve its pages even when the database is down — say "fix the boot guard" and I\'ll apply it.',
    });
    expect(v.text).toContain('say "fix the boot guard"');
  });

  it('a success needs no cause and carries no offer', () => {
    const v = previewServeNarration({ rendered: true, problems: [], port: 5000, needsDb: true, bootCause: 'x', fixOffer: 'y' });
    expect(v.ok).toBe(true);
    expect(v.text).not.toContain('x');
    expect(v.text).not.toContain('y');
  });

  it('without a named cause the old honest generic line stands, unchanged', () => {
    const v = previewServeNarration({ rendered: false, problems: ['the server returned 404 / "Cannot GET"'], port: 5000, needsDb: true, bootCause: null });
    expect(v.text).toContain("isn't serving the app's pages");
  });
});

// THE MISSING SUBSYSTEM (build report 32d4f48e, 2026-08-07 — Mitrify import): the DB was provisioned
// and SELECT 1-verified, the preview said "✅ up" with 0 warnings — and the boot log said
// `relation "profiles" does not exist` twice, because nothing ever ran the app's own migrations.
// These tests lock the runner (detect the app's OWN mechanism) and the honest last line (the log
// evidence can never again sit unread while the tally says zero problems).
describe('detectMigrationCommand — run the app\'s OWN migrations, never invent our own', () => {
  it('the project script wins — Mitrify\'s real shape (drizzle db:push)', () => {
    const files = {
      'package.json': JSON.stringify({ scripts: { dev: 'tsx server/index.ts', 'db:push': 'drizzle-kit push' }, dependencies: { 'drizzle-orm': '1' } }),
      'drizzle.config.ts': 'export default {}',
    };
    expect(detectMigrationCommand(files)).toEqual({ command: 'npm run db:push', label: 'npm run db:push' });
  });

  it('script preference order is deterministic (db:push before migrate)', () => {
    const files = { 'package.json': JSON.stringify({ scripts: { migrate: 'x', 'db:push': 'y' } }) };
    expect(detectMigrationCommand(files)!.command).toBe('npm run db:push');
  });

  it('Prisma with committed migrations → non-interactive, non-destructive deploy', () => {
    const files = {
      'package.json': JSON.stringify({ scripts: { dev: 'next dev' }, devDependencies: { prisma: '5' } }),
      'prisma/schema.prisma': 'model User {}',
      'prisma/migrations/0001_init/migration.sql': 'CREATE TABLE "User" ();',
    };
    expect(detectMigrationCommand(files)!.command).toBe('npx prisma migrate deploy');
  });

  it('Prisma with a schema but NO committed migrations → db push', () => {
    const files = {
      'package.json': JSON.stringify({ devDependencies: { prisma: '5' } }),
      'prisma/schema.prisma': 'model User {}',
    };
    expect(detectMigrationCommand(files)!.command).toBe('npx prisma db push --skip-generate');
  });

  it('no mechanism → null (an app whose server self-manages schema is left alone)', () => {
    expect(detectMigrationCommand({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) })).toBeNull();
    expect(detectMigrationCommand({})).toBeNull();
    expect(detectMigrationCommand({ 'package.json': 'not json' })).toBeNull();
  });

  it('an empty script value does not count', () => {
    expect(detectMigrationCommand({ 'package.json': JSON.stringify({ scripts: { 'db:push': '  ' } }) })).toBeNull();
  });
});

describe('shellEnvAssignment — the migration CLI sees the provisioned URL even without .env loading', () => {
  it('quotes the value safely', () => {
    expect(shellEnvAssignment('DATABASE_URL', 'postgresql://user:pw@localhost:5432/app'))
      .toBe(`DATABASE_URL='postgresql://user:pw@localhost:5432/app'`);
  });

  it('escapes single quotes so a hostile value cannot break out', () => {
    expect(shellEnvAssignment('X', "a'b")).toBe(`X='a'\\''b'`);
  });
});

describe('schemaMissingFromLog — the honest last line reads what the log proves', () => {
  it('recognises the VERBATIM evidence from report 32d4f48e', () => {
    const log = '[ensureSchema] WARNING: schema repair failed: error: relation "profiles" does not exist\n    at /home/user/workspace/node_modules/pg/lib/client.js:545:17';
    expect(schemaMissingFromLog(log)).toBe('profiles');
  });

  it('strips a schema qualifier and covers SQLite/MySQL shapes', () => {
    expect(schemaMissingFromLog('error: relation "public.orders" does not exist')).toBe('orders');
    expect(schemaMissingFromLog('SqliteError: no such table: users')).toBe('users');
    expect(schemaMissingFromLog("ER_NO_SUCH_TABLE: Table 'shop.items' doesn't exist")).toBe('items');
  });

  it('a clean log proves nothing — null, no false alarm', () => {
    expect(schemaMissingFromLog('serving on port 3000')).toBeNull();
    expect(schemaMissingFromLog('')).toBeNull();
    expect(schemaMissingFromLog(null)).toBeNull();
  });
});

// Source contract: the runner + scanner are genuinely wired into the import boot (dead code is the
// trap), the migration runs AFTER the DB/.env exist and BEFORE the dev server, and the scan records
// an UNRESOLVED warning (autoResolved: false) so the report tally can never say "0 problems" again.
describe('wiring — migrations run before the boot; the log scan cannot be silent', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../routes/agentv3.ts', import.meta.url)), 'utf8');

  it('the migration step exists, env-prefixed, bounded, and honestly recorded both ways', () => {
    expect(SRC).toContain('detectMigrationCommand(importedFiles)');
    expect(SRC).toContain("shellEnvAssignment('DATABASE_URL', provided.DATABASE_URL)");
    expect(SRC).toContain("'import-db-migrate'");
    expect(SRC).toContain("code: mok ? 'IMPORT_DB_MIGRATIONS_APPLIED' : 'IMPORT_DB_MIGRATIONS_FAILED'");
  });

  it('the migration runs BEFORE the dev-server boot command', () => {
    expect(SRC.indexOf('detectMigrationCommand(importedFiles)')).toBeLessThan(SRC.indexOf("'import-preview-boot'"));
  });

  it('the schema scan reads the boot log and records an UNRESOLVED warning', () => {
    expect(SRC).toContain('schemaMissingFromLog(combined)');
    const at = SRC.indexOf("code: 'DB_SCHEMA_MISSING'");
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 700)).toContain('autoResolved: false');
  });
});
