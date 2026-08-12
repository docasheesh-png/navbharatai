import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTestOutcome, reportedNoTestResults } from './testRunner';
import { BuildDiagnostics, isRecoverableOnSuccess } from './BuildDiagnostics';

/**
 * FOUR THINGS THE 2026-08-12 REPORT SAID THAT WERE NOT TRUE.
 *
 * None of them broke an app. All of them told the admin something false about one — which is the same
 * class of harm, because a report that is wrong in small ways is a report nobody reads carefully, and
 * then the one that matters goes unread too.
 */

describe('a recovered preview failure is not a successful build\'s root cause', () => {
  it('PREVIEW_NOT_RENDERED is forgiven when the build ultimately succeeded', () => {
    // The real report: the preview went down mid-build, was restarted, was then verified rendering by a
    // real browser — and "nothing is listening on that port" was still printed as the ROOT CAUSE.
    expect(isRecoverableOnSuccess('PREVIEW_NOT_RENDERED')).toBe(true);
  });

  it('the TERMINAL preview failure is NOT forgiven — those are different findings', () => {
    // OUTCOME_PREVIEW_FAILED means the heal budget was spent and it still did not render. Forgiving
    // that would turn a genuinely broken preview into a clean report.
    expect(isRecoverableOnSuccess('OUTCOME_PREVIEW_FAILED')).toBe(false);
  });

  it('on a FAILED build it stays unresolved — success is what earns the forgiveness', () => {
    const d = new BuildDiagnostics({});
    d.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: 'closed port', autoResolved: false });
    d.finish(false);
    expect(d.report().issues.find((i) => i.code === 'PREVIEW_NOT_RENDERED')?.autoResolved).toBe(false);
  });

  it('on a SUCCESSFUL build it is resolved and cannot be the root cause', () => {
    const d = new BuildDiagnostics({});
    d.record({ phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: 'closed port', autoResolved: false });
    d.finish(true, 'The app is built and the preview renders.');
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'PREVIEW_NOT_RENDERED')?.autoResolved).toBe(true);
    expect(r.rootCause ?? '').not.toContain('closed port');
  });
});

describe('a bare FAIL with no evidence must say what it cannot rule out', () => {
  const vitest = { framework: 'vitest' as const, command: 'npx vitest run', reason: 'x' };

  it('THE VERDICT DOES NOT CHANGE — a failure stays a failure', () => {
    // My first attempt made "no tally" mean "could not run". The existing suite rejected it for a
    // better reason than the one I had: hiding genuinely failing tests behind a reassuring
    // "unverified" is the opposite mistake and a more damaging one.
    const o = parseTestOutcome(vitest, 1, 'something went wrong', '');
    expect(o.ran).toBe(true);
    expect(o.ok).toBe(false);
  });

  it('but it now admits it cannot tell a failing test from a dead runner', () => {
    // The real defect in `playwright: FAIL (exit=1)` was never the verdict — it was the silence.
    const o = parseTestOutcome(vitest, 1, 'something went wrong', '');
    expect(o.summary).toContain('reported no test results');
    expect(o.summary).toContain('failing to start');
  });

  it('a run WITH counts says nothing extra — no noise on a clear result', () => {
    const o = parseTestOutcome(vitest, 1, 'Tests  2 failed | 5 passed (7)', '');
    expect(o.summary).toContain('FAIL');
    expect(o.summary).not.toContain('reported no test results');
  });

  it('a PASSING run is never annotated', () => {
    expect(parseTestOutcome(vitest, 0, 'Tests  5 passed (5)', '').summary).not.toContain('reported no test results');
  });

  it('an explicit infra signature still downgrades, and says more', () => {
    const o = parseTestOutcome(vitest, 1, "Executable doesn't exist at /root/.cache/ms-playwright", '');
    expect(o.ran).toBe(false);
    expect(o.summary).toContain('COULD NOT RUN');
  });

  it('reportedNoTestResults reads a tally in every runner\'s dialect', () => {
    for (const out of ['2 passed, 1 failed', 'Tests: 3 failed, 5 passed', '1 passing', '4/7 tests passed']) {
      expect(reportedNoTestResults(out), out).toBe(false);
    }
    expect(reportedNoTestResults('Error: boom')).toBe(true);
  });
});

describe('the build says how long it waited before it started thinking', () => {
  it('records the gap on the first model call', () => {
    // 227 seconds of that build happened before the first call, with heartbeats saying "still working"
    // and SETUP_TIMING claiming "Workspace ready in 0s".
    let now = 1_000_000;
    const d = new BuildDiagnostics({});
    (d as unknown as { now: () => number }).now = () => now;
    (d as unknown as { startedAt: number }).startedAt = now;
    now += 227_000;
    d.recordLlmCall({ model: 'x', promptChars: 1, responseChars: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, ok: true } as never);
    const issue = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(issue?.message).toContain('227s');
    expect(issue?.severity).toBe('warning');
  });

  it('a quick start is recorded too, quietly — the number nobody records is the one that grows', () => {
    let now = 1_000_000;
    const d = new BuildDiagnostics({});
    (d as unknown as { now: () => number }).now = () => now;
    (d as unknown as { startedAt: number }).startedAt = now;
    now += 8_000;
    d.recordLlmCall({ model: 'x', promptChars: 1, responseChars: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, ok: true } as never);
    const issue = d.report().issues.find((i) => i.code === 'TIME_TO_FIRST_CALL');
    expect(issue?.severity).toBe('info');
    expect(issue?.autoResolved).toBe(true);
  });

  it('it is recorded ONCE, not on every call', () => {
    const d = new BuildDiagnostics({});
    for (let i = 0; i < 5; i += 1) {
      d.recordLlmCall({ model: 'x', promptChars: 1, responseChars: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1, ok: true } as never);
    }
    expect(d.report().issues.filter((i) => i.code === 'TIME_TO_FIRST_CALL')).toHaveLength(1);
  });
});

describe('the E2E decision judges the project, not this turn\'s writes', () => {
  const routes = readFileSync(join(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('it loads the real project before deciding', () => {
    // An edit build that wrote one `.env` was judged on that one file and skipped with the reason
    // "this project has no user interface for a browser to load" — for a React app. The decision was
    // arguably right; the REASON was false, which is worse, because it tells the user something untrue
    // about their own app.
    expect(routes).toContain('const projectFiles = await loadWorkspaceFiles(workspaceId)');
    expect(routes).toContain('{ ...projectFiles, ...Object.fromEntries(writtenFiles) }');
  });
});
