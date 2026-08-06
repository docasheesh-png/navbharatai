import { describe, it, expect } from 'vitest';
import {
  sandboxPostgresEnabled,
  isUserOwnedDatabaseUrl,
  commandNeedsLiveDatabase,
  schemaTargetsPostgres,
  postgresEnvLines,
  mergeEnvVar,
  schemaTargetsSqlite,
  revertSqliteToPostgres,
  postgresWatchdogCommand,
  postgresPreflightProbeCommand,
  shouldPreflightPostgres,
  canAttemptPostgresRevival,
  POSTGRES_WATCHDOG_MARKER,
  POSTGRES_MAX_REVIVALS,
} from './postgresProvision';

describe('sandboxPostgresEnabled — default ON, off only via explicit flag', () => {
  it('is ON by default (unset)', () => {
    expect(sandboxPostgresEnabled({})).toBe(true);
  });
  it('is OFF only for the explicit kill switch', () => {
    expect(sandboxPostgresEnabled({ AGENTV3_SANDBOX_POSTGRES: 'off' })).toBe(false);
    expect(sandboxPostgresEnabled({ AGENTV3_SANDBOX_POSTGRES: 'OFF' })).toBe(false);
  });
  it('any other value keeps it ON', () => {
    expect(sandboxPostgresEnabled({ AGENTV3_SANDBOX_POSTGRES: 'on' })).toBe(true);
    expect(sandboxPostgresEnabled({ AGENTV3_SANDBOX_POSTGRES: '' })).toBe(true);
  });
});

describe('commandNeedsLiveDatabase — only commands that open a real DB connection', () => {
  it('flags prisma migrate (dev/deploy/reset) — the exact MediConnect command', () => {
    expect(commandNeedsLiveDatabase('npx prisma migrate dev --name init')).toBe(true);
    expect(commandNeedsLiveDatabase('cd app && npx prisma migrate deploy')).toBe(true);
    expect(commandNeedsLiveDatabase('npx prisma migrate reset --force')).toBe(true);
  });
  it('flags prisma db push / seed / execute', () => {
    expect(commandNeedsLiveDatabase('npx prisma db push')).toBe(true);
    expect(commandNeedsLiveDatabase('npx prisma db seed')).toBe(true);
  });
  it('flags a seed script run directly (the MediConnect seed step)', () => {
    expect(commandNeedsLiveDatabase('npx tsx prisma/seed.ts')).toBe(true);
    expect(commandNeedsLiveDatabase('ts-node prisma/seed.ts')).toBe(true);
    expect(commandNeedsLiveDatabase('node dist/seed.js')).toBe(true);
  });
  it('does NOT flag prisma generate / format / validate (no DB connection)', () => {
    expect(commandNeedsLiveDatabase('npx prisma generate')).toBe(false);
    expect(commandNeedsLiveDatabase('npx prisma format')).toBe(false);
    expect(commandNeedsLiveDatabase('npx prisma validate')).toBe(false);
  });
  it('does NOT flag ordinary build/install commands', () => {
    expect(commandNeedsLiveDatabase('npm install')).toBe(false);
    expect(commandNeedsLiveDatabase('npm run build')).toBe(false);
    expect(commandNeedsLiveDatabase('')).toBe(false);
  });
});

describe('schemaTargetsPostgres — only a postgres datasource', () => {
  const pg = `datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n`;
  const sqlite = `datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n`;
  it('detects a postgresql datasource', () => {
    expect(schemaTargetsPostgres(pg)).toBe(true);
    expect(schemaTargetsPostgres(pg.replace(/\s+/g, ' '))).toBe(true); // whitespace tolerant
  });
  it('is false for sqlite / mysql / empty', () => {
    expect(schemaTargetsPostgres(sqlite)).toBe(false);
    expect(schemaTargetsPostgres('datasource db { provider = "mysql" }')).toBe(false);
    expect(schemaTargetsPostgres('')).toBe(false);
    expect(schemaTargetsPostgres(null)).toBe(false);
    expect(schemaTargetsPostgres(undefined)).toBe(false);
  });
});

describe('schemaTargetsSqlite / revertSqliteToPostgres — the provider LOCK (LedgerLoop autopsy)', () => {
  const sqlite = `datasource db {\n  provider = "sqlite"\n  url      = "file:./dev.db"\n}\n\nmodel Org { id String @id }\n`;
  const pg = `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n`;

  it('detects a sqlite datasource', () => {
    expect(schemaTargetsSqlite(sqlite)).toBe(true);
    expect(schemaTargetsSqlite(pg)).toBe(false);
    expect(schemaTargetsSqlite('')).toBe(false);
  });

  it('reverts a sqlite downgrade back to postgresql + env DATABASE_URL', () => {
    const { content, reverted } = revertSqliteToPostgres(sqlite);
    expect(reverted).toBe(true);
    expect(content).toContain('provider = "postgresql"');
    expect(content).toContain('url = env("DATABASE_URL")');
    expect(content).not.toMatch(/sqlite|file:/);
    expect(content).toContain('model Org { id String @id }'); // the rest of the schema is untouched
  });

  it('is a no-op for a schema that is already postgres (nothing to revert)', () => {
    const { content, reverted } = revertSqliteToPostgres(pg);
    expect(reverted).toBe(false);
    expect(content).toBe(pg);
  });
});

describe('postgresEnvLines', () => {
  it('maps a real DATABASE_URL to a merge-able env line', () => {
    expect(postgresEnvLines('postgresql://postgres@localhost:5432/myapp')).toEqual({
      DATABASE_URL: 'postgresql://postgres@localhost:5432/myapp',
    });
  });
  it('is empty for a blank/absent url', () => {
    expect(postgresEnvLines('')).toEqual({});
    expect(postgresEnvLines('   ')).toEqual({});
    expect(postgresEnvLines(null)).toEqual({});
  });
});

describe('mergeEnvVar — write a provisioned DATABASE_URL into a first-time app .env without clobbering', () => {
  const url = 'postgresql://postgres@localhost:5432/myapp';
  it('appends to an empty/absent .env (a from-scratch Drizzle app had no .env)', () => {
    expect(mergeEnvVar('', 'DATABASE_URL', url)).toBe(`DATABASE_URL=${url}\n`);
    expect(mergeEnvVar(null, 'DATABASE_URL', url)).toBe(`DATABASE_URL=${url}\n`);
  });
  it('preserves existing vars and appends when the key is absent', () => {
    const out = mergeEnvVar('NODE_ENV=development\nPORT=3000', 'DATABASE_URL', url);
    expect(out).toContain('NODE_ENV=development');
    expect(out).toContain('PORT=3000');
    expect(out).toContain(`DATABASE_URL=${url}`);
  });
  it('REPLACES an existing (blank/placeholder) DATABASE_URL line in place, not a duplicate', () => {
    const out = mergeEnvVar('DATABASE_URL=\nAPI_KEY=x', 'DATABASE_URL', url);
    expect((out.match(/^DATABASE_URL=/gm) || []).length).toBe(1);
    expect(out).toContain(`DATABASE_URL=${url}`);
    expect(out).toContain('API_KEY=x');
  });
  it('also replaces an `export DATABASE_URL=` form', () => {
    expect(mergeEnvVar('export DATABASE_URL=old', 'DATABASE_URL', url)).toBe(`DATABASE_URL=${url}`);
  });
});

describe('Postgres liveness — watchdog + preflight + bounded revival (last-5-reports class fix 2026-07-20)', () => {
  // THE CLASS: five consecutive build reports (#14 MediConnect → #18 EstateNest) all died on some flavour
  // of "the sandbox Postgres was reaped between touchpoints", and every prior fix was reactive/once-only.

  it('watchdog command is duplicate-guarded, self-restarting, and detached', () => {
    const cmd = postgresWatchdogCommand();
    expect(cmd).toContain(`pgrep -f ${POSTGRES_WATCHDOG_MARKER}`); // never stack two watchdogs
    expect(cmd).toContain('pg_isready');                            // liveness check, not a blind restart
    expect(cmd).toContain('pg_ctlcluster');                         // the restart that actually works in E2B
    expect(cmd).toContain('nohup');                                 // survives the provisioning command
    expect(cmd).toContain('setsid');                                // detached from the caller's session
    expect(cmd).toContain('WATCHDOG_ARMED');                        // observable arm confirmation
    // The marker must ride as $0 so pgrep -f can see it on the running shell.
    expect(cmd).toContain(`done' ${POSTGRES_WATCHDOG_MARKER}`);
  });

  it('preflight probe prints PG_UP / PG_DOWN and can never fail the build (|| fallback)', () => {
    const cmd = postgresPreflightProbeCommand();
    expect(cmd).toContain('pg_isready');
    expect(cmd).toContain('PG_UP');
    expect(cmd).toContain('PG_DOWN');
  });

  it('preflight fires only for a provisioned, not-dead, live-DB command — and not right after provisioning', () => {
    const base = { provisioned: true, confirmedDead: false, needsLiveDb: true, provisionedAtMs: 0, nowMs: 60_000 };
    expect(shouldPreflightPostgres(base)).toBe(true);
    expect(shouldPreflightPostgres({ ...base, provisioned: false })).toBe(false);
    expect(shouldPreflightPostgres({ ...base, confirmedDead: true })).toBe(false);
    expect(shouldPreflightPostgres({ ...base, needsLiveDb: false })).toBe(false);
    // Freshly provisioned (verified ready seconds ago) → probing again is pure waste.
    expect(shouldPreflightPostgres({ ...base, provisionedAtMs: 55_000 })).toBe(false);
  });

  it('revival is bounded but NOT once-only (the FleetOps/EstateNest lesson: restarts genuinely work)', () => {
    expect(canAttemptPostgresRevival(0)).toBe(true);
    expect(canAttemptPostgresRevival(1)).toBe(true);  // the old once-only flag forbade this second revival
    expect(canAttemptPostgresRevival(POSTGRES_MAX_REVIVALS)).toBe(false); // budget spent → honest SQLite degrade
    expect(canAttemptPostgresRevival(-1)).toBe(false);
    expect(canAttemptPostgresRevival(NaN)).toBe(false);
  });
});

/**
 * THE USER'S OWN DATABASE MUST WIN (admin question 2026-08-06: "user apna db ka link credentials dega").
 * A user CAN connect their own database in Settings → App Settings → Database, and the build injects it
 * into the app's `.env`. `ensureSandboxPostgres` then provisioned a sandbox-local Postgres and merged
 * `postgresql://postgres@localhost:5432/myapp` OVER it, so the app silently pointed at a throwaway
 * database instead of the one the user chose — and nothing said so.
 */
describe('isUserOwnedDatabaseUrl', () => {
  it('recognises a real remote database as the user\'s', () => {
    expect(isUserOwnedDatabaseUrl('postgresql://postgres.abcdefgh:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres')).toBe(true);
    expect(isUserOwnedDatabaseUrl('postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres')).toBe(true);
    expect(isUserOwnedDatabaseUrl('postgres://user:pw@ep-cool-name.eu-central-1.aws.neon.tech/neondb?sslmode=require')).toBe(true);
  });

  it('recognises the sandbox\'s OWN local Postgres as not the user\'s', () => {
    expect(isUserOwnedDatabaseUrl('postgresql://postgres@localhost:5432/myapp')).toBe(false);
    expect(isUserOwnedDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/app')).toBe(false);
    expect(isUserOwnedDatabaseUrl('postgresql://postgres@[::1]:5432/app')).toBe(false);
    // docker-compose service names a scaffold writes — there is no docker in the sandbox, so these are
    // template defaults, never a database the user chose.
    expect(isUserOwnedDatabaseUrl('postgresql://postgres:postgres@db:5432/app')).toBe(false);
  });

  it('is false for anything that is not a live remote connection', () => {
    expect(isUserOwnedDatabaseUrl('')).toBe(false);
    expect(isUserOwnedDatabaseUrl(null)).toBe(false);
    expect(isUserOwnedDatabaseUrl(undefined)).toBe(false);
    expect(isUserOwnedDatabaseUrl('file:./dev.db')).toBe(false);      // SQLite — no server at all
    expect(isUserOwnedDatabaseUrl('your_database_url_here')).toBe(false); // generated placeholder
  });

  it('still finds the host when the password contains characters URL parsing rejects', () => {
    // Treating a real remote database as "unknown" is the failure that clobbers a user's choice.
    expect(isUserOwnedDatabaseUrl('postgresql://user:p@ss w0rd@my-db.example.com:5432/app')).toBe(true);
  });

  it('quoted .env values are handled (the file keeps the quotes, the URL does not)', () => {
    expect(isUserOwnedDatabaseUrl('"postgresql://u:p@db.example.com:5432/app"')).toBe(true);
    expect(isUserOwnedDatabaseUrl("'postgresql://postgres@localhost:5432/myapp'")).toBe(false);
  });
});
