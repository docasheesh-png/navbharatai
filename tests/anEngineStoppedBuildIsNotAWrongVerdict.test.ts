// ADMIN PANEL COPY 2026-11-17 (Builds · Reports) — the numbers on the page, used as the fixture:
//   500 builds examined · 3 in progress · 37 stopped by the user · 402 succeeded · 14 "genuinely failed" (never seen
//   running) · 44 "worked, called failed" (rendered) · "User got a working app 97%" (target 90%) · "What we told them 87.4%"
//   · "Overall failure rate 12.6% of 497 settled builds".
//
// P1  "Worked, called failed" counted a build as a WRONG VERDICT whenever an app rendered. But a render is not a delivery:
//     on an edit it is the previous version, and a build the engine abandoned half-way renders too (autopsy 57604006,
//     build 9ed80cc9). 21 of the page's 58 failures carry an engine / sandbox / account / cap code. They earned delivered
//     credit and lifted the headline to 97% — a target hit by counting a guess.
// P2  "of 497 settled builds": 58 ÷ 497 = 11.7%. The 12.6% is 58 ÷ 460 — the 37 the user stopped are left out of the rate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { categorizeBuildFailures, WORK_STOPPED_OUTCOME_CODES, type CategorizableBuild } from '../src/server/lib/buildFailureCategory';
import { OUTCOME_REASONS } from '../src/lib/failureReason';

let n = 0;
const mk = (over: Partial<CategorizableBuild>): CategorizableBuild => ({ workspaceId: `ws${n++}`, ok: false, prompt: 'an app', outcomeCode: 'OUTCOME_UNEXPLAINED', outcomeSeverity: 'error', appSeenRunning: true, ...over });
const many = (count: number, over: Partial<CategorizableBuild>) => Array.from({ length: count }, () => mk(over));

/** The page, build for build. The reasons are the page's own (8 engine, 7 sandbox, 3 ownership, 3 cost ceiling…). */
function pageFixture(): CategorizableBuild[] {
  return [
    ...many(402, { ok: true, outcomeCode: 'OUTCOME_BUILD_SUCCESS', appSeenRunning: true }),
    ...many(14, { appSeenRunning: false }),                                                       // genuinely failed
    ...many(8, { outcomeCode: 'OUTCOME_ENGINE_UNAVAILABLE' }),                                     // rendered, work stopped…
    ...many(7, { outcomeCode: 'OUTCOME_SANDBOX_UNAVAILABLE' }),
    ...many(3, { outcomeCode: 'OUTCOME_AUTHORITY_UNAVAILABLE' }),
    ...many(3, { outcomeCode: 'OUTCOME_COST_CEILING' }),                                           // …21 in all
    ...many(10, { outcomeCode: 'OUTCOME_RELEASE_GATE_RED' }),                                      // rendered, a content verdict
    ...many(13, { outcomeCode: 'OUTCOME_UNEXPLAINED' }),                                           // …23 in all
    ...many(37, { outcomeCode: 'OUTCOME_USER_STOPPED', userStopped: true }),
    ...many(3, { ok: null, outcomeCode: null, appSeenRunning: null }),                             // still running
  ];
}

describe('P1 · an app that rendered is not proof the request was delivered', () => {
  it('🔴 the page, reproduced: 44 rendered failures split into 23 contradicted verdicts and 21 whose work an external condition stopped', () => {
    const r = categorizeBuildFailures(pageFixture());
    expect(r.totalBuilds).toBe(500);
    expect(r.verdictSplit).toMatchObject({ succeeded: 402, engineFailed: 14, builtButJudgedFailed: 23, renderedButUnfinished: 21, userStopped: 37, unjudged: 3, evidenceUnknown: 0 });
  });
  it('🔴 the headline no longer takes credit for them: 92.4%, not 97%; what we told them is still 87.4%', () => {
    const v = categorizeBuildFailures(pageFixture()).verdictSplit;
    expect(v.reportedOkPct).toBe(87.4);  // matches the page — the fixture is the page
    expect(v.appDeliveredPct).toBe(92.4); // (402 + 23) ÷ (402 + 14 + 23 + 21)
    // …and what the old rule said, so the test says what it changes:
    expect(Math.round(((402 + 44) / (402 + 14 + 44)) * 1000) / 10).toBe(97);
  });
  it('a stopped build stays in the denominator: no credit is not the same as no build', () => {
    const v = categorizeBuildFailures([mk({ ok: true }), mk({ outcomeCode: 'OUTCOME_ENGINE_UNAVAILABLE' })]).verdictSplit;
    expect(v.appDeliveredPct).toBe(50);
    expect(v.reportedOkPct).toBe(50);
  });
  it('the earlier autopsies\' wrong-verdict cases are unchanged: a PARTIAL or gate-RED build whose app rendered is still a wrong verdict', () => {
    for (const code of ['OUTCOME_BUILD_PARTIAL', 'OUTCOME_RELEASE_GATE_RED', 'OUTCOME_STOPPED', 'OUTCOME_BUILD_TIMEOUT', 'OUTCOME_UNEXPLAINED']) {
      const v = categorizeBuildFailures([mk({ outcomeCode: code })]).verdictSplit;
      expect(v.builtButJudgedFailed, code).toBe(1);
      expect(v.renderedButUnfinished, code).toBe(0);
    }
  });
  it('a failure with no render evidence, or none at all, is where it always was', () => {
    const v = categorizeBuildFailures([mk({ outcomeCode: 'OUTCOME_ENGINE_UNAVAILABLE', appSeenRunning: false }), mk({ outcomeCode: 'OUTCOME_ENGINE_UNAVAILABLE', appSeenRunning: null })]).verdictSplit;
    expect(v).toMatchObject({ engineFailed: 1, evidenceUnknown: 1, renderedButUnfinished: 0, builtButJudgedFailed: 0 });
  });
  it('every failure lands in exactly one bucket — the split still reconciles with the headline', () => {
    const r = categorizeBuildFailures(pageFixture());
    const v = r.verdictSplit;
    expect(v.engineFailed + v.builtButJudgedFailed + v.renderedButUnfinished + v.evidenceUnknown).toBe(r.failed);
    expect(v.engineFailed + v.builtButJudgedFailed + v.renderedButUnfinished + v.evidenceUnknown + v.succeeded + v.unjudged + v.userStopped).toBe(r.totalBuilds);
  });
  it('🔒 census: the codes are real outcome codes, and none of them is a verdict about the app\'s own content', () => {
    for (const code of WORK_STOPPED_OUTCOME_CODES) expect(OUTCOME_REASONS[code], `${code} is not a known outcome code`).toBeTruthy();
    for (const content of ['OUTCOME_BUILD_PARTIAL', 'OUTCOME_RELEASE_GATE_RED', 'OUTCOME_TYPECHECK_FAILED', 'OUTCOME_SYNTAX_ERROR', 'OUTCOME_MISSING_FILES', 'OUTCOME_PREVIEW_FAILED', 'OUTCOME_REVIEW_CRITICAL', 'OUTCOME_UNEXPLAINED', 'OUTCOME_USER_STOPPED']) {
      expect(WORK_STOPPED_OUTCOME_CODES.has(content), content).toBe(false);
    }
  });
});

describe('P2 · the failure rate and the words beside it name the same denominator', () => {
  it('🔴 58 failed of 460 judged is 12.6% — and 497 is not what it is a rate of', () => {
    const r = categorizeBuildFailures(pageFixture());
    expect(r.failed).toBe(58);
    expect(r.ok + r.failed).toBe(460);
    expect(r.overallFailureRatePct).toBe(12.6);
    expect(Math.round((58 / 497) * 1000) / 10).toBe(11.7);
    expect(r.totalBuilds - r.unjudged).toBe(497); // the number the card used to print
  });
  const card = readFileSync('src/components/admin/FailureCategoryCard.tsx', 'utf8');
  it('the card divides by the judged builds, says so, and shows the new line', () => {
    expect(card).toContain('judgedBuilds');
    expect(card).toMatch(/of \$\{judgedBuilds\} judged builds/);
    expect(card).not.toMatch(/of \$\{total - \(data\.unjudged \?\? 0\)\} settled builds/);
    expect(card).toContain('Rendered, work stopped');
    expect(card).toContain('NOT counted as a delivered app');
  });
});
