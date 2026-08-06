import { describe, it, expect, vi } from 'vitest';
import { sslConfigFor, isPostgresUrl, classifyPgFailure, connectMessageFor, runPostgresQuery, PG_STATEMENT_TIMEOUT_MS } from './postgresQuery';

/**
 * DATABASE STUDIO COULD READ EXACTLY ONE OF ELEVEN PROVIDERS (admin 2026-08-06).
 *
 * The whole Data GUI was built on Supabase's Management API, so a user on Neon, Render, Railway, Aiven
 * or their own server opened Studio, saw "Sample data", and reasonably concluded the feature was broken.
 * A shipped screen that tells 10 of 11 users something false is worse than one that is honestly absent.
 * This is the second transport; the SQL itself needed no changes.
 */
describe('sslConfigFor — libpq semantics, not whatever is convenient', () => {
  it('VERIFIES when the user asked for verification', () => {
    expect(sslConfigFor('postgresql://u:p@h.example.com/db?sslmode=verify-full')).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor('postgresql://u:p@h.example.com/db?sslmode=verify-ca')).toEqual({ rejectUnauthorized: true });
  });

  it('encrypts WITHOUT verifying for require/prefer — which is exactly what those mean', () => {
    // The usual shortcut is rejectUnauthorized:false for EVERY connection, which silently turns off
    // MITM protection on somebody's production database. The URL decides instead.
    expect(sslConfigFor('postgresql://u:p@h.example.com/db?sslmode=require')).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor('postgresql://u:p@h.example.com/db?sslmode=prefer')).toEqual({ rejectUnauthorized: false });
  });

  it('turns TLS off only when asked, or for the sandbox\'s own local database', () => {
    expect(sslConfigFor('postgresql://u:p@h.example.com/db?sslmode=disable')).toBe(false);
    expect(sslConfigFor('postgresql://postgres@localhost:5432/myapp')).toBe(false);
    expect(sslConfigFor('postgresql://postgres@127.0.0.1:5432/myapp')).toBe(false);
  });

  it('defaults to encrypted for a REMOTE host with no sslmode', () => {
    // Every managed Postgres requires TLS; connecting in cleartext would be worse than not verifying.
    expect(sslConfigFor('postgresql://u:p@ep-x.neon.tech/neondb')).toEqual({ rejectUnauthorized: false });
  });

  it('still finds the mode when the URL will not parse (an unencoded password)', () => {
    expect(sslConfigFor('postgresql://u:p@ss w0rd@h.example.com/db?sslmode=verify-full')).toEqual({ rejectUnauthorized: true });
  });
});

describe('isPostgresUrl — strict, so a wrong guess never reaches the driver', () => {
  it('accepts both spellings', () => {
    expect(isPostgresUrl('postgres://u:p@h/db')).toBe(true);
    expect(isPostgresUrl('postgresql://u:p@h:5432/db?sslmode=require')).toBe(true);
  });

  it('refuses everything else, so those fall through to an honest "cannot browse this yet"', () => {
    for (const u of ['mysql://u:p@h/db', 'mongodb+srv://u:p@c.mongodb.net/db', 'libsql://x.turso.io', 'file:./dev.db', 'your_database_url_here', '', null, undefined]) {
      expect(isPostgresUrl(u as string), String(u)).toBe(false);
    }
  });
});

describe('The user reads something they can act on', () => {
  it('a refused password sends them to the screen that fixes it', () => {
    expect(classifyPgFailure(new Error('password authentication failed for user "app"'))).toBe('unauthorized');
    expect(connectMessageFor(new Error('password authentication failed'))).toContain('Settings → App Settings → Database');
  });

  it('an unreachable database names the thing they can check', () => {
    expect(connectMessageFor(new Error('connect ETIMEDOUT'))).toContain('accepts connections from the internet');
  });

  it('a certificate problem points at the connection string their provider gives', () => {
    expect(connectMessageFor(new Error('self signed certificate in certificate chain'))).toContain('sslmode=require');
  });

  it('anything else is honest rather than invented', () => {
    expect(classifyPgFailure(new Error('boom'))).toBe('api-error');
    expect(connectMessageFor(new Error('boom'))).toContain('try again in a moment');
  });
});

describe('runPostgresQuery', () => {
  const fakeClient = (over: Partial<{ connect: () => Promise<void>; query: (s: string) => Promise<{ rows: unknown[] }>; end: () => Promise<void> }> = {}) => ({
    connect: over.connect ?? (async () => {}),
    query: over.query ?? (async () => ({ rows: [{ a: 1 }] })),
    end: over.end ?? (async () => {}),
  });

  it('returns rows and always closes the connection', async () => {
    const end = vi.fn(async () => {});
    const r = await runPostgresQuery('postgresql://u:p@h/db', 'select 1', (() => fakeClient({ end })) as never);
    expect(r.ok).toBe(true);
    expect(r.ok && r.rows).toEqual([{ a: 1 }]);
    expect(end).toHaveBeenCalled();
  });

  it('closes the connection even when the QUERY throws', async () => {
    // A connection left open on a free-tier provider is one of their app's own slots.
    const end = vi.fn(async () => {});
    const r = await runPostgresQuery('postgresql://u:p@h/db', 'select 1', (() => fakeClient({ query: async () => { throw new Error('syntax error at or near "slect"'); }, end })) as never);
    expect(r.ok).toBe(false);
    expect(end).toHaveBeenCalled();
  });

  it('never returns the driver\'s own text — it quotes the SQL, and a write quotes VALUES', async () => {
    const r = await runPostgresQuery('postgresql://u:p@h/db', 'x', (() => fakeClient({ query: async () => { throw new Error('column "secret_token" does not exist'); } })) as never);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).not.toContain('secret_token');
    expect(r.ok === false && r.detail).toContain('secret_token'); // the real text goes to the log
  });

  it('refuses a non-Postgres URL before opening anything', async () => {
    const factory = vi.fn();
    const r = await runPostgresQuery('mysql://u:p@h/db', 'select 1', factory as never);
    expect(r.ok).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('bounds both the connect and the statement, so a hung database cannot hang the screen', async () => {
    let cfg: Record<string, unknown> = {};
    await runPostgresQuery('postgresql://u:p@h/db', 'select 1', ((c: Record<string, unknown>) => { cfg = c; return fakeClient(); }) as never);
    expect(cfg.statement_timeout).toBe(PG_STATEMENT_TIMEOUT_MS);
    expect(cfg.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });
});
