import { describe, it, expect } from 'vitest';
import { isAdvisoryCapOutcome, textIsAdvisoryCap, ADVISORY_CAP_CODE } from '../src/server/AgentV3/advisoryCapOutcome';
import { deriveRootCause } from '../src/server/AgentV3/BuildDiagnostics';
import { classifyFailure } from '../src/server/lib/BuildRetrospectiveEngine';
import { classifyFailureReason } from '../src/server/lib/buildFailureCategory';

/**
 * THE REPORT (admin 2026-09-17, build `af3a3f7f`, user rajeshkumar00077890@).
 *
 * A build that SUCCEEDED on every measure — `ok: true`, opened in a real browser and rendered,
 * `vitest 6/6 PASS`, `PROD_BUILD_OK`, `GREEN_GUARD_SAVE` — recorded this as its ROOT CAUSE:
 *
 *   "Build outcome: STOPPED — the app was built; the post-build advisory pass was cut short by its
 *    2-minute cap."
 *
 * Nothing stopped. `ADVISORY_CAP_MS` is a designed ceiling on the OPTIONAL post-build extras, so
 * reaching it is the system working. One code carried two opposite meanings, and all three readers
 * got it wrong in their own way.
 */
const ADVISORY = 'Build outcome: STOPPED — the app was built; the post-build advisory pass was cut short by its 2-minute cap.';
const WATCHDOG = 'Build outcome: STOPPED — the wall-clock cap (30 min) was reached before the build converged. NOT stopped by the user.';

const issue = (code: string, message: string, severity: 'info' | 'warning' | 'error' = 'warning') =>
  ({ code, message, severity, phase: 'build', autoResolved: false } as never);

describe('isAdvisoryCapOutcome — telling a built app from a build that never converged', () => {
  it('recognises the NEW dedicated code', () => {
    expect(isAdvisoryCapOutcome({ code: ADVISORY_CAP_CODE, message: ADVISORY })).toBe(true);
  });

  it('recognises the LEGACY shape — every build recorded before the split carries it', () => {
    // This is most of the data the admin's panels read, so a fix that only knew the new code would
    // leave nearly every past build still mislabelled.
    expect(isAdvisoryCapOutcome({ code: 'OUTCOME_STOPPED', message: ADVISORY })).toBe(true);
  });

  it('🔒 NEVER mistakes the REAL wall-clock stop for it — that would hide a genuine failure', () => {
    expect(isAdvisoryCapOutcome({ code: 'OUTCOME_STOPPED', message: WATCHDOG })).toBe(false);
    expect(textIsAdvisoryCap(WATCHDOG)).toBe(false);
  });

  it('an unrecognised shape is NOT an advisory cap — unknown must keep today’s behaviour', () => {
    for (const bad of [null, undefined, {}, { code: 'OUTCOME_STOPPED' }, { code: 'OUTCOME_BUILD_TIMEOUT', message: ADVISORY }]) {
      expect(isAdvisoryCapOutcome(bad as never)).toBe(false);
    }
  });
});

describe('deriveRootCause — a successful build has no root cause', () => {
  it('THE BUG: a successful build no longer reports "STOPPED"', () => {
    const rc = deriveRootCause({ ok: true, issues: [issue('OUTCOME_STOPPED', ADVISORY)] });
    expect(rc).toBeUndefined();
  });

  it('🔴 AND IT DOES NOT FALL THROUGH TO A PROVIDER WARNING — the trap this fix had to avoid', () => {
    // Skipping the outcome naively would hand the same successful build the most severe remaining
    // warning. On the real report that was `Provider GLM failed` — the exact provider-error-as-app-
    // blocker class autopsy 4efab9d7 closed. If this ever regresses, the verdict gets WORSE, not
    // merely unchanged, which is why it is asserted explicitly.
    const rc = deriveRootCause({
      ok: true,
      issues: [
        issue('PROVIDER_FALLBACK', 'Provider GLM failed — falling back to the next provider'),
        issue('DEPENDENCY_VULNERABILITIES', '6 known vulnerabilities in this app’s dependencies'),
        issue('OUTCOME_STOPPED', ADVISORY),
      ],
    });
    expect(rc).toBeUndefined();
  });

  it('a build that did NOT succeed still gets an explanation — we owe it one', () => {
    const rc = deriveRootCause({
      ok: false,
      issues: [issue('SANDBOX_CMD_FAILED', '$ npm run build → exit 1', 'error'), issue('OUTCOME_STOPPED', ADVISORY)],
    });
    expect(rc).toBeTruthy();
    expect(rc).not.toContain('advisory');
  });

  it('the REAL wall-clock stop is still the root cause, unchanged', () => {
    expect(deriveRootCause({ ok: false, issues: [issue('OUTCOME_STOPPED', WATCHDOG, 'error')] })).toBe(WATCHDOG);
  });

  it('a real outcome beside the advisory cap still wins', () => {
    const rc = deriveRootCause({
      ok: true,
      issues: [issue('OUTCOME_ADVISORY_CAPPED', ADVISORY), issue('OUTCOME_BUILD_SUCCESS', 'Build outcome: SUCCESS')],
    });
    expect(rc).toBe('Build outcome: SUCCESS');
  });
});

describe('the other two readers stop calling a built app broken', () => {
  it('the retrospective no longer files it as "incomplete"', () => {
    for (const code of ['OUTCOME_STOPPED', ADVISORY_CAP_CODE]) {
      const v = classifyFailure(ADVISORY, code);
      expect(v.category).not.toBe('incomplete');
      expect(v.hint.toLowerCase()).toContain('not a failure');
    }
    // …while the genuine stop keeps its correct category.
    expect(classifyFailure(WATCHDOG, 'OUTCOME_STOPPED').category).toBe('incomplete');
  });

  it('the admin failure panel names it instead of dumping it in "Other"', () => {
    // This panel only ever sees the PROSE — listAllDiagnostics drops the codes — so the text form is
    // the only thing it can use.
    expect(classifyFailureReason(ADVISORY).key).toBe('advisory-cap');
    expect(classifyFailureReason(ADVISORY).label.toLowerCase()).toContain('not a failure');
    // The real stop must NOT be absorbed into the same bucket.
    expect(classifyFailureReason(WATCHDOG).key).not.toBe('advisory-cap');
  });
});
