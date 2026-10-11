// ONE MORE REVIEW AFTER AN APPLIED FIX (admin 2026-10-11, Q-157: "one more review after an auto-fix, only
// when the fix was applied").
//
// The reviewer's [CRITICAL] findings get one repair pass (C9). When that pass COMPLETED, the build trusted
// it: the criticals were cleared and the app shipped as fixed — while the code beside it said "a future
// slice could re-review to confirm the criticals are actually gone". A completed pass is not a correct one.
// THE CLASS: a fix declared done because it ran, never checked against the finding it was for. Now the
// reviewer looks once more, only when a fix was applied, and what it still finds keeps the build honestly
// not-ok. One look, never a loop: no second repair follows it. PURE — the route runs the review.
import { reviewerBudgetMs } from './PipelineDepth';
import type { ReviewResult } from './ReviewerAgent';

/** The [CRITICAL] findings of a review, as the C9 pass reads them. PURE. */
export function reviewCriticals(review: Pick<ReviewResult, 'issues'> | null | undefined): string[] {
  return (review?.issues ?? []).filter((i) => i.severity === 'critical').map((i) => i.message.trim()).filter(Boolean);
}

/** reviewerBudgetMs never returns less than its 45 s floor plus its 60 s margin, so the room is checked first. */
export const RECHECK_MIN_HEADROOM_MS = 105_000;

/** The time the re-review may take, or 0 when the build has no room left for it. PURE. */
export function postFixRecheckBudgetMs(fileCount: number, headroomMs: number, projectFileCount = 0): number {
  if (Number.isFinite(headroomMs) && headroomMs < RECHECK_MIN_HEADROOM_MS) return 0;
  return reviewerBudgetMs(fileCount, headroomMs, projectFileCount);
}

export interface PostFixRecheckOutcome {
  /** What still blocks the build; `null` when the re-review gave no verdict, so the completed fix stands. */
  unresolved: string[] | null;
  code: 'REVIEW_RECHECK_CLEAN' | 'REVIEW_RECHECK_CRITICALS_REMAIN' | 'REVIEW_RECHECK_NOT_RUN';
  severity: 'info' | 'warning';
  autoResolved: boolean;
  message: string;
}

/**
 * What the re-review said. `null` (no room, timed out, threw) and a skipped review (score 0) are NO
 * verdict — never read as clean, and never as broken. PURE.
 */
export function postFixRecheckOutcome(review: ReviewResult | null | undefined, why = ''): PostFixRecheckOutcome {
  if (!review || review.score === 0) {
    return {
      unresolved: null, code: 'REVIEW_RECHECK_NOT_RUN', severity: 'info', autoResolved: true,
      message: `The reviewer's critical findings were repaired, but the repair was not reviewed again${why ? ` (${why})` : ''} — so it is trusted, not confirmed.`,
    };
  }
  const left = reviewCriticals(review);
  if (left.length === 0) {
    return {
      unresolved: [], code: 'REVIEW_RECHECK_CLEAN', severity: 'info', autoResolved: true,
      message: 'The reviewer looked again after the repair and found no critical issue left.',
    };
  }
  return {
    unresolved: left, code: 'REVIEW_RECHECK_CRITICALS_REMAIN', severity: 'warning', autoResolved: false,
    message: `The reviewer looked again after the repair and ${left.length} critical issue(s) remain: ${left.slice(0, 3).join(' · ').slice(0, 400)}`,
  };
}
