// EVERY WAY A BUILD IS ABORTED MUST RECORD AN OUTCOME — the "Other" bucket, root-caused.
//
// 🔴 THE PANEL THAT FORCED THIS (admin, 2026-09-18). On the Failure Category panel — 381 built,
// 153 failed — the top reason for General apps (106 failures, the biggest row) was *"Other (not yet
// in the known pattern list)"*, 45 times; for Healthcare, Events and Logistics too. The admin asked
// for these failures to be driven to zero "deep DNA level". A failure nobody can NAME cannot be fixed
// at any level, so the first DNA step is to find out why the engine's own record could not say what
// happened.
//
// THE MECHANISM, read out of the code rather than guessed. Nine things abort a build
// (`AbortCause` in buildAbortCause.ts). `AgentRunner` sees the signal and returns `ok:false` with an
// honest user-facing sentence — but it never touches the diagnostics timeline; only the route does.
// And the route recorded an `OUTCOME_*` code for exactly TWO of the nine: the wall-clock watchdog and
// the advisory cap, both written by `finalizeOnDeadline`. The other seven — the user's Stop, the cost
// ceiling, the futility breaker, a deploy draining builds, a reclaimed lock, the zombie reaper, and
// an abort with no cause — ended the build with NO outcome on the record.
//
// With no outcome, `deriveRootCause` falls to "the most severe unresolved issue" — whatever warning
// happened to be loudest: a provider fallback, a benched rung, a `read_file` on a path not yet written.
// The classifier then reads THAT sentence, matches nothing (it was never about why the build ended),
// and files it as "Other". Verified by running every one of the nine abort sentences and every
// `deriveRootCause` fallback through `classifyFailureReason` with no code: **all of them came back
// `other`.** The panel was not failing to recognise failures; the record was not carrying the cause.
//
// This is the sibling of the 2026-09-17 empty-build fix, which found "the ONLY verdict flip in the
// route that recorded none" — it was the only flip in the ROUTE. The abort branch lives in the runner,
// and it flips seven ways.
//
// 🔑 THE FIX IS AT THE ONE FUNNEL. `abortBuild` is the single door every abort site goes through
// ("Every abort site must go through this"), so the SIGNAL is the complete source, and the route
// already reads it once, right after `runner.run` returns (the `USER_STOPPED_BUILD` back-fill of
// autopsy b89ba6f8). This module turns that cause into the outcome to record there. It is a `switch`
// over the union with a `never` check, so a TENTH abort cause cannot be added without deciding what
// its outcome is — the compiler refuses, which is the only way this stays fixed.
//
// 🔒 THREE PROPERTIES.
//   • A cause the finalizer already records (`watchdog`, `advisory-cap`) yields NOTHING here, so one
//     ending can never carry two outcomes. The caller ALSO checks that no `OUTCOME_*` is on the
//     timeline yet, for the same reason from the other side.
//   • A user's stop is recorded at `info` — it is not a failure of the app or the engine, and
//     `deriveRootCause` takes an outcome's message regardless of severity, so the report's headline
//     says exactly that. The other stops are `error`: the build really did not finish.
//   • Every message is a fact the signal proves. Nothing here claims files were saved (that is the
//     runner's sentence, decided from what it wrote); nothing names a vendor.
//
// PURE. No I/O, no clock. Never throws.

import type { AbortCause } from './buildAbortCause';

export interface AbortOutcome {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

/** The outcome codes this module can record, named once so the tests and the maps read the same list. */
export const ABORT_OUTCOME_CODES = Object.freeze({
  userStopped: 'OUTCOME_USER_STOPPED',
  costCeiling: 'OUTCOME_COST_CEILING',
  futile: 'OUTCOME_FUTILE',
  deployDrain: 'OUTCOME_DEPLOY_DRAIN',
  superseded: 'OUTCOME_SUPERSEDED',
  reaped: 'OUTCOME_REAPED',
  /** Shared with the wall-clock finalizer: "the run ended before it finished". */
  stopped: 'OUTCOME_STOPPED',
  /**
   * 🔴 AN ABORT THAT DID NOT COME THROUGH `abortBuild` (admin's failure table, 2026-09-20 — "the run
   * ended before it finished" was 11.1% of every failure, and nothing on the panel could say which
   * of three unrelated endings it was).
   *
   * `OUTCOME_STOPPED` was carrying the wall-clock watchdog (a real timeout: the build ran out of
   * MINUTES), a platform-composed stop, AND `abortCauseOf` returning `'unknown'` — which happens for
   * any abort signal this repo did not tag, i.e. a path that never reached the funnel at all. The
   * first two are understood endings. The third is a HOLE, the same shape as a failure with no
   * outcome, and it cannot be found while it is averaged in with a timeout.
   *
   * ⚠️ Deliberately its own code rather than a message variant: the classifier reads the CODE, so a
   * distinction that lives only in prose is a distinction no panel will ever show.
   */
  abortedUnknown: 'OUTCOME_ABORTED_UNKNOWN',
} as const);

/**
 * The outcome to record for an aborted build, or `null` when this cause is recorded elsewhere.
 *
 * `platformComposed` — the build's own prompt was composed by NavBharatAI (a "Fix with AI" button, a
 * platform notice), so nothing in that run is the user's words and a stop must not be filed as the
 * user's doing (autopsy fdd59ef8). It only changes the `user-stop` case.
 */
export function abortOutcomeFor(cause: AbortCause, opts: { platformComposed?: boolean } = {}): AbortOutcome | null {
  switch (cause) {
    case 'watchdog':
    case 'advisory-cap':
      // `finalizeOnDeadline` records these itself (OUTCOME_STOPPED / OUTCOME_ADVISORY_CAPPED), with the
      // cap's real minutes in hand. A second record here would be the same ending written twice.
      return null;
    case 'user-stop':
      return opts.platformComposed === true
        ? {
          code: ABORT_OUTCOME_CODES.stopped, severity: 'error',
          message: 'Build outcome: STOPPED — the build was stopped while working on a request NavBharatAI itself composed; not by the user.',
        }
        : {
          code: ABORT_OUTCOME_CODES.userStopped, severity: 'info',
          message: 'Build outcome: STOPPED BY THE USER — that is why it ended. No failure of the app or the engine is implied.',
        };
    case 'cost-cap':
      return {
        code: ABORT_OUTCOME_CODES.costCeiling, severity: 'error',
        message: 'Build outcome: STOPPED — the build reached its cost ceiling (AGENTV3_BUILD_COST_CEILING_USD) and was stopped between turns. Not a defect in the app; the work so far is kept.',
      };
    case 'futile':
      return {
        code: ABORT_OUTCOME_CODES.futile, severity: 'error',
        message: 'Build outcome: STOPPED — the futility breaker ended it: no file, command or step for the whole quiet window. The engine was not getting anywhere, not the app.',
      };
    case 'deploy-drain':
      return {
        code: ABORT_OUTCOME_CODES.deployDrain, severity: 'error',
        message: 'Build outcome: INTERRUPTED — NavBharatAI was deploying and drained this build; it resumes on its own. An infrastructure event, not the app.',
      };
    case 'lock-reclaimed':
      return {
        code: ABORT_OUTCOME_CODES.superseded, severity: 'error',
        message: 'Build outcome: SUPERSEDED — a newer build on the same project reclaimed this one\'s lock. Not a defect in the app.',
      };
    case 'reaper':
      return {
        code: ABORT_OUTCOME_CODES.reaped, severity: 'error',
        message: 'Build outcome: STOPPED — the build stopped reporting and the zombie reaper cleaned it up. An engine condition, not the app.',
      };
    case 'unknown':
      return {
        code: ABORT_OUTCOME_CODES.abortedUnknown, severity: 'error',
        message: 'Build outcome: STOPPED — the build was aborted with no cause recorded on its signal, so it did not come through the abort funnel. The cause is genuinely unknown; it is not attributed to the user, and it is not a fact about the app.',
      };
    default: {
      // A new AbortCause reaches here only if this switch was not extended — the compiler says so.
      const exhaustive: never = cause;
      return exhaustive;
    }
  }
}
