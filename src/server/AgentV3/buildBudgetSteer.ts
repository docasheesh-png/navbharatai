/**
 * THE BUILD'S TIME BUDGET, TOLD TO THE MODEL — the missing subsystem from the f04421ef autopsy.
 *
 * 🔴 WHAT WENT WRONG, and it is the single biggest reason that build never finished. The user asked
 * *"Continue from where you left off and finish/fix the build so the app works end-to-end."* After the
 * typecheck was clean at 2m23s the engine: browsed the running app for 91 seconds, ran an audit, fixed
 * accessibility and CSS, **generated two test files**, **installed a dev dependency (80 seconds)**, and
 * ran a production build. At 9m49s it was still going and had never reported an outcome.
 *
 * None of that is wrong work. It is wrong work *for the time remaining*, and nothing in the engine could
 * say so: the wall clock existed only as a GUILLOTINE. `buildTimedOut()` ends the build, `maxBuildMs`
 * bounds it, `finalizeOnDeadline` cleans up after it — and the model was told none of it. It optimised
 * for a complete job because it had no reason to believe the job was nearly out of time.
 *
 * 🔒 SO THIS IS A STEER, NOT A NEW CAP. It spends no model call and no tool call: the text rides the
 * message the runner already appends after each turn, beside the loop-guard steer, through the same
 * path. Nothing is forbidden in code — the model is simply TOLD the number it was missing, in
 * escalating terms, each stage once. A build with no cap configured (`maxBuildMs` 0 or absent) is never
 * steered at all, so behaviour there is byte-identical to before.
 *
 * ⚠️ WHY THE THRESHOLDS ARE FRACTIONS AND NOT MINUTES. The cap is env-tunable
 * (`AGENTV3_MAX_BUILD_SECONDS`, default 1800) and is scaled by pipeline depth, so a fixed "at 15 minutes"
 * rule would be meaningless on a short cap and never fire on a long one. Halves and quarters hold at
 * every cap.
 */

/** The stages of a build's remaining time, in the order they are reached. */
export type BudgetStage = 'half' | 'wrapping' | 'final';

/**
 * The fraction of the budget at which each stage begins.
 *
 * 50% is where optional work should stop — on the reported build the tests and the dependency install
 * both began after this line. 75% is where exploring should stop. 90% is where everything except saving
 * and summarising should stop, which still leaves real minutes for the finalizer to do its work.
 */
export const BUDGET_STAGE_AT: Readonly<Record<BudgetStage, number>> = {
  half: 0.5,
  wrapping: 0.75,
  final: 0.9,
};

const STAGE_ORDER: readonly BudgetStage[] = ['half', 'wrapping', 'final'];

/** Which stage this elapsed/total pair is in, or null while there is still plenty of time. */
export function budgetStage(elapsedMs: number, totalMs: number): BudgetStage | null {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null; // no cap configured ⇒ no budget to spend
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const used = elapsedMs / totalMs;
  // Walk from the LAST stage back, so a build that jumps straight past two thresholds (a single very
  // long tool call) reports the stage it is actually in rather than the first one it crossed.
  for (let i = STAGE_ORDER.length - 1; i >= 0; i--) {
    const stage = STAGE_ORDER[i];
    if (used >= BUDGET_STAGE_AT[stage]) return stage;
  }
  return null;
}

/** Whole minutes of budget left, floored at 0 — the figure the steer quotes. */
export function minutesLeft(elapsedMs: number, totalMs: number): number {
  return Math.max(0, Math.round((totalMs - elapsedMs) / 60_000));
}

export interface BudgetSteer {
  stage: BudgetStage;
  /** The text appended to the model's next turn. */
  text: string;
  /** One short line for the user, so the narrowing is visible rather than mysterious. */
  narration: string;
}

/**
 * The steer for this moment, or null when there is nothing new to say.
 *
 * `alreadySent` is the set of stages already delivered — the caller owns it for the life of the build, so
 * each stage speaks exactly ONCE. Repeating a budget warning every turn would be noise the model learns
 * to skim, which is how a real warning stops working.
 *
 * A build that crosses two stages between turns gets only the LATER one: the advice is cumulative, and
 * "stop everything optional" already contains "stop adding tests".
 */
export function budgetSteer(
  elapsedMs: number,
  totalMs: number,
  alreadySent: Set<BudgetStage>,
): BudgetSteer | null {
  const stage = budgetStage(elapsedMs, totalMs);
  if (!stage || alreadySent.has(stage)) return null;
  const mins = minutesLeft(elapsedMs, totalMs);
  const left = mins <= 1 ? 'under a minute' : `about ${mins} minutes`;

  if (stage === 'half') {
    return {
      stage,
      narration: `⏳ Half the build time is used — focusing on making the app work, and leaving extras out.`,
      text:
        `[TIME BUDGET] Half of this build's time is gone and ${left} remain.\n`
        + 'From here, spend the remaining time ONLY on what makes the app actually work for what the user '
        + 'asked for. Specifically, do NOT now:\n'
        + '  • write or generate tests\n'
        + '  • install, add or upgrade any dependency\n'
        + '  • polish styling, copy or accessibility\n'
        + '  • run broad audits or re-verify something that already passed\n'
        + 'If one of those is the ONLY thing the user actually asked for, do it. Otherwise finish the '
        + 'working app first — an app that runs beats a tidier app that never finished.',
    };
  }

  if (stage === 'wrapping') {
    return {
      stage,
      narration: `⏳ Time is short — wrapping up so you get a working app rather than an unfinished one.`,
      text:
        `[TIME BUDGET] Only ${left} of this build's time remain — a quarter of it.\n`
        + 'Stop exploring and stop improving. Do exactly this, in order: (1) make sure the app builds and '
        + 'runs, (2) fix anything that stops it running, (3) write your summary. Start nothing new. If '
        + 'something is half-done and not needed for the app to run, leave it and say so in the summary.',
    };
  }

  return {
    stage,
    narration: `⏳ Out of time — saving your app and summarising what was done.`,
    text:
      `[TIME BUDGET] ${left === 'under a minute' ? 'Under a minute' : left.replace('about ', 'About ')} of this build's time remain.\n`
      + 'Stop all work now except saving what you have and writing an honest summary. Do not start, edit '
      + 'or verify anything else. Say plainly in the summary what is finished and what is not — an honest '
      + '"this part is not done" is worth far more than a claim that cannot be checked.',
  };
}
