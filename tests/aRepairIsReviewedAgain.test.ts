// A REPAIR IS REVIEWED AGAIN BEFORE IT IS CALLED A FIX (admin 2026-10-11, Q-157: "one more review after an
// auto-fix, only when the fix was applied").
//
// The C9 pass repairs the reviewer's [CRITICAL] findings. When it COMPLETED, the build cleared them and
// shipped as fixed — "a future slice could re-review", said the code. THE CLASS: a fix declared done because
// it ran. Now the reviewer looks once more, only after an applied fix; what it still finds keeps the build
// honestly not-ok; a look that gives no verdict is said, never read as clean or as broken, and is left out
// of the bill on its own phase.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { reviewCriticals, postFixRecheckBudgetMs, postFixRecheckOutcome, RECHECK_MIN_HEADROOM_MS } from '../src/server/AgentV3/postFixReview';
import { absorbedWorkDetail } from '../src/server/AgentV3/unbilledTurns';
import { PHASE_POST_FIX_REVIEW } from '../src/server/AgentV3/billingPhase';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import { PROCESS_ONLY_CODES, isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';

const review = (issues: Array<{ severity: 'critical' | 'warning' | 'suggestion'; message: string }>, score = 80) =>
  ({ passed: !issues.some((i) => i.severity === 'critical'), score, issues, summary: '' });

describe('what the second look decides', () => {
  it('🔒 criticals the repair left behind keep the build not-ok', () => {
    const out = postFixRecheckOutcome(review([{ severity: 'critical', message: 'The Add button still does nothing' }, { severity: 'warning', message: 'w' }]));
    expect(out.unresolved).toEqual(['The Add button still does nothing']);
    expect(out.code).toBe('REVIEW_RECHECK_CRITICALS_REMAIN');
    expect(out.severity).toBe('warning');
  });

  it('a clean second look confirms the repair', () => {
    const out = postFixRecheckOutcome(review([{ severity: 'warning', message: 'spacing' }]));
    expect(out.unresolved).toEqual([]);
    expect(out.code).toBe('REVIEW_RECHECK_CLEAN');
  });

  it('🔒 no verdict is never clean and never broken — the repair stands, and the report says it was not re-checked', () => {
    for (const r of [null, undefined, review([], 0)]) {
      const out = postFixRecheckOutcome(r, 'it ran out of time');
      expect(out.unresolved).toBeNull();
      expect(out.code).toBe('REVIEW_RECHECK_NOT_RUN');
      expect(out.message).toContain('not reviewed again (it ran out of time)');
    }
  });

  it('the second look only runs when the build has room for a real review', () => {
    expect(postFixRecheckBudgetMs(10, RECHECK_MIN_HEADROOM_MS - 1)).toBe(0);
    expect(postFixRecheckBudgetMs(10, RECHECK_MIN_HEADROOM_MS)).toBeGreaterThan(0);
    expect(postFixRecheckBudgetMs(10, Infinity)).toBeGreaterThan(0);
  });

  it('reads criticals the way the first review does', () => {
    expect(reviewCriticals(review([{ severity: 'critical', message: '  x  ' }, { severity: 'critical', message: ' ' }]))).toEqual(['x']);
  });

  it('🔒 what is still broken is the user\'s app, with a button that carries the findings', () => {
    const out = postFixRecheckOutcome(review([{ severity: 'critical', message: 'The Add button still does nothing' }]));
    expect(PROCESS_ONLY_CODES.has(out.code)).toBe(false);
    expect(isAppFinding({ phase: 'build', code: out.code })).toBe(true);
    const [offer] = buildFindingSuggestions([{ code: out.code, severity: out.severity, autoResolved: out.autoResolved, message: out.message }]);
    expect(offer?.id).toBe('found-review-recheck-criticals-remain');
    expect(offer?.prompt).toContain('The Add button still does nothing');
    // a clean look or no look offers nothing
    for (const r of [review([]), null]) {
      const o = postFixRecheckOutcome(r);
      expect(buildFindingSuggestions([{ code: o.code, severity: o.severity, autoResolved: o.autoResolved, message: o.message }])).toEqual([]);
    }
  });

  it('a look with no verdict is named in the bill\'s explanation on its own', () => {
    expect(absorbedWorkDetail([{ provider: 'GLM', phase: PHASE_POST_FIX_REVIEW, usage: { inputTokens: 10, outputTokens: 1 } }], new Set([PHASE_POST_FIX_REVIEW])))
      .toContain('the review after a repair gave no verdict');
  });
});

describe('🔒 the wiring', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  // Anchor updated 2026-10-13 (autopsy 9c612cdb): the repair now runs inside its named pass, `reviewer-autofix`,
  // so its writes are attributed to it instead of to the build loop. The region this test reads is unchanged.
  const loop = route.slice(route.indexOf("const fix = await raceTimeout(runInPass('reviewer-autofix', () => critFixRunner.run(judgeRepairPrompt(prompt, autoFixItems)))"), route.indexOf("if (fixOk || abort.signal.aborted || !reviewerFixShouldRetry("));

  it('only after an applied fix, with its own abort, spawn and billing phase', () => {
    expect(loop).toContain('if (fix.ok && !abort.signal.aborted) {');
    expect(loop).toContain('runInBillingPhase(PHASE_POST_FIX_REVIEW, async () => reviewBuild({');
    expect(loop).toContain('spawn: makeSubAgentSpawn({ ...subAgentDeps, signal: recheckAbort.signal');
    expect(loop).toContain('if (recheck.unresolved) reviewCriticalsUnresolved = recheck.unresolved;');
    expect(loop).toContain('else if (recheckBudget > 0) barrenPhases.add(PHASE_POST_FIX_REVIEW);');
  });

  it('one look, never a loop — no repair runs after it', () => {
    const after = loop.slice(loop.indexOf('const recheck = postFixRecheckOutcome('));
    expect(after).not.toContain('critFixRunner.run(');
  });
});
