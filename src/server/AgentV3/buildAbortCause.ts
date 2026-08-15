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
}

/**
 * The sentence the user reads.
 *
 * Two rules, both learned from the report this module comes from:
 *   • Never claim the user did something they did not do.
 *   • When work SURVIVED, say so and say how to continue — that is the difference between "you lost
 *     36 minutes" and "your app is saved, one message resumes it". Only claim it when
 *     `builtSomething` is true, or the reassurance becomes its own lie.
 */
export function abortSummary(cause: AbortCause, ctx: AbortSummaryContext = {}): string {
  const mins = typeof ctx.minutes === 'number' && ctx.minutes > 0 ? ctx.minutes : null;
  const saved = ctx.builtSomething === true;
  const resume = saved
    ? " Your files so far are saved — send another message and I'll continue from here."
    : ' Nothing was lost; try again or rephrase.';

  switch (cause) {
    case 'user-stop':
      return 'Build stopped by the user.';
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
    case 'unknown':
    default:
      // Honest about not knowing, rather than picking a plausible culprit.
      return `This build was stopped before it finished.${resume}`;
  }
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
