/**
 * "STILL RUNNING" vs "CUT OFF" — the honesty fix from the f04421ef autopsy (2026-09-13).
 *
 * 🔴 WHAT WENT WRONG, and why it is worth a file of its own. The admin asked for a build report while a
 * build was WORKING. The report said *"This build ended without recording an outcome (cut off before it
 * could report one) — so the reason it stopped is NOT known"*, and the whole autopsy that followed went
 * looking for a build that had stopped. Nothing had stopped: no `endedAt`, the last recorded event was a
 * command that SUCCEEDED nine minutes in, and the last heartbeat read "in-flight: bash".
 *
 * The conflation was KNOWN and accepted — the old branch carried the line "a build genuinely still
 * running reads the same way, which is correct". It is correct that we do not know the ending; it is not
 * correct to announce an ending that has not happened. One sentence tells the reader to wait, the other
 * tells them to investigate.
 */
import { describe, it, expect } from 'vitest';
import { deriveRootCause, STILL_RUNNING_WINDOW_MS, type BuildIssue } from '../src/server/AgentV3/BuildDiagnostics';

const issue = (over: Partial<BuildIssue> = {}): BuildIssue => ({
  ts: 1_000, phase: 'build', severity: 'error', code: 'SANDBOX_CMD_FAILED',
  message: '$ ./node_modules/.bin/tsc --noEmit 2>&1 → exit 2 (3s)', autoResolved: false, ...over,
} as BuildIssue);

describe('the two sentences are different, and each says the right thing', () => {
  it('🔴 a STILL-RUNNING build is not told it stopped', () => {
    const out = deriveRootCause({ issues: [issue()], stillRunning: true })!;
    expect(out).toMatch(/STILL RUNNING/);
    expect(out).toMatch(/has not ended/i);
    // The exact claim that sent the last autopsy after a phantom.
    expect(out).not.toMatch(/cut off/i);
    expect(out).not.toMatch(/reason it stopped/i);
  });

  it('it still NAMES the worst issue seen — the useful half is kept', () => {
    const out = deriveRootCause({ issues: [issue()], stillRunning: true })!;
    expect(out).toContain('tsc --noEmit');
    // …but as something in progress, not as a cause of an ending that has not happened.
    expect(out).toMatch(/may still be working on/i);
  });

  it('a still-running build with nothing wrong yet says exactly that', () => {
    const out = deriveRootCause({ issues: [], stillRunning: true })!;
    expect(out).toMatch(/STILL RUNNING/);
    expect(out).toMatch(/no unresolved issue has been recorded so far/i);
  });

  it('a build that genuinely ENDED without an outcome keeps its old, correct sentence', () => {
    // The 2026-09-10 fix is not weakened — only narrowed to the case it was written for.
    const out = deriveRootCause({ issues: [issue()], endedWithoutOutcome: true })!;
    expect(out).toMatch(/ended without recording an outcome/i);
    expect(out).toMatch(/cut off/i);
    expect(out).not.toMatch(/STILL RUNNING/);
  });

  it('a finished build is unaffected by either flag', () => {
    expect(deriveRootCause({ issues: [], ok: true })).toMatch(/completed successfully/i);
    expect(deriveRootCause({ issues: [issue()], ok: false })).toBe(issue().message);
  });
});

describe('the liveness window', () => {
  it('is two heartbeats, so one missed beat cannot make a live build look stopped', () => {
    // The heartbeat is once a minute. A single skipped beat must not flip the verdict.
    expect(STILL_RUNNING_WINDOW_MS).toBeGreaterThanOrEqual(120_000);
    // …and not so wide that a build which stopped an hour ago still reads as working.
    expect(STILL_RUNNING_WINDOW_MS).toBeLessThanOrEqual(300_000);
  });
});

describe('🔴 the real report, reproduced', () => {
  it('the f04421ef shape reads as STILL RUNNING, not as cut off', async () => {
    const { BuildDiagnostics } = await import('../src/server/AgentV3/BuildDiagnostics');
    // A clock we control, so "alive" is asserted rather than raced.
    let now = 0;
    const diag = new BuildDiagnostics({ model: 'claude-haiku-4-5-20251001', framework: 'vite-react', now: () => now });
    now = 1_000;
    diag.record({ phase: 'build', severity: 'error', code: 'SANDBOX_CMD_FAILED', message: '$ tsc → exit 2', autoResolved: false });
    // The report is taken seconds later, while the build is still working — exactly the admin's case.
    now = 6_000;
    const report = diag.report();
    expect(report.ok).toBeUndefined();
    expect(report.endedAt).toBeUndefined();
    expect(report.rootCause).toMatch(/STILL RUNNING/);
    expect(report.rootCause).not.toMatch(/cut off/i);
  });

  it('the same build, read LONG after its last activity, is honestly "ended without an outcome"', async () => {
    const { BuildDiagnostics } = await import('../src/server/AgentV3/BuildDiagnostics');
    let now = 0;
    const diag = new BuildDiagnostics({ model: 'm', framework: 'vite-react', now: () => now });
    now = 1_000;
    diag.record({ phase: 'build', severity: 'error', code: 'SANDBOX_CMD_FAILED', message: '$ tsc → exit 2', autoResolved: false });
    now = 1_000 + STILL_RUNNING_WINDOW_MS + 10_000;
    const report = diag.report();
    expect(report.rootCause).toMatch(/ended without recording an outcome/i);
    expect(report.rootCause).not.toMatch(/STILL RUNNING/);
  });

  it('a build that FINISHED is never called still-running, however recent its last event', async () => {
    const { BuildDiagnostics } = await import('../src/server/AgentV3/BuildDiagnostics');
    let now = 0;
    const diag = new BuildDiagnostics({ model: 'm', framework: 'vite-react', now: () => now });
    now = 1_000;
    diag.record({ phase: 'build', severity: 'info', code: 'EVENT', message: 'done', autoResolved: true });
    diag.finish(true, 'all good');
    now = 2_000;
    const report = diag.report();
    expect(report.rootCause).not.toMatch(/STILL RUNNING/);
    expect(report.endedAt).toBe(1_000);
  });
});
