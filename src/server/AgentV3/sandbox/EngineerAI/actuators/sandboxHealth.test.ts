import { describe, it, expect } from 'vitest';
import { isDeadSandboxError, isDeadSandboxSignal, resolveThrownCommandExit } from './sandboxHealth';

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
