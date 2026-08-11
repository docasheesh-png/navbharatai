import { describe, it, expect } from 'vitest';
import { runtimeUncheckedRecord } from '../src/server/AgentV3/AutoFix';
import { parseTestOutcome, testSuiteCouldNotRun } from '../src/server/AgentV3/testRunner';
import { deriveRootCause, isNeverRootCause } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * THREE WAYS THE SAME BUILD REPORT LIED (Shiv Medical Store, 2026-08-10 — ok:true, app verified
 * rendering, ₹566.96 charged). None of them broke an app; all of them make the report untrustworthy,
 * which is worse, because the report is how we learn what to fix next.
 */

describe('1. the report must not argue with itself about the runtime', () => {
  it('does not claim "no live preview session" for a build whose preview was verified rendering', () => {
    // The report simultaneously said "confirmed it loads successfully in a real browser with no
    // console errors" (summary + GREEN_GUARD_SAVE) and "the browser console could not be captured
    // (no live preview session)". Both cannot be true.
    const rec = runtimeUncheckedRecord({ previewRendered: true });
    expect(rec.message).not.toContain('no live preview session');
    expect(rec.message).toContain('WAS opened in a real browser and rendered');
  });

  it('still refuses to claim a clean console it never read', () => {
    // The honest half: does-it-run was answered, were-there-console-errors was not.
    const rec = runtimeUncheckedRecord({ previewRendered: true });
    expect(rec.message).toContain('not checked');
    expect(rec.message).toContain('Not a clean-console guarantee');
  });

  it('stops counting it as an unresolved defect once the app is proven to render', () => {
    expect(runtimeUncheckedRecord({ previewRendered: true }).autoResolved).toBe(true);
    expect(runtimeUncheckedRecord({ previewRendered: true }).severity).toBe('info');
  });

  it('is UNCHANGED when the preview really was never seen', () => {
    const rec = runtimeUncheckedRecord();
    expect(rec.severity).toBe('warning');
    expect(rec.autoResolved).toBe(false);
    expect(rec.message).toContain('Runtime was NOT verified');
  });
});

describe('2. a test suite that could not RUN is unverified, not failed', () => {
  const plan = { framework: 'playwright' as const, command: 'npx playwright test', reason: 'x' };

  it('recognises the exact sandbox failure from the report', () => {
    const out = "Executable doesn't exist at /home/user/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
    expect(testSuiteCouldNotRun(1, out)).toContain('Playwright browser binaries');

    const outcome = parseTestOutcome(plan, 1, out, '');
    expect(outcome.ran).toBe(false);
    expect(outcome.summary).toContain('COULD NOT RUN');
    expect(outcome.summary).toContain('not a defect in the app');
  });

  it('recognises the other unambiguous infrastructure failures', () => {
    expect(testSuiteCouldNotRun(1, 'npm ERR! Missing script: test')).toContain('no such test script');
    expect(testSuiteCouldNotRun(1, "Cannot find module 'vitest'")).toContain('runner itself is not installed');
    expect(testSuiteCouldNotRun(127, '')).toContain('does not exist in the sandbox');
    expect(testSuiteCouldNotRun(1, 'sh: vitest: command not found')).toContain('does not exist');
  });

  it('A REAL FAILING TEST IS STILL A FAILURE — the mislabel that would be worse than the bug', () => {
    // Hiding genuinely failing tests behind a reassuring "unverified" is the opposite mistake, and a
    // more damaging one. Only an explicit infra signature may downgrade a failure.
    const vitest = { framework: 'vitest' as const, command: 'npx vitest run', reason: 'x' };
    const outcome = parseTestOutcome(vitest, 1, 'Tests  2 failed | 5 passed (7)\n × renders the cart', '');
    expect(outcome.ran).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.summary).toContain('FAIL');
  });

  it('an unparseable failure is still a FAILURE, not "could not run"', () => {
    const vitest = { framework: 'vitest' as const, command: 'npx vitest run', reason: 'x' };
    const outcome = parseTestOutcome(vitest, 1, 'something went wrong', '');
    expect(outcome.ran).toBe(true);
    expect(outcome.ok).toBe(false);
  });

  it('a PASSING run is never downgraded, even if its output mentions an infra string', () => {
    const vitest = { framework: 'vitest' as const, command: 'npx vitest run', reason: 'x' };
    const outcome = parseTestOutcome(vitest, 0, 'Tests  5 passed (5)\nnote: npx playwright install is recommended', '');
    expect(outcome.ran).toBe(true);
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toContain('PASS');
  });
});

describe('3. an advisory hint can never be a build\'s root cause', () => {
  const advisory = {
    ts: 1, phase: 'build' as const, severity: 'warning' as const, code: 'INTEGRITY_UNUSED_DEP',
    autoResolved: false,
    message: '"@capacitor/android" is declared in package.json dependencies but no project file imports it.',
  };

  it('the reported case: a SUCCESSFUL build no longer blames a dependency hint', () => {
    const cause = deriveRootCause({ issues: [advisory], ok: true });
    expect(cause).toBe('Build completed successfully with no problems recorded.');
  });

  it('and not on a FAILED build either — it explains nothing there either', () => {
    const cause = deriveRootCause({ issues: [advisory], ok: false });
    expect(cause).not.toContain('@capacitor/android');
  });

  it('every advisory code is covered, including the ones added since', () => {
    for (const code of [
      'INTEGRITY_UNUSED_DEP', 'DEPHEALTH_ADVISORY', 'DESIGN_PAGE_INCONSISTENT',
      'TEST_SUITE_UNVERIFIED', 'REQUIREMENT_GAPS', 'POST_ANSWER_TIMING',
    ]) {
      expect(isNeverRootCause(code), code).toBe(true);
    }
  });

  it('A REAL PROBLEM STILL WINS — the guard must not silence genuine causes', () => {
    const real = {
      ts: 2, phase: 'build' as const, severity: 'error' as const, code: 'DB_UNREACHABLE',
      autoResolved: false, message: 'The database could not be reached.',
    };
    expect(deriveRootCause({ issues: [advisory, real], ok: false })).toContain('database could not be reached');
    expect(isNeverRootCause('DB_UNREACHABLE')).toBe(false);
  });

  it('an advisory alongside a real warning yields the real one', () => {
    const realWarn = {
      ts: 3, phase: 'preview' as const, severity: 'warning' as const, code: 'PREVIEW_NOT_RENDERED',
      autoResolved: false, message: 'nothing is listening on that port',
    };
    expect(deriveRootCause({ issues: [advisory, realWarn], ok: false })).toContain('nothing is listening');
  });
});
