import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { pgUpCommand, pgStartCommand, PGBIN_EXPR, PGDATA_EXPR, PGHOME_EXPR } from './pgShell';

/**
 * ONE definition of "is Postgres up" and "start Postgres" (admin 2026-08-06, "pura rocksolid banao").
 *
 * Three pieces of the engine each had their own, all written when the only possible Postgres was the
 * Debian cluster. The moment a sandbox could get Postgres from somewhere else — a relocatable build
 * shipping NO client tools — they broke in opposite directions: the PROBE declared a healthy database
 * dead (burning the bounded revivals and releasing the provider lock into a SQLite downgrade), and the
 * WATCHDOG became a busy loop running a command that does not exist, so a reaped database never came
 * back. The new path would have worked exactly once and then failed.
 *
 * Behaviour here was verified by RUNNING it against a real fetched Postgres as an unprivileged user
 * with no client tools on PATH; these lock the properties that made it work.
 */
describe('pgUpCommand — three rungs, because no single tool is guaranteed', () => {
  const cmd = pgUpCommand();

  it('is valid shell', () => {
    expect(() => execFileSync('bash', ['-n'], { input: `${cmd} && echo UP || echo DOWN` })).not.toThrow();
    expect(() => execFileSync('sh', ['-n'], { input: `${cmd} && echo UP || echo DOWN` })).not.toThrow();
  });

  it('asks pg_isready FIRST, but never depends on it', () => {
    expect(cmd).toContain('command -v pg_isready');
    expect(cmd).toContain('pg_ctl" -D');   // rung 2: ships with every build, client tools or not
    expect(cmd).toContain('nc -z');         // rung 3: something is listening
    expect(cmd.indexOf('pg_isready')).toBeLessThan(cmd.indexOf('pg_ctl" -D'));
  });

  it('every rung is guarded by a presence check — a missing tool is never an error', () => {
    for (const tool of ['pg_isready', 'nc']) expect(cmd).toContain(`command -v ${tool} >/dev/null 2>&1`);
    expect(cmd).toContain('[ -x "$PGB/pg_ctl" ]');
  });

  it('takes a port, so the probe and the server can never disagree about which one', () => {
    expect(pgUpCommand(5433)).toContain('-p 5433');
    expect(pgUpCommand(5433)).toContain('nc -z 127.0.0.1 5433');
  });

  it('contains NO single quote — it is embedded inside `sh -c \'…\'`', () => {
    // A single quote here would terminate the watchdog's script and leave a broken shell running.
    expect(cmd).not.toContain("'");
    expect(pgStartCommand()).not.toContain("'");
  });
});

describe('PGBIN_EXPR — ours wins when it exists, and that is correctness, not preference', () => {
  it('checks our own bin BEFORE falling back to the image\'s', () => {
    // `pg_ctl` REFUSES a data directory written by a different major version, so an image shipping
    // PostgreSQL 14 next to a fetched 16 would fail every start and every status check if the image's
    // binary were picked.
    expect(PGBIN_EXPR.indexOf(PGHOME_EXPR)).toBeLessThan(PGBIN_EXPR.indexOf('/usr/lib/postgresql'));
    expect(PGBIN_EXPR).toContain(`[ -x ${PGHOME_EXPR}/bin/pg_ctl ]`);
  });

  it('does not rely on `ls` preserving argument order — it does not', () => {
    // The first version listed both paths and took `tail -1`. `ls` RE-SORTS its arguments, so
    // /home/... sorted before /usr/... and the image's binary won every time. Caught by running it.
    expect(PGBIN_EXPR).not.toMatch(/ls -d [^|]*\.nbai-pg\/bin/);
  });

  it('the image fallback still picks the NEWEST version present', () => {
    expect(PGBIN_EXPR).toContain('sort -V | tail -1');
  });
});

describe('pgStartCommand — best effort, and never fatal', () => {
  const cmd = pgStartCommand();

  it('is valid shell and always exits 0', () => {
    expect(() => execFileSync('sh', ['-n'], { input: cmd })).not.toThrow();
    // A failed start must never kill the watchdog loop or the caller's command. The caller decides by
    // ASKING (pgUpCommand), never by trusting this return value.
    expect(cmd.trim().endsWith('|| true')).toBe(true);
  });

  it('tries the privileged cluster first, then our own instance', () => {
    expect(cmd.indexOf('pg_ctlcluster')).toBeLessThan(cmd.indexOf('pg_ctl" -D'));
  });

  it('refuses to start our instance unless its data directory really exists', () => {
    // Starting against a directory initdb never wrote is a guaranteed error and a misleading log line.
    expect(cmd).toContain(`[ -f "${PGDATA_EXPR}/PG_VERSION" ]`);
  });

  it('binds loopback only and keeps the socket somewhere writable', () => {
    expect(cmd).toContain('-h 127.0.0.1');
    expect(cmd).toContain('-k /tmp');
  });
});
