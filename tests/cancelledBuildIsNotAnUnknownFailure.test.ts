/**
 * REPORT cc8c9075 (2026-09-17) — the build the user STOPPED, filed as a failure with an unknown cause.
 *
 * That report's `rootCause` read: *"This build did not succeed, but 3 unresolved item(s) WERE recorded,
 * but none of them can name a cause … so why it failed is not known from this report."*
 *
 * The same document carried the engine's own sentence — *"user stopped the build with files saved …
 * charged half the work done"* — and the user-facing summary *"Stopped, as you asked."* Three
 * statements of the stop, and the field an autopsy reads FIRST said the cause was unknown.
 *
 * 🔑 THE CLASS: one fact written under TWO codes, and the reader knew only one. `USER_STOPPED_BUILD`
 * comes from the /stop ROUTE (a separate request, against a different in-flight diag — on that report
 * it never landed). `CANCELLED_BUILD_CHARGED` comes from the BUILD'S OWN settle path, and
 * `decideCancelledBuildBill` returns `applies: true` for nothing but `abortCause === 'user-stop'`.
 */
import { describe, it, expect } from 'vitest';
import { stoppedByUser, deriveRootCause } from '../src/server/AgentV3/BuildDiagnostics';
import { decideCancelledBuildBill } from '../src/server/AgentV3/cancelledBuildBilling';

const issue = (code: string, message: string, severity = 'info') =>
  ({ ts: 1, phase: 'build', severity, code, message, autoResolved: true }) as never;

describe('a build the user stopped is never an unexplained failure', () => {
  it('the settle path’s own record counts as proof of the stop', () => {
    expect(stoppedByUser([
      issue('CANCELLED_BUILD_CHARGED',
        'user stopped the build with files saved but no app verified running — charged half the work done (discount 50%, delivery: files-saved).'),
    ])).toBe(true);
  });

  it('THE REPORTED ROOT CAUSE now names the stop instead of calling it unknown', () => {
    const cause = deriveRootCause({
      ok: false,
      issues: [
        issue('PROVIDER_FALLBACK', 'Provider GLM failed — falling back to the next provider', 'warning'),
        issue('DESIGN_CONSISTENCY', 'Design consistency 96/100 (A) across 8 file(s).', 'warning'),
        issue('CANCELLED_BUILD_CHARGED',
          'user stopped the build with files saved but no app verified running — charged half the work done (discount 50%, delivery: files-saved).'),
      ],
    });
    expect(cause).toMatch(/USER stopped this build/i);
    expect(cause, 'an autopsy must not be sent hunting a failure that never happened')
      .not.toMatch(/why it failed is not known/i);
  });

  it('the older route-written code still works — this widens the reader, it does not replace it', () => {
    expect(stoppedByUser([issue('USER_STOPPED_BUILD', 'The user asked for this build to stop, and it was stopped.')])).toBe(true);
  });

  it('🔒 AN ENGINE STOP IS STILL NOT A USER STOP', () => {
    expect(stoppedByUser([
      issue('USER_STOPPED_BUILD',
        'The build was stopped by the engine while working on a request NavBharatAI itself composed — not by the user.'),
    ])).toBe(false);
    expect(stoppedByUser([issue('OUTCOME_STOPPED', 'the post-build advisory pass was cut short')])).toBe(false);
    expect(stoppedByUser([])).toBe(false);
  });

  it('🔒 WHY THE SETTLE CODE IS PROOF: it cannot be recorded for a non-user cancel', () => {
    // CANCELLED_BUILD_CHARGED is only written when `applies` is true, and only a user stop earns that.
    for (const abortCause of ['budget', 'cost-cap', 'deadline', 'error'] as const) {
      const bill = decideCancelledBuildBill({
        abortCause: abortCause as never,
        filesWritten: 3, preseededUnchanged: 0, appRendered: false, decidedBilledUsd: 1,
      });
      expect(bill.applies, abortCause).toBe(false);
    }
    expect(decideCancelledBuildBill({
      abortCause: 'user-stop', filesWritten: 3, preseededUnchanged: 0, appRendered: false, decidedBilledUsd: 1,
    }).applies).toBe(true);
  });
});
