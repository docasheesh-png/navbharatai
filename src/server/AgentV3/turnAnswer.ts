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
import { turnAskedTheUser, turnPointedToPlatformFeature } from './nudgeToBuild';
import { adRemovalAnsweredNotBuilt, type OwnAdNetwork } from './thirdPartyLimits';

export interface TurnAnswer {
  /** The model said it cannot or will not do what was asked. */
  declined: boolean;
  /** The model ended its turn on a question, handing the decision back to the user. */
  asked: boolean;
  /** The user asked for a phone package and the model pointed to NavBharatAI's own APK flow (autopsy 0c2a987a). */
  pointed: boolean;
  /**
   * The turn's whole ask was to remove ads that live inside another service's player, the model said so, and
   * it changed nothing — the one correct outcome, filed until Q-1019 as a failed build. Decided from MEASURED
   * project facts (see `adRemovalAnsweredNotBuilt`), never from reading the model's prose for a refusal.
   */
  notOurs: boolean;
}

/**
 * The project facts a turn's answer is judged against. Omitted (or partly omitted) ⇒ `notOurs` is false and
 * every other field is unchanged, so a caller that does not have them behaves exactly as before.
 */
export interface TurnAnswerFacts {
  /** An edit of an app that exists. */
  editTurn?: boolean;
  /** An import / survey turn — the user's own code. */
  importTurn?: boolean;
  /** The WHOLE project's ad-serving players (`projectAdServingPlayers`). */
  players?: readonly string[] | null;
  /** The WHOLE project's OWN ad networks (`projectOwnAdSdks`). */
  ownAds?: readonly OwnAdNetwork[] | null;
}

/** Read the model's own answer. Call it on the MODEL's text, before any platform rewrite. */
export function readTurnAnswer(answer: string | null | undefined, request?: string | null, facts?: TurnAnswerFacts): TurnAnswer {
  return {
    declined: looksLikeRefusal(answer),
    asked: turnAskedTheUser(answer),
    pointed: turnPointedToPlatformFeature(answer, request),
    notOurs: adRemovalAnsweredNotBuilt({
      prompt: request, modelText: answer,
      editTurn: facts?.editTurn === true, importTurn: facts?.importTurn === true,
      players: facts?.players ?? [], ownAds: facts?.ownAds ?? [],
    }),
  };
}

/**
 * Did the model answer the user instead of building? A refusal, a question, a pointer to the
 * platform's own feature (autopsy 0c2a987a) and "those ads are not the app's to switch off" (Q-1019) are
 * all FINAL answers for this turn — the rule `shouldRetryEmptyBuild` already states for the first two — so
 * a platform sentence must never be written over any of them.
 */
export function answeredWithoutBuilding(answer: TurnAnswer): boolean {
  // `notOurs` joined this list for the reason the first three are on it (Q-1019): the one correct outcome of
  // the turn was a sentence, so a platform sentence must never be written over it.
  return answer.declined || answer.asked || answer.pointed || answer.notOurs;
}

/**
 * The text a "what did the model answer?" question must be asked of: the model's own words when the runner
 * kept them apart from a summary it extended (`AgentRunResult.modelAnswer`), else the summary. PURE.
 *
 * 🔴 AUTOPSY 0473628e. The runner returns `turn.text + "(No files were created, so the build did not run.)"`
 * for a turn that built nothing. The question detector reads the LAST line, so it read our sentence: the
 * model had asked the user two scope questions, the nudge had stood down for exactly that reason, and the
 * empty-build retry fired anyway — the e628efd4 class (a verdict asked of text the platform rewrote), through
 * the runner rather than the route.
 */
export function modelsOwnWords(result: { summary?: string | null; modelAnswer?: string | null }): string {
  return typeof result.modelAnswer === 'string' && result.modelAnswer.trim() ? result.modelAnswer : String(result.summary ?? '');
}
