import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { commandFailureResult, commandLogTail } from '../src/server/lib/sandboxCommandError';

/**
 * THE OPEN ROOT CAUSE THIS SERVES (build report e61b13b1, 2026-08-10). The pre-boot dependency install
 * failed and the report's only evidence was `exit status 217` — no npm output at all — while the SAME
 * installer succeeded nineteen seconds later inside the dev-server boot. I could not root-cause it and
 * recorded it honestly as open.
 *
 * This is WHY it was unexplainable: nine call sites handled a failed command as
 *     .catch((err) => ({ exitCode: -1, stdout: '', stderr: err?.message || String(err) }))
 * The E2B SDK REJECTS on a non-zero exit and carries the command's real stdout/stderr/exitCode ON THE
 * ERROR — and that handler threw all of it away, keeping only the bare status line. The one moment we
 * most need a tool's own words is the exact moment we were discarding them, so no number of reports
 * could ever have explained it.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('a failed command keeps what it actually said', () => {
  it('THE REPORTED CASE: npm output survives instead of a bare "exit status 217"', () => {
    const err = Object.assign(new Error('exit status 217'), {
      exitCode: 217,
      stdout: 'npm warn deprecated foo@1.0.0\n',
      stderr: 'npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree\n',
    });
    const r = commandFailureResult(err);
    expect(r.exitCode).toBe(217);
    expect(r.stdout).toContain('npm warn deprecated');
    expect(r.stderr).toContain('ERESOLVE unable to resolve dependency tree');
    // The status line still rides along — it names something the output alone does not.
    expect(r.stderr).toContain('exit status 217');
  });

  it('the message is a FALLBACK, never a replacement', () => {
    const r = commandFailureResult(Object.assign(new Error('exit status 217'), { exitCode: 217 }));
    expect(r.stderr).toBe('exit status 217'); // genuinely all we were given
    expect(r.stdout).toBe('');
  });

  it('does not duplicate the status line when the stderr already contains it', () => {
    const err = Object.assign(new Error('exit status 1'), { exitCode: 1, stderr: 'boom: exit status 1' });
    expect(commandFailureResult(err).stderr).toBe('boom: exit status 1');
  });

  it('a transport failure (timeout, sandbox gone) still reports -1 — "could not run"', () => {
    expect(commandFailureResult(new Error('timed out')).exitCode).toBe(-1);
    expect(commandFailureResult(new Error('timed out')).stderr).toBe('timed out');
  });

  it('survives anything thrown at it', () => {
    expect(commandFailureResult(null)).toEqual({ exitCode: -1, stdout: '', stderr: '' });
    expect(commandFailureResult(undefined)).toEqual({ exitCode: -1, stdout: '', stderr: '' });
    expect(commandFailureResult('a string').stderr).toBe('a string');
    expect(commandFailureResult({ exitCode: 'nope', stdout: 42 }).exitCode).toBe(-1);
  });
});

describe('the log tail — npm puts the real cause at the END', () => {
  it('keeps the last lines of the combined output', () => {
    const out = { stdout: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'), stderr: 'npm error the real cause' };
    const tail = commandLogTail(out, 5);
    expect(tail).toContain('npm error the real cause');
    expect(tail).not.toContain('line 0');
    expect(tail.split('\n')).toHaveLength(5);
  });

  it('is empty when there was no output at all, rather than a stray newline', () => {
    expect(commandLogTail({ stdout: '', stderr: '' })).toBe('');
    expect(commandLogTail({} as any)).toBe('');
  });
});

describe('the SWEEP — no call site may re-invent the lossy version (rule 3)', () => {
  const FILES = [
    'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts',
    'src/server/EngineerAI/actuators/E2BActuator.ts',
    'src/server/EngineerAI/EngineerAgentLoop.ts',
  ];

  it('the output-discarding handler is gone from every file that had it', () => {
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/stdout: '', stderr: err\?\.message/);
      expect(src, f).toContain('commandFailureResult');
    }
  });

  it('every site goes through the one helper — a NEW one must join it, not re-invent it', () => {
    /**
     * The count is the tripwire, not the point: it fails when anyone adds a sandbox command, so they
     * have to prove the new one preserves the failure's output instead of discarding it.
     *
     * 9 → 10 on 2026-08-12: the `npm audit fix` remediation pass (npmAuditFix.ts) runs one more sandbox
     * command, and it uses the shared helper. That matters here specifically — if that command fails,
     * its stdout is the ONLY evidence of why npm could not apply the fixes, and a lossy handler would
     * leave the build reporting "the result could not be re-read" with nothing to explain it.
     *
     * 10 → 11 on 2026-08-15: the transient-fs-race install retry (`_npmInstall` step 2.5, from the
     * Mitrify ENOTEMPTY report a876b7bb) runs `npm install` once more — through the shared helper,
     * because if the RETRY also fails, its log is the only proof the failure was not transient after all.
     */
    const total = FILES.reduce((n, f) => n + (read(f).match(/commandFailureResult\(err\)/g) || []).length, 0);
    expect(total).toBe(11);
  });
});
