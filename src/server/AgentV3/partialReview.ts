// AgentV3 — SALVAGE A REVIEW THAT RAN OUT OF TIME, instead of throwing its findings away.
//
// ROOT CAUSE (admin report 2026-09-01, recorded in PROGRESS.md as STILL OPEN and not touched since):
//
//     🥵 Struggle | 291s (38% of the build) after the last model call on a review that timed out
//                  at 194s and whose findings were DISCARDED
//
// The user paid for 46 files of review — tokens spent, minutes spent — and received nothing at all.
// Not "fewer findings": nothing. The build then shipped with `REVIEW_INCOMPLETE`, its completeness net
// down, on exactly the kind of large app that most needs one.
//
// WHY THE TWO EXISTING FIXES COULD NOT HELP, which is the whole reason this module exists:
//   • 2026-07-07 made the budget SIZE-SCALED (a fixed 90s was killing 40-file reviews).
//   • 2026-08-12 added a GRACE window, after a review landed 1.5s past the stopwatch and was binned.
// Both are good, and both move the CLIFF rather than remove it. The budget is a guess about how long
// a review takes, so some review will always land past it — the 2026-09-01 build had 194s of budget
// plus the full 30s of grace and still needed more. Raising the numbers again just buys a slower
// build and a further-away cliff.
//
// THE THING NOBODY USED: the reviewer is a sub-agent on the shared event stream, and it NARRATES its
// findings AS IT WORKS. The 2026-08-12 report shows this in its own timeline — the complete review
// text arrives as an AGENT_STEP event one millisecond before `agent_done`. So the work was never
// unobservable; it was merely unobserved. A timeout can stop us WAITING for the final summary without
// discarding what the reviewer has already said out loud.
//
// PURE — the impure half (subscribing to the stream) stays at the call site, so every rule below is
// unit-testable against real reviewer output.

import { parseReviewOutput, type ReviewResult } from './ReviewerAgent';

/** Reviewer text captured from the live event stream while the review was still running. */
export interface SalvagedReview extends ReviewResult {
  /** Always true — marks a verdict assembled from an unfinished review. Never rendered as complete. */
  partial: true;
}

/**
 * Is there enough here to be worth calling a review?
 *
 * A reviewer that has only announced itself ("## Code Review Report") has told us nothing, and
 * presenting that as a partial review would be noise dressed as a finding. Require at least one real
 * severity-tagged line, which is also the exact shape `parseReviewOutput` knows how to read. PURE.
 */
export function hasSalvageableFindings(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return /\[(CRITICAL|WARNING|SUGGESTION)\]/i.test(text);
}

/**
 * Build an honest verdict from an unfinished review's own words, or null when there is nothing to say.
 *
 * THREE HONESTY RULES, each of which the codebase has already paid to learn:
 *
 * 1. **A partial review can never FAIL a build** (`passed` is always true). A truncated stream may have
 *    printed a `[CRITICAL]` whose next sentence was going to withdraw it — this reviewer is explicitly
 *    instructed to self-dismiss false positives in the same finding, and deep-test 66ec5c1e shows what
 *    acting on a phantom critical costs: a working, render-verified app failed, and the auto-fix loop
 *    chased it to the wall-clock cap. Evidence we did not let finish is not evidence enough to condemn.
 *
 * 2. **A score is never invented.** `reviewBuild` may infer 85/40 for a COMPLETE review, which is fair
 *    when the reviewer genuinely finished and simply omitted the number. Inferring one here would be
 *    scoring an unfinished inspection. Only a score the reviewer actually printed is carried; otherwise
 *    it stays 0, and the caller renders the findings rather than a number.
 *
 * 3. **The summary says what this is.** It is labelled partial in its own text, so no downstream
 *    surface — chat, report, health card — can present it as a completed review by accident.
 *
 * PURE.
 */
export function salvageReview(text: unknown): SalvagedReview | null {
  if (!hasSalvageableFindings(text)) return null;
  const raw = String(text);
  const issues = parseReviewOutput(raw);
  if (issues.length === 0) return null;
  // Only a score the reviewer actually wrote down (rule 2).
  const m = raw.match(/score[:\s]+(\d+)/i);
  const score = m ? Math.min(100, Math.max(1, parseInt(m[1], 10))) : 0;
  const counts = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    suggestion: issues.filter((i) => i.severity === 'suggestion').length,
  };
  const parts = [
    `${counts.critical} critical`, `${counts.warning} warning`, `${counts.suggestion} suggestion`,
  ];
  return {
    partial: true,
    passed: true, // rule 1 — never fails a build
    score,
    issues,
    summary: `Partial review — the completeness check ran out of time, but had already reported ${parts.join(', ')} finding(s) before it stopped. These are real findings from an UNFINISHED review, so treat them as leads rather than a verdict; nothing here failed the build.`,
  };
}

/**
 * The user-facing line for a salvaged review.
 *
 * Deliberately NOT `formatReview`: that renders nothing when the score is 0 (its "skipped" signal), and
 * a salvaged review usually has no score precisely because it never reached the end. Reusing it would
 * silently drop exactly the findings this module exists to rescue.
 *
 * Names no provider and no model (white-label law) and claims nothing about completeness. PURE.
 */
export function formatPartialReview(review: SalvagedReview, maxIssues = 5): string {
  const head = '📋 Partial review — the deeper completeness check ran out of time on this large app, '
    + 'but here is what it had already found. Send "review it" for a full pass.';
  const lines = review.issues.slice(0, Math.max(1, maxIssues)).map((i) =>
    `  ${i.severity === 'critical' ? '🚨' : i.severity === 'warning' ? '⚠️' : '💡'} ${i.message}`);
  const more = review.issues.length > maxIssues ? [`  …and ${review.issues.length - maxIssues} more.`] : [];
  return [head, ...lines, ...more].join('\n');
}
