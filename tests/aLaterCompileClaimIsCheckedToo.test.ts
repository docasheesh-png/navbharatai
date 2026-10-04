/**
 * AUTOPSY f496c75b (open since 2026-09-30): "This file will not compile" in a finding's SECOND
 * sentence survived a green typecheck, because only the first sentence was ever checked.
 *
 * With the compiler passed: a finding whose other sentences are all about how the code is typed or
 * wired is refuted whole; a finding that also says something about behaviour keeps that part and
 * loses only the refuted sentence; nothing changes when the compiler did not pass.
 */
import { describe, expect, it } from 'vitest';
import { laterCompileClaim, refuteReviewByEvidence } from '../src/server/AgentV3/reviewEvidence';
import type { ReviewResult } from '../src/server/AgentV3/ReviewerAgent';

const REAL = '[CRITICAL] src/game/types.ts imports the Element enum with `import type`, but uses it as a value. This file will not compile.';

describe('a compile claim later in a finding', () => {
  it('the autopsy finding is refuted whole', () => {
    expect(laterCompileClaim(REAL)).toBe('whole');
  });

  it('a behaviour point in the same finding stands, without the refuted sentence', () => {
    expect(laterCompileClaim('[CRITICAL] Pressing Save loses the score. The store imports a type that is wrong, so it will not compile.'))
      .toBe('[CRITICAL] Pressing Save loses the score.');
  });

  it('a finding with no compile claim, or one in its first sentence, is not this rule', () => {
    expect(laterCompileClaim('[WARNING] The list does not re-render after an edit. It works otherwise.')).toBeNull();
    expect(laterCompileClaim('TypeScript errors are present.')).toBeNull();
  });

  const review = (): ReviewResult => ({
    passed: false, score: 60, summary: 'One critical issue.',
    issues: [
      { severity: 'critical', message: REAL },
      { severity: 'warning', message: '[WARNING] Pressing Save loses the score. This file will not compile.' },
    ],
  } as unknown as ReviewResult);

  it('with a passing typecheck: one dropped, one amended, nothing else touched', () => {
    const out = refuteReviewByEvidence(review(), { typecheck: 'passed' });
    expect(out.refuted.map((i) => i.message)).toEqual([REAL]);
    expect(out.amended).toHaveLength(1);
    expect(out.review.issues.map((i) => i.message)).toEqual(['[WARNING] Pressing Save loses the score.']);
    expect(out.review.passed).toBe(true);
  });

  it('without a passing typecheck every finding stands exactly as written', () => {
    for (const typecheck of [undefined, 'failed', 'not run']) {
      const out = refuteReviewByEvidence(review(), { typecheck });
      expect(out.refuted).toEqual([]);
      expect(out.amended).toEqual([]);
      expect(out.review.issues.map((i) => i.message)).toEqual(review().issues.map((i) => i.message));
    }
  });
});
