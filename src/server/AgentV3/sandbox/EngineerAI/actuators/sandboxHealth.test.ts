import { describe, it, expect } from 'vitest';
import { isDeadSandboxError, isDeadSandboxSignal, resolveThrownCommandExit, detectSilentDbFailure, looksLikeDbUnreachable } from './sandboxHealth';

describe('resolveThrownCommandExit — a rejected command keeps its REAL exit code (PaisaTrack autopsy)', () => {
  it("uses the error's own exitCode (E2B CommandExitError) — a tsc exit 2 stays 2, not -1", () => {
    expect(resolveThrownCommandExit({ exitCode: 2, message: 'exit status 2' })).toBe(2);
    expect(resolveThrownCommandExit({ exitCode: 1 })).toBe(1);
  });

  it('parses "exit status N" from the message when no numeric exitCode is present', () => {
    expect(resolveThrownCommandExit({ message: 'Command failed with exit status 2' })).toBe(2);
    expect(resolveThrownCommandExit({ message: 'process exited: exit code 127' })).toBe(127);
  });

  it('returns -1 ONLY when the program truly never ran (no exit info — the dead-sandbox case)', () => {
    expect(resolveThrownCommandExit({ message: 'fetch failed: ECONNRESET' })).toBe(-1);
    expect(resolveThrownCommandExit(new Error('sandbox not found'))).toBe(-1);
    expect(resolveThrownCommandExit(null)).toBe(-1);
    expect(resolveThrownCommandExit({ exitCode: -1 })).toBe(-1);
  });

  it('a recovered real exit code makes isDeadSandboxSignal correctly return FALSE (not a dead sandbox)', () => {
    const realExit = resolveThrownCommandExit({ exitCode: 2, message: 'exit status 2' });
    expect(isDeadSandboxSignal({ exitCode: realExit, durationMs: 1000, stdout: '', stderr: 'error TS2532' })).toBe(false);
  });
});

describe('isDeadSandboxError', () => {
  it('detects reaped / not-running / expired sandboxes', () => {
    expect(isDeadSandboxError('sandbox not found')).toBe(true);
    expect(isDeadSandboxError('Sandbox is not running')).toBe(true);
    expect(isDeadSandboxError('the sandbox timed out and needs to restart')).toBe(true);
    expect(isDeadSandboxError('sandbox has been reaped')).toBe(true);
  });

  it('detects network/gateway death', () => {
    expect(isDeadSandboxError('connect ECONNREFUSED 10.0.0.1:49982')).toBe(true);
    expect(isDeadSandboxError('502 Bad Gateway')).toBe(true);
    expect(isDeadSandboxError('socket hang up')).toBe(true);
    expect(isDeadSandboxError('fetch failed')).toBe(true);
  });

  it('does NOT flag a normal command error as a dead sandbox', () => {
    expect(isDeadSandboxError('ls: cannot access src/pages: No such file or directory')).toBe(false);
    expect(isDeadSandboxError('npm ERR! missing script: dev')).toBe(false);
    expect(isDeadSandboxError('')).toBe(false);
    expect(isDeadSandboxError(undefined)).toBe(false);
  });
});

describe('isDeadSandboxSignal', () => {
  // THE reported shape (2026-07-05): every `ls`/`pwd`/`cat package.json`/`true`/`echo ok` returned
  // exit -1 in 0s with no output — the SDK threw because the sandbox was dead. Must be detected so the
  // corpse is evicted + recreated instead of grinding 81 commands against it.
  it('flags "exit -1, ~0ms, no output" as a dead sandbox (the reported bug)', () => {
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 0, stdout: '', stderr: '' })).toBe(true);
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 40, stdout: '', stderr: '', errorMessage: 'timed out after 5000ms' })).toBe(true);
  });

  it('flags a dead-pattern error even with output/time', () => {
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 3000, errorMessage: 'sandbox not found' })).toBe(true);
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 3000, stderr: 'ECONNRESET' })).toBe(true);
  });

  it('does NOT flag a real command that ran and returned nonzero (has output)', () => {
    // `ls nonexistent` on a LIVE sandbox: exit 2, real stderr — keep the sandbox.
    expect(isDeadSandboxSignal({ exitCode: 2, durationMs: 30, stderr: 'ls: cannot access foo: No such file or directory' })).toBe(false);
    // A program that failed but produced output is NOT a dead sandbox.
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 10, stdout: 'partial output', stderr: '' })).toBe(false);
  });

  it('does NOT flag a slow SDK failure with no dead-pattern (e.g. a genuine long command that errored)', () => {
    // exitCode<0 but it took real time and had no dead-pattern → ambiguous, do NOT nuke the sandbox.
    expect(isDeadSandboxSignal({ exitCode: -1, durationMs: 5000, stdout: '', stderr: '' })).toBe(false);
  });

  it('a normal successful-but-nonzero program exit is never a dead signal', () => {
    expect(isDeadSandboxSignal({ exitCode: 1, durationMs: 0, stdout: '', stderr: '' })).toBe(false);
  });
});

describe('detectSilentDbFailure — exit 0 that hides a DB-unreachable failure (MediConnect autopsy)', () => {
  // THE reported shape (App #14, Remix + Prisma + Postgres): `npx prisma migrate dev --name init`
  // returned exit 0, but its own stdout said the DB was never reachable. The migration did NOT apply.
  const MEDICONNECT_MIGRATE_STDOUT = [
    '[health-check] installing dependencies (package.json changed)… done.',
    '[health-check] attempt 1 — The dev server crashed on startup — restarting. Error: P1001: Can\'t reach database server at `localhost:5432`',
    '[health-check] dev server did not come up on port 5432 after automatic recovery.',
  ].join('\n');

  it('flags the real MediConnect migrate: exit 0 + P1001 in output = silent DB failure', () => {
    expect(detectSilentDbFailure({
      command: 'npx prisma migrate dev --name init',
      exitCode: 0,
      stdout: MEDICONNECT_MIGRATE_STDOUT,
    })).toBe(true);
  });

  it('flags a prisma seed that "succeeded" but could not reach the database', () => {
    expect(detectSilentDbFailure({
      command: 'npx tsx prisma/seed.ts',
      exitCode: 0,
      stderr: 'PrismaClientInitializationError: Can\'t reach database server at `localhost:5432`',
    })).toBe(true);
  });

  it('does NOT flag when the exit code already reports failure (handled by the normal path)', () => {
    expect(detectSilentDbFailure({
      command: 'npx prisma migrate dev',
      exitCode: 1,
      stderr: 'P1001: Can\'t reach database server',
    })).toBe(false);
  });

  it('does NOT flag a non-DB command that merely echoes the string P1001', () => {
    expect(detectSilentDbFailure({
      command: 'echo "the error code was P1001"',
      exitCode: 0,
      stdout: 'the error code was P1001',
    })).toBe(false);
  });

  it('does NOT flag a healthy migrate (exit 0, no unreachable signal)', () => {
    expect(detectSilentDbFailure({
      command: 'npx prisma migrate dev --name init',
      exitCode: 0,
      stdout: '✔ Generated Prisma Client\nYour database is now in sync with your schema.',
    })).toBe(false);
  });

  it('does NOT flag a null exit code (still-running / not settled)', () => {
    expect(detectSilentDbFailure({ command: 'npx prisma migrate dev', exitCode: null, stdout: 'P1001' })).toBe(false);
  });

  // LedgerLoop autopsy 2026-07-20: a Prisma SCHEMA-validation error makes the health-check print
  // "did not come up on port 5432", which the first cut mislabeled as DB_UNREACHABLE. The DB is fine —
  // the schema is wrong. Must NOT be flagged (the schema-repair path owns it).
  it('does NOT flag a Prisma schema-validation error even though the health-check mentions port 5432', () => {
    const schemaErr = [
      'Error: Prisma schema validation - (validate wasm)',
      'auditLogs    AuditLog[]',
      'Validation Error Count: 3',
      '[Context: validate]',
      '[health-check] dev server did not come up on port 5432 after automatic recovery. Root cause: Prisma schema validation',
    ].join('\n');
    expect(detectSilentDbFailure({ command: 'npx prisma migrate dev --name init', exitCode: 0, stdout: schemaErr })).toBe(false);
  });

  it('STILL flags a genuine P1001 even if a schema marker also appears (connectivity wins)', () => {
    const both = 'Validation Error Count: 1\nError: P1001: Can\'t reach database server at `localhost:5432`';
    expect(detectSilentDbFailure({ command: 'npx prisma migrate dev', exitCode: 0, stdout: both })).toBe(true);
  });
});

describe('looksLikeDbUnreachable — triggers a mid-build Postgres re-provision (FleetOps autopsy)', () => {
  it('detects P1001 / can\'t reach server / connection refused :5432, regardless of exit code', () => {
    expect(looksLikeDbUnreachable('Error: P1001: Can\'t reach database server at `localhost:5432`')).toBe(true);
    expect(looksLikeDbUnreachable("can't reach database server")).toBe(true);
    expect(looksLikeDbUnreachable('connection refused ... :5432')).toBe(true);
  });
  it('does NOT fire on a schema-validation error or unrelated output', () => {
    expect(looksLikeDbUnreachable('Validation Error Count: 3\n[Context: validate]')).toBe(false);
    expect(looksLikeDbUnreachable('Your database is now in sync')).toBe(false);
    expect(looksLikeDbUnreachable('')).toBe(false);
    expect(looksLikeDbUnreachable(null)).toBe(false);
  });
});
