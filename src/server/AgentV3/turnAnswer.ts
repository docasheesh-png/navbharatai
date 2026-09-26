/**
 * WHAT DID THE MODEL ANSWER? — read ONCE, from the model's own words, before the platform rewrites them.
 *
 * 🔴 THE CLASS THIS CLOSES (2026-09-26, the `turnKind` open root cause from autopsy e628efd4).
 * Four places in the build route ask "did the model decline, or ask the user something?", and each
 * one read `result.summary` at its own moment. But the platform itself REWRITES `result.summary`
 * between those moments — the empty-build flip, the verified-no-change sentence, the release-gate
 * summary — so a reader that runs after a rewrite is asking the question of OUR sentence, not the
 * model's. Two real consequences, both verified before this change:
 *
 *   1. **A refusal was sold a stronger engine.** A free build whose model declined wrote no files,
 *      so `emptyBuildFailureSummary` replaced the refusal with *"The build produced no files. Please
 *      try again"* — and 650 lines later the upsell asked `looksLikeRefusal(result.summary)` of THAT
 *      sentence, got `false`, and told the user *"Add credits and I will complete it on the best
 *      engine."* That is report 03997004's exact sentence, alive for every refusal the safety
 *      triage does not catch. The triage stops pornography before a build starts; a model that
 *      declines anything else still reached this path.
 *   2. **An edit's question was answered for the user.** On an existing app, *"make the header
 *      blue"* → the model asks *"navy or sky blue?"* → zero files → `verifiedNoChangeSummary`
 *      replaced the question with *"Nothing needed changing — I checked your app from end to end
 *      and it works."* The user's request was dropped and they were told it had been handled.
 *      e628efd4 taught `emptyBuildFailureSummary` that a question is an answer; its sibling one
 *      screen up was never told.
 *
 * 🔑 THE FIX IS WHEN THE ANSWER IS READ, NOT HOW. `readTurnAnswer` is called once, right after the
 * last MODEL run (the empty-build retry, if it ran), and every reader reads that reading. The two
 * predicates are imported, never re-implemented, so the nudge, the retry and every verdict below
 * them can never disagree about what the model said.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT SETTLE: "was the build STOPPED?" still has two definitions in
 * the route — the abort signal (retry, run proof) and the stop-aware timeline (the upsell). Unifying
 * them changes behaviour at three sites and is recorded as its own open item, not folded in here.
 *
 * PURE: no I/O, no state.
 */

import { looksLikeRefusal } from '../lib/promptSafety';
import { turnAskedTheUser } from './nudgeToBuild';

export interface TurnAnswer {
  /** The model said it cannot or will not do what was asked. */
  declined: boolean;
  /** The model ended its turn on a question, handing the decision back to the user. */
  asked: boolean;
}

/** Read the model's own answer. Call it on the MODEL's text, before any platform rewrite. */
export function readTurnAnswer(answer: string | null | undefined): TurnAnswer {
  return { declined: looksLikeRefusal(answer), asked: turnAskedTheUser(answer) };
}

/**
 * Did the model answer the user instead of building? A refusal and a question are both FINAL answers
 * for this turn — the rule `shouldRetryEmptyBuild` already states for both — so a platform sentence
 * must never be written over either.
 */
export function answeredWithoutBuilding(answer: TurnAnswer): boolean {
  return answer.declined || answer.asked;
}
