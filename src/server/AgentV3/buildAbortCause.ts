// WHY A BUILD STOPPED — the truth, instead of blaming the user for all six causes.
//
// THE REPORT THAT FORCED THIS (admin 2026-08-15, verbatim: "maine nahi roki, khud ruki hai bhai").
// A 35.8-minute build ended with the summary "Build stopped by the user." The user had not touched
// anything: the build ran past the 30-minute wall-clock cap and the WATCHDOG stopped it.
//
// The mechanism is one line of ordering. Six different things call `abort()` on a build:
//
//   1. the user pressing Stop                    ← the ONLY one the old message described
//   2. the wall-clock watchdog (30 min)          ← what actually happened
//   3. the advisory cap, once a build SUCCEEDED
//   4. a deploy draining in-flight builds        (the build resumes by itself afterwards)
//   5. a new build reclaiming an abandoned lock
//   6. the zombie reaper
//
// …and AgentRunner's `if (signal.aborted)` branch sits ABOVE the watchdog's own branch, so whichever
// of the six fired, the runner answered first and always with the same sentence. The old code's own
// comment admitted it — "User pressed Stop (or the build was cancelled)" — it knew there were two
// meanings and printed one.
//
// THE SECOND, MORE EXPENSIVE HALF. The watchdog already has an honest, genuinely useful message
// written for exactly this case: *your files so far are saved — send another message and I'll
// continue from here*. Because the abort branch answered first, that sentence was never reachable.
// So a user who had just lost 36 minutes was ALSO not told that the work survived and was resumable.
// Being blamed is bad; being blamed AND quietly denied the recovery path is what makes it costly.
//
// `AbortSignal.reason` carries the cause, so nothing new is threaded through the call graph — the
// abort sites already have the controller in hand, and the runner already has the signal.

/** Why a build's abort signal was fired. */
export type AbortCause =
  | 'user-stop'      // the user pressed Stop
  | 'watchdog'       // the wall-clock cap was reached
  | 'advisory-cap'   // the build had already succeeded; post-build advisory work overran
  | 'deploy-drain'   // the server is restarting; the build resumes on its own
  | 'lock-reclaimed' // a newer build took over an abandoned lock
  | 'reaper'         // the zombie reaper cleaned up a build that stopped reporting
  | 'cost-cap'       // the build spent past its cost ceiling (buildCostCeiling.ts)
  | 'futile'         // the build produced nothing for the whole window (futilityBreaker.ts)
  | 'unknown';       // aborted with no cause recorded — reported as unknown, never guessed

const TAG = '__nbaiAbortCause';

interface CauseCarrier { [TAG]: AbortCause }

function isCarrier(v: unknown): v is CauseCarrier {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)[TAG] === 'string';
}

/**
 * Abort a build and RECORD WHY.
 *
 * Every abort site must go through this. A bare `controller.abort()` is exactly the state this module
 * exists to remove — it produces a signal that cannot answer the only question the user has.
 */
export function abortBuild(controller: { abort: (reason?: unknown) => void }, cause: AbortCause): void {
  const carrier: CauseCarrier = { [TAG]: cause };
  try {
    controller.abort(carrier);
  } catch {
    // An environment whose AbortController.abort takes no argument still has to abort. Losing the
    // cause degrades to 'unknown', which is honest; failing to abort would hang the build.
    try { controller.abort(); } catch { /* already aborted */ }
  }
}

/**
 * The recorded cause, or 'unknown'.
 *
 * 'unknown' is deliberately a real outcome rather than a default of 'user-stop': an abort we cannot
 * explain must never be attributed to something the user did. That mistake is the whole bug.
 */
export function abortCauseOf(signal: { reason?: unknown } | undefined | null): AbortCause {
  if (!signal) return 'unknown';
  return isCarrier(signal.reason) ? signal.reason[TAG] : 'unknown';
}

export interface AbortSummaryContext {
  /** The wall-clock cap in minutes, for the watchdog message. */
  minutes?: number;
  /** Did the build actually write files? Decides whether "your work is saved" is TRUE. */
  builtSomething?: boolean;
  /**
   * Nothing of the build's own was written, BUT the workspace holds files the platform set up for it first.
   * 🔴 Autopsy 303e8a6f: with only a yes/no, a stop on a seeded template said "Nothing had been written yet" while
   * the 14-file app sat in the workspace and on screen. ⚠️ AND WHICH SEED DECIDES THE WAY ON (adversarial review):
   * an untouched tested TEMPLATE is "only our starter" to the router, so the next message is a FRESH build — a
   * promise to "continue from them" would be false; a pasted page or a game kit is not, so the next message IS an
   * edit of it. The route computes this with the router's own test (`seedStateOf`). Ignored when `builtSomething`.
   */
  seed?: SeedState | null;
}

/** What a seeded workspace holds, as the router will read it on the next message. */
export type SeedState = 'platform-template' | 'kept-seed';

/**
 * What a seeded workspace keeps, and the true way on — one sentence per state, for every ending that can meet it.
 * PURE.
 */
export function seedKeptSentence(seed: SeedState): string {
  return seed === 'platform-template'
    ? 'The tested starting template is still in your workspace and preview — send your request again to build on it.'
    : "The starting files are kept in your workspace — send another message and I'll continue from them.";
}

export function abortSummary(cause: AbortCause, ctx: AbortSummaryContext = {}): string {
  const mins = typeof ctx.minutes === 'number' && ctx.minutes > 0 ? ctx.minutes : null;
  const saved = ctx.builtSomething === true;
  const seed = !saved && ctx.seed ? ctx.seed : null;
  const SEED_KEPT = seed ? seedKeptSentence(seed) : '';
  const seededOnly = seed !== null;
  const resume = saved
    ? " Your files so far are saved — send another message and I'll continue from here."
    : seededOnly
      ? ` I had not changed anything yet. ${SEED_KEPT}`
      : ' Nothing was lost; try again or rephrase.';

  switch (cause) {
    case 'user-stop':
      // ⚠️ IT MUST NAME THE WAY BACK, and this file's own opening argues why: being blamed is bad,
      // "being blamed AND quietly denied the recovery path is what makes it costly". The old sentence
      // was six words and told a user who had just stopped a build nothing about what survived. That
      // mattered little while the only way to stop was a button the user had just pressed on purpose;
      // it matters now that a TYPED sentence stops a build (2026-09-14), because the person may not
      // realise anything was kept at all.
      return saved
        ? "Stopped, as you asked. Your files so far are saved — send another message and I'll continue from here."
        : seededOnly
          ? `Stopped, as you asked. I had not changed anything yet. ${SEED_KEPT}`
          : 'Stopped, as you asked. Nothing had been written yet, so nothing was lost.';
    case 'watchdog':
      return mins
        ? `I stopped after about ${mins} min to avoid an endless loop — this build was not converging.${resume}`
        : `I stopped this build because it was taking too long and was not converging.${resume}`;
    case 'advisory-cap':
      // The app itself is FINE here — only the post-build extras ran long. Saying "stopped" without
      // that distinction would report a successful build as a failure.
      return 'Your app is built. I stopped the final polish checks early because they were taking too long — the app itself is unaffected.';
    case 'deploy-drain':
      return 'NavBharatAI restarted (a deploy) while this build was running. Your files are safe and the build resumes automatically.';
    case 'lock-reclaimed':
      return 'This build was replaced by a newer one you started on the same project.' + (saved ? ' Its files so far are saved.' : '');
    case 'reaper':
      return `This build stopped responding and was cleaned up.${resume}`;
    case 'cost-cap':
      // NOT a failure of the user's app, and NOT the user's doing — so neither is implied. The White-
      // Label Law's billing half applies: the user learns that a limit was reached and that their work
      // survived, never what the build cost NavBharatAI (that stays in the admin report).
      return saved
        ? "This build reached its size limit, so I stopped it here rather than let it run on. Your files so far are saved — send another message and I'll continue from here."
        : seededOnly
          ? `This build reached its size limit before it changed anything. ${SEED_KEPT}`
          : 'This build reached its size limit before it produced anything. Nothing was lost — try again with a smaller first step.';
    case 'futile':
      // 🔴 NEITHER THE USER'S FAULT NOR THEIR APP'S, and the two branches are genuinely different
      // situations rather than one sentence with a clause bolted on.
      //
      // The reported build (`d6d664e6`) wrote NOTHING in 29 minutes from a one-word prompt, so the
      // second branch is the common one, and its advice has to be actionable: "try again" alone sends
      // the person back to the same prompt for another 29 minutes. Asking for a little more detail is
      // the one thing that actually changes the outcome — and it is the same remedy the objectless-order
      // rule (#3039) gives BEFORE a build starts. This is the net for when that rule did not catch it.
      //
      // ⚠️ It must NOT say "too long", which is the watchdog's sentence: this build may have stopped at
      // minute 12 of a 30-minute budget. The honest word is that it was not getting anywhere.
      return saved
        ? "This build stopped making progress, so I stopped it here rather than let it run on. Your files so far are saved — send another message and I'll continue from here."
        : seededOnly
          ? `This build was not getting anywhere — it had not changed anything yet, so I stopped it instead of letting it run on. ${SEED_KEPT} Add a bit more detail about what the app should do.`
          : 'This build was not getting anywhere — nothing had been produced, so I stopped it instead of letting it run on. Nothing was lost. Try again with a bit more detail about what the app should do.';
    case 'unknown':
    default:
      // Honest about not knowing, rather than picking a plausible culprit.
      return `This build was stopped before it finished.${resume}`;
  }
}

/**
 * The wall-clock cap reached between turns (not an abort): the same sentence source as every other ending, so
 * the three states can never drift apart again. It used to be an inline copy in AgentRunner. PURE.
 */
export function timedOutSummary(minutes: number, ctx: Pick<AbortSummaryContext, 'builtSomething' | 'seed'> = {}): string {
  if (ctx.builtSomething === true) return `I stopped after about ${minutes} min to avoid an endless loop. Your files so far are saved — send another message and I'll continue from here.`;
  if (ctx.seed) return `I stopped after about ${minutes} min — the build wasn't making progress (often a preview that won't come up), and had not changed anything yet. ${seedKeptSentence(ctx.seed)}`;
  return `I stopped after about ${minutes} min — the build wasn't making progress (often a preview that won't come up). Nothing was lost; try again or rephrase.`;
}

/** A model call that stalled past its per-turn limit. Same three states. PURE. */
export function stalledModelSummary(minutes: number, ctx: Pick<AbortSummaryContext, 'builtSomething' | 'seed'> = {}): string {
  if (ctx.builtSomething === true) return `A model response stalled and was stopped after about ${minutes} min. Your files so far are saved — send another message and I'll continue from here.`;
  if (ctx.seed) return `The model didn't respond in time (stalled after about ${minutes} min), before anything was changed. ${seedKeptSentence(ctx.seed)}`;
  return `The model didn't respond in time (stalled after about ${minutes} min). Nothing was lost — please try again.`;
}

/**
 * Is this cause the user's own doing?
 *
 * Used by the report so a build the PLATFORM stopped is never filed under "the user abandoned it" —
 * the same misattribution one level up, where it would quietly distort every quality metric built on
 * top of these reports.
 */
export function isUserInitiated(cause: AbortCause): boolean {
  return cause === 'user-stop';
}

/**
 * Did this abort end the build BEFORE an engine's capability could be judged?
 *
 * 🔴 THE QUESTION THE FREE-TIER UPSELL ASKS, AND THE EVIDENCE IT USED WAS INCOMPLETE (2026-09-26).
 * The upsell may say *"your app needs our strongest engine — add credits"* only when an engine was
 * really asked to build and could not. `buildWasStopped`'s own docblock names that question —
 * *"did this build reach the point of having a capability to judge?"* — and answers it from
 * `USER_STOPPED_BUILD` alone, which only a user or model stop writes. Our OWN interruptions never
 * write it: a deploy draining in-flight builds, a newer build reclaiming the lock, the zombie reaper.
 * Each of those reached the upsell as though an engine had tried and failed, and could be told to
 * buy a stronger one for a build OUR server cut short.
 *
 * The cause on the signal is the one source that cannot be wrong about why a build ended (every stop
 * path goes through `abortBuild`), so this reads that.
 *
 * TRUE — nothing to judge: the user or the model stopped it, our infrastructure interrupted it, or
 *   the cause is unknown (an abort we cannot explain must never be sold as an engine limit).
 * FALSE — the engine WAS asked and ran out: the wall-clock watchdog, the futility breaker and the
 *   cost ceiling. Those are left to the upsell's own readings (degraded / misconfigured / starved /
 *   engine), exactly as before. `advisory-cap` fires only after a build already succeeded, so it never
 *   reaches the upsell; it is FALSE for the same reason.
 *
 * ⚠️ It can only SUPPRESS an upsell, never open one, and it moves no money: every one of these builds
 * is billed by the rules that already applied to it.
 */
export function interruptedBeforeAnyVerdict(cause: AbortCause): boolean {
  switch (cause) {
    case 'user-stop':
    case 'deploy-drain':
    case 'lock-reclaimed':
    case 'reaper':
    case 'unknown':
      return true;
    case 'watchdog':
    case 'futile':
    case 'cost-cap':
    case 'advisory-cap':
      return false;
    default: {
      // Exhaustive: a tenth cause added to `AbortCause` fails to compile here until someone decides
      // which side of this line it belongs on.
      const unreachable: never = cause;
      return unreachable;
    }
  }
}
