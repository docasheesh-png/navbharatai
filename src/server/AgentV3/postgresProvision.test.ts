import { describe, it, expect } from 'vitest';
import {
  sandboxPostgresEnabled,
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
