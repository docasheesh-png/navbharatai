import { describe, it, expect } from 'vitest';
import {
  sandboxPostgresEnabled,
  commandNeedsLiveDatabase,
  schemaTargetsPostgres,
  postgresEnvLines,
  schemaTargetsSqlite,
  revertSqliteToPostgres,
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
