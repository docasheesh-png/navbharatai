import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyFailureReason, categorizeBuildFailures } from '../src/server/lib/buildFailureCategory';
import { OUTCOME_TO_CATEGORY } from '../src/server/lib/BuildRetrospectiveEngine';
import { severityOfOutcome, outcomeCodeOf } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * PHASE 0 — THE PANEL MUST NAME ITS OWN FAILURES (admin 2026-09-17).
 *
 * The admin's Failure Category panel showed 385 projects, 151 failures, 40.8% — and "Other (not yet in
 * the known pattern list)" as the top reason for THIRTEEN OF FIFTEEN app types, 92 of 107 in its biggest
 * row. ~85% of failures had no named cause, so every fix planned from that panel would have been a guess.
 *
 * The cause: it read the PROSE of `rootCause` for compiler words. v5 does not fail with compiler words.
 * `BuildRetrospectiveEngine.ts` had root-caused this on 2026-09-12 — *"the diagnostic CODE is a machine
 * fact… reading it is not pattern matching, it is just looking"* — and this panel never read the code,
 * even though the query already had it in memory.
 */

/** Verbatim messages a real build records — the ones that produced the "Other" flood. */
const REAL_MESSAGES: Record<string, string> = {
  OUTCOME_STOPPED: 'Build outcome: STOPPED — the wall-clock cap (30 min) was reached before the build converged. NOT stopped by the user.',
  OUTCOME_MISSING_FILES: 'After one creation pass, 3 local module(s) are STILL missing',
  OUTCOME_PREVIEW_COMPILE: 'The live in-browser preview does not compile',
  OUTCOME_BUILD_PARTIAL: 'Build outcome: PARTIAL — the build stopped part-way.',
  OUTCOME_RELEASE_GATE_RED: 'Release gate: RED',
};
const ADVISORY = 'Build outcome: STOPPED — the app was built; the post-build advisory pass was cut short by its 2-minute cap.';

describe('the code is read before the prose', () => {
  it('THE BUG: messages that ALL returned "other" are now named', () => {
    // Proven before the fix: every one of these classified as `other` by text alone.
    for (const [code, message] of Object.entries(REAL_MESSAGES)) {
      const byTextOnly = classifyFailureReason(message);
      const byCode = classifyFailureReason(message, code, 'error');
      expect(byTextOnly.key, `${code} should have been unnamed by text alone`).toBe('other');
      expect(byCode.key, `${code} must be named once the code is read`).not.toBe('other');
      expect(byCode.label.length).toBeGreaterThan(0);
    }
  });

  it('🔴 SEVERITY RIDES WITH THE CODE — otherwise a built app is filed as a stop', () => {
    // The trap: OUTCOME_STOPPED means opposite things at `warning` and at `error`. Classifying on the
    // code alone would file every advisory-capped (successful) build as "the run ended before it
    // finished" — trading one wrong answer for another.
    expect(classifyFailureReason(ADVISORY, 'OUTCOME_STOPPED', 'warning').key).toBe('advisory-cap');
    expect(classifyFailureReason(REAL_MESSAGES.OUTCOME_STOPPED, 'OUTCOME_STOPPED', 'error').key).toBe('stopped');
  });

  it('an UNRECOGNISED code falls through to the text, exactly as before', () => {
    // A code added later must never be silently mis-filed — it classifies as it used to.
    const v = classifyFailureReason('$ tsc --noEmit → exit 1', 'OUTCOME_SOMETHING_NEW', 'error');
    expect(v.key).toBe('typecheck-failed');
  });

  it('no code at all still works — imported projects and legacy records have none', () => {
    expect(classifyFailureReason('module not found: ./x').key).toBe('dependency-error');
    expect(classifyFailureReason('').key).toBe('no-root-cause');
    expect(classifyFailureReason(null, null, null).key).toBe('no-root-cause');
  });
});

describe('the projection that makes it possible', () => {
  const issues = [
    { code: 'TOOL_DONE', severity: 'info' },
    { code: 'OUTCOME_STOPPED', severity: 'warning' },
  ];
  it('reads the LAST outcome and its severity together', () => {
    expect(outcomeCodeOf(issues)).toBe('OUTCOME_STOPPED');
    expect(severityOfOutcome(issues)).toBe('warning');
  });
  it('a build with no outcome yields neither, rather than a wrong one', () => {
    expect(outcomeCodeOf([{ code: 'TOOL_DONE' }])).toBe('');
    expect(severityOfOutcome([{ code: 'TOOL_DONE' }])).toBeNull();
    expect(severityOfOutcome(null)).toBeNull();
  });
});

describe('end to end — the panel stops saying "Other"', () => {
  it('a realistic mix is named instead of bucketed', () => {
    const builds = Object.entries(REAL_MESSAGES).map(([code, rootCause], i) => ({
      workspaceId: `ws-${i}`, ok: false, prompt: 'build me a shop', rootCause,
      outcomeCode: code, outcomeSeverity: 'error',
    }));
    const report = categorizeBuildFailures(builds);
    expect(report.failed).toBe(builds.length);
    const other = report.byReason.find((r) => r.key === 'other');
    expect(other, 'nothing should land in Other once codes are read').toBeUndefined();
    expect(report.byReason.length).toBe(builds.length);
  });

  it('a successful advisory-capped build is NOT counted as a failure at all', () => {
    const report = categorizeBuildFailures([
      { workspaceId: 'ws-ok', ok: true, prompt: 'a game', rootCause: ADVISORY, outcomeCode: 'OUTCOME_STOPPED', outcomeSeverity: 'warning' },
    ]);
    expect(report.failed).toBe(0);
    expect(report.ok).toBe(1);
  });
});

describe('🔒 the drift guard — two maps that must not disagree', () => {
  it('every OUTCOME code the retrospective knows also has a panel label', () => {
    // Without this, a code added to one map and not the other silently reappears as "Other" — the exact
    // failure this phase exists to remove.
    const src = readFileSync(join(process.cwd(), 'src/server/lib/buildFailureCategory.ts'), 'utf8');
    for (const code of Object.keys(OUTCOME_TO_CATEGORY)) {
      // The advisory cap is deliberately NOT a failure reason; it has its own row.
      if (code === 'OUTCOME_ADVISORY_CAPPED') continue;
      expect(src, `${code} has no label on the admin panel`).toContain(`${code}:`);
    }
  });
});

/**
 * PHASE 1 — THE THREE POPULATIONS INSIDE ONE FAILURE RATE.
 *
 * "40.8% failed" cannot be worked on as one number: some of it is not broken builds. This repo has
 * TWICE shipped a verdict calling a working app broken (autopsies 697b38ee and 4efab9d7), and every
 * record written before those fixes keeps its old verdict — which is what the panel reads.
 */
describe('Phase 1 — a failure rate split into what can actually be fixed', () => {
  const build = (id: string, ok: boolean | null, seen: boolean | null | undefined) => ({
    workspaceId: id, ok, prompt: 'a shop app', rootCause: 'Build outcome: PARTIAL — the build stopped part-way.',
    outcomeCode: 'OUTCOME_BUILD_PARTIAL', outcomeSeverity: 'error', appSeenRunning: seen,
  });

  it('🔴 a build judged FAILED whose app was SEEN RUNNING is a wrong verdict, not a failure', () => {
    const r = categorizeBuildFailures([build('a', false, true), build('b', false, false)]);
    expect(r.verdictSplit.builtButJudgedFailed).toBe(1);
    expect(r.verdictSplit.engineFailed).toBe(1);
  });

  it('"we did not look" is never counted as "we looked and saw nothing"', () => {
    // A legacy record has no evidence field at all. Counting it as a genuine engine failure would
    // inflate the only number the 90% target is measured against.
    const r = categorizeBuildFailures([build('legacy', false, undefined), build('c', false, null)]);
    expect(r.verdictSplit.evidenceUnknown).toBe(2);
    expect(r.verdictSplit.engineFailed).toBe(0);
    expect(r.verdictSplit.builtButJudgedFailed).toBe(0);
  });

  it('every failure lands in exactly one bucket — the split must reconcile with the headline', () => {
    const rows = [build('a', false, true), build('b', false, false), build('c', false, undefined),
      build('d', true, true), build('e', null, null)];
    const r = categorizeBuildFailures(rows);
    const { engineFailed, builtButJudgedFailed, evidenceUnknown, succeeded, unjudged } = r.verdictSplit;
    expect(engineFailed + builtButJudgedFailed + evidenceUnknown).toBe(r.failed);
    expect(succeeded).toBe(r.ok);
    expect(unjudged).toBe(r.unjudged);
    expect(engineFailed + builtButJudgedFailed + evidenceUnknown + succeeded + unjudged).toBe(r.totalBuilds);
  });

  it('the admin card actually shows it — a split nobody can see changes nothing', () => {
    const card = readFileSync(join(process.cwd(), 'src/components/admin/FailureCategoryCard.tsx'), 'utf8');
    expect(card).toContain('verdictSplit');
    expect(card).toContain('Worked, called failed');
    // And it must say plainly what it still cannot separate, rather than implying the split is total.
    expect(card).toContain('Builds the USER stopped are not separated out yet');
  });
});

/**
 * PHASE 4 — ONE NUMBER, DEFINED ONCE, SO "90%" IS A FACT RATHER THAN A FEELING.
 */
describe('Phase 4 — the number the 90% target is measured against', () => {
  const b = (id: string, ok: boolean | null, seen: boolean | null) => ({
    workspaceId: id, ok, prompt: 'an app', rootCause: 'Build outcome: PARTIAL',
    outcomeCode: 'OUTCOME_BUILD_PARTIAL', outcomeSeverity: 'error', appSeenRunning: seen,
  });

  it('a build we WRONGLY called failed still counts as the user getting an app', () => {
    // 8 succeeded + 1 wrongly-failed = 9 people with a working app, out of 10 judgeable.
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => b(`ok${i}`, true, true)),
      b('wrong', false, true),
      b('real', false, false),
    ];
    const { appDeliveredPct, reportedOkPct } = categorizeBuildFailures(rows).verdictSplit;
    expect(appDeliveredPct).toBe(90);
    // …and what we TOLD them was 80%. The 10-point gap is the honesty debt.
    expect(reportedOkPct).toBe(80);
  });

  it('🔒 unknown-evidence builds are in NEITHER half — a target must not be hittable by counting unknowns', () => {
    const rows = [b('ok', true, true), b('real', false, false), b('legacy', false, null)];
    const v = categorizeBuildFailures(rows).verdictSplit;
    // Denominator is 2 (ok + engineFailed), not 3.
    expect(v.appDeliveredPct).toBe(50);
    expect(v.evidenceUnknown).toBe(1);
  });

  it('with nothing judgeable it is null, never a flattering 100%', () => {
    const v = categorizeBuildFailures([b('legacy', false, null)]).verdictSplit;
    expect(v.appDeliveredPct).toBeNull();
    expect(v.reportedOkPct).toBeNull();
  });

  it('the admin can SEE the target and the gap', () => {
    const card = readFileSync(join(process.cwd(), 'src/components/admin/FailureCategoryCard.tsx'), 'utf8');
    expect(card).toContain('User got a working app');
    expect(card).toContain('target 90%');
    expect(card).toContain('honesty debt');
  });
});
