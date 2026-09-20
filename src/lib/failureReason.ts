// THE ONE FAILURE-REASON CLASSIFIER — shared by the server's Failure Category panel
// (`src/server/lib/buildFailureCategory.ts`) and the admin dashboard's client-side "Top failure
// patterns" card (`src/lib/buildReportAnalytics.ts`). Isomorphic: no server dependency, no I/O.
//
// 🔴 WHY IT WAS CENTRALISED (admin, 2026-09-17 — the "Top failure patterns" card). The card read:
//
//     🔍 I analyzed your project — no files were changed. Overview:                    1 · 25%
//     Sandbox / preview did not come up                                                1 · 25%
//     The GLM rung answered inside its clock and produced nothing, because our own …  1 · 25%
//     Tool call failed: edit_file: old_string not found in <file>. The string you …    1 · 25%
//
// Three of the four "patterns" were RAW SENTENCES — the model's own summary narration, a provider
// diagnostic, and a tool error — because that card's classifier fell back to the first line of
// `rootCause` as the bucket LABEL whenever its nine regexes matched nothing. A pattern panel whose
// rows are one-off sentences answers nothing: every novel sentence is its own 25%.
//
// It was the SECOND classifier of the same `rootCause` vocabulary. `buildFailureCategory.ts` had
// already root-caused the "Other" flood by reading the build's OWN `OUTCOME_*` code before its prose
// (2026-09-17, earlier the same day), and its header recorded — in writing — that the two lists were
// deliberately left apart, as an open item: *"a future pass should decide whether to centralise the
// two reason-classifiers into one shared list."* This is that pass. The drifted-copy class this repo
// keeps paying for (four `safeRelPath`s, two preview-order rules) is exactly two regex lists over one
// vocabulary, tuned separately.
//
// 🔒 THE RULES THIS MODULE KEEPS:
//   • The CODE is read before the prose — a machine fact recorded by the build beats a guess about
//     what its sentence means. Severity rides with it (`OUTCOME_STOPPED` means opposite things at
//     `warning` and at `error`).
//   • Every text pattern is grounded in a real string read out of the source, never invented wording.
//   • An unmatched reason is an HONEST, STABLE `other` — never the raw text as a label. The raw text
//     still travels beside the count (as an example / sample) so the admin can read it and decide
//     whether a new pattern is worth adding.

import { textIsAdvisoryCap, isAdvisoryCapOutcome } from './advisoryCapOutcome';

export interface FailureReason {
  /** Stable machine key, e.g. `empty-build`. Never derived from the text. */
  key: string;
  /** The human label the admin panels show. */
  label: string;
}

/** One definition, so the code path and the text path can never describe it differently. */
export const ADVISORY_CAP_REASON: FailureReason = Object.freeze({
  key: 'advisory-cap',
  label: 'Not a failure — the app was built; only the post-build checks ran out of time',
});

/** The honest bucket for a reason nothing recognises. A stable label, never the sentence itself. */
export const OTHER_REASON: FailureReason = Object.freeze({
  key: 'other',
  label: 'Other (not yet in the known pattern list)',
});

/**
 * 🔴 THE BUCKET THAT WAS HIDING AN ENGINE BUG BEHIND A VOCABULARY ONE (admin, 2026-09-20 — the
 * failure table read *"Other (not yet in the known pattern list)"* at **29.2% of every failure**,
 * the biggest row by a factor of two, and the admin asked how to make it never come back).
 *
 * "Not yet in the known pattern list" says: *add more words and this shrinks*. For a build that
 * recorded an `OUTCOME_*` code that is true. For a build that recorded NONE it is false, and the two
 * had been sharing one bucket — so the top row of the panel pointed every reader at the wrong work.
 *
 * 🔑 THE DISTINCTION IS A MACHINE FACT, not a reading. `classifyFailureReason` returns a mapped
 * reason for EVERY code it knows, and `tests/failureNaming.test.ts` fails CI when a code exists
 * without a label — so a build that reaches the end of this function with **no code at all** did not
 * record why it ended. That is not a gap in our words; it is a gap in the engine's record, and it is
 * the exact hole `abortOutcome.ts` (2026-09-18) and the empty-build flip (2026-09-17) were each
 * built to close one part of. Naming it separately is what lets anyone see whether they worked.
 *
 * ⚠️ IT IS NOT "we do not know why the app broke" — `no-cause-recorded` below is that, and it is the
 * engine SAYING so in its own prose. This one is the record being silent.
 */
export const NO_OUTCOME_REASON: FailureReason = Object.freeze({
  key: 'no-outcome-recorded',
  label: 'The build never recorded WHY it ended (no outcome on the record)',
});

export const NO_ROOT_CAUSE_REASON: FailureReason = Object.freeze({
  key: 'no-root-cause',
  label: 'No root cause was recorded',
});

/**
 * 🔴 WHAT THE BUILD'S OWN OUTCOME CODE MEANS, in the admin's words — the fix for the "Other" flood
 * (admin 2026-09-17: on a panel covering 385 projects and 151 failures, the top reason for THIRTEEN
 * OF FIFTEEN app types was "Other"; six real outcome messages run through the text patterns ALL came
 * back `other`, because a v5 build fails with sentences we wrote ourselves, not compiler words).
 *
 * `BuildRetrospectiveEngine.ts` had already root-caused this on 2026-09-12 — *"The diagnostic CODE is
 * a machine fact recorded by the build itself. Reading it is not pattern matching, it is just
 * looking."* — and `tests/failureNaming.test.ts` asserts every code in its `OUTCOME_TO_CATEGORY` also
 * has a label here, so a code added to one map and not the other fails CI rather than quietly
 * reappearing as "Other".
 */
export const OUTCOME_REASONS: Readonly<Record<string, FailureReason>> = {
  OUTCOME_BUILD_TIMEOUT: { key: 'timeout', label: 'Ran out of time before the app was finished' },
  OUTCOME_STOPPED: { key: 'stopped', label: 'The run ended before it finished' },
  OUTCOME_SYNTAX_ERROR: { key: 'syntax-error', label: 'The generated code did not parse' },
  OUTCOME_TYPECHECK_FAILED: { key: 'typecheck-failed', label: 'TypeScript / compile check failed' },
  OUTCOME_MISSING_FILES: { key: 'missing-files', label: 'Files were imported but never created' },
  OUTCOME_MISSING_EXPORT: { key: 'missing-export', label: 'A file was imported for something it does not export' },
  OUTCOME_BUILD_PARTIAL: { key: 'partial', label: 'The build shipped less than it planned' },
  OUTCOME_PREVIEW_FAILED: { key: 'preview-failed', label: 'The app was produced but never rendered' },
  OUTCOME_PREVIEW_COMPILE: { key: 'preview-compile', label: 'The preview does not compile — the app would not load' },
  OUTCOME_REVIEW_CRITICAL: { key: 'review-critical', label: 'The reviewer found something critical that was not repaired' },
  OUTCOME_RELEASE_GATE_RED: { key: 'release-gate-red', label: 'The release gate found evidence the app does not work' },
  OUTCOME_BUILD_FAILED: { key: 'build-failed', label: 'The build itself failed' },
  /**
   * 🔴 THE MISSING MACHINE FACT (the "Top failure patterns" autopsy, 2026-09-17). A build that expected
   * files and wrote none was flipped to FAILED (`emptyBuildFailureSummary`) WITHOUT recording any
   * `OUTCOME_*` issue — the ONLY verdict flip in the route that recorded none. So `deriveRootCause`
   * had no fact to read and fell to the loudest recorded warning: the summary narration, a provider
   * diagnostic, a tool error. All three of the card's raw-sentence rows were builds of this shape.
   */
  OUTCOME_EMPTY_BUILD: { key: 'empty-build', label: 'No files were produced' },
  OUTCOME_SANDBOX_UNAVAILABLE: { key: 'sandbox-unavailable', label: 'Build sandbox unavailable (infra, not the app)' },
  /**
   * 🔴 THE SEVEN ABORTS THAT RECORDED NOTHING (admin's failure table, 2026-09-18 — "Other" was the top
   * reason for the biggest row, 45 of 106). Nine causes abort a build; only the two deadline causes
   * wrote an outcome. `abortOutcome.ts` now records one for every cause at the route's single abort
   * funnel, and these are their names. A user's stop gets a label too so a legacy reader can still
   * name it — but `categorizeBuildFailures` moves it OUT of the failure tally, because a person ending
   * a build is not a build that failed.
   */
  OUTCOME_USER_STOPPED: { key: 'user-stopped', label: 'Stopped by the user — not a failure' },
  OUTCOME_COST_CEILING: { key: 'cost-ceiling', label: 'Hit the build cost ceiling' },
  OUTCOME_FUTILE: { key: 'futile', label: 'Stopped because nothing was being produced (futility breaker)' },
  OUTCOME_DEPLOY_DRAIN: { key: 'deploy-drain', label: 'Interrupted by a NavBharatAI deploy (resumes on its own)' },
  OUTCOME_SUPERSEDED: { key: 'superseded', label: 'Replaced by a newer build on the same project' },
  OUTCOME_REAPED: { key: 'reaped', label: 'Stopped reporting and was cleaned up by the reaper' },
  /**
   * Split out of `OUTCOME_STOPPED` on 2026-09-20: an abort whose signal carried no cause, i.e. one
   * raised somewhere that never went through `abortBuild`. A wall-clock timeout and an untagged
   * abort are different bugs with different fixes, and one label for both hides the second.
   */
  OUTCOME_ABORTED_UNKNOWN: { key: 'aborted-unknown', label: 'Aborted by something that never said why (not the wall clock, not the user)' },
};

/**
 * The engine's own real failure vocabulary, matched by substring/pattern against `rootCause` — the
 * FALLBACK for a record that carries no outcome code (an imported project, a crash before any outcome,
 * a legacy record, a filed report written before the code was projected into its meta).
 *
 * ⚠️ EVERY PATTERN HERE IS GROUNDED IN A REAL STRING READ OUT OF THE SOURCE, not guessed. Order
 * matters: the FIRST pattern that matches wins, so a more specific bucket (e.g. `db-unreachable`) is
 * listed ahead of a more general one that could also fire on its wording.
 *
 * ⚠️ NO PATTERN MAY BE A BARE COMMON WORD. The retired card classifier matched `/port/i` for "the
 * sandbox did not come up" — which also matches "report", "import", "support" and "export", so an
 * unresolved-import failure could be filed as a sandbox one. A bare word is not a pattern.
 */
const REASON_PATTERNS: ReadonlyArray<{ key: string; label: string; test: RegExp }> = [
  {
    key: 'db-unreachable',
    label: 'Database was not actually reachable',
    // BuildDiagnostics.ts: "reported exit 0 but the database was NOT reachable — the migration/query
    // did not actually run."
    test: /database was not reachable|db unreachable|database is unreachable|could not (connect|reach) (the )?database/i,
  },
  {
    key: 'sandbox-unavailable',
    label: 'Build sandbox unavailable (infra, not the app)',
    // BuildDiagnostics.ts: "could not run — the build sandbox was unavailable (reaped/expired/unreachable)."
    // routes/agentv3.ts emptyBuildFailureSummary: "The build could not run — the sandbox was unavailable".
    test: /sandbox was unavailable|sandbox (is )?unavailable|could not run.{0,40}sandbox/i,
  },
  {
    key: 'provider-starved',
    label: 'The AI answered with nothing — its output ceiling was spent on reasoning',
    // BuildDiagnostics.ts OUTPUT_BUDGET_STARVED: "The <rung> rung answered inside its clock and produced
    // nothing". The card's third row, verbatim.
    test: /answered inside its clock and produced nothing|output ceiling was spent|OUTPUT_BUDGET_STARVED/i,
  },
  {
    key: 'provider-budget',
    label: 'AI provider timed out / ran out of budget',
    // turnDeadline.ts: BUDGET_EXHAUSTED_MESSAGE / BUDGET_REACHED_MESSAGE; plus the platform's own
    // "no provider answered" wording (autopsy 4efab9d7) and a plain provider timeout.
    test: /build budget (exhausted|reached)|no provider answered|timed out|time budget ended/i,
  },
  {
    key: 'provider-unavailable',
    label: 'Every AI provider failed',
    // The retired card classifier's own rule, kept because real rootCauses carry this shape.
    test: /all .*providers failed|provider.*unavailable/i,
  },
  {
    key: 'cost-ceiling',
    label: 'Hit the build cost ceiling',
    test: /cost ceiling|spending (limit|cap) reached/i,
  },
  {
    key: 'user-stopped',
    label: 'Stopped by the user — not a failure',
    // BuildDiagnostics.ts deriveRootCause: "The USER stopped this build — that is why it ended".
    test: /the user stopped this build/i,
  },
  {
    key: 'futile',
    label: 'Stopped because nothing was being produced (futility breaker)',
    // routes/agentv3.ts FUTILITY_BREAKER: "Build stopped because it was producing nothing" — the loudest
    // unresolved warning on a record written before OUTCOME_FUTILE existed.
    test: /stopped because it was producing nothing|futility breaker/i,
  },
  {
    key: 'no-cause-recorded',
    label: 'The engine recorded no cause (stopped before it could say why)',
    // BuildDiagnostics.ts deriveRootCause's own fallbacks — "no specific error was captured", "ended
    // without recording an outcome", "why it failed is not known from this report". These are the
    // engine SAYING it does not know; a stable bucket of its own, distinct from a sentence we have not
    // patterned yet, because only this one means the record itself is incomplete.
    test: /no specific error was captured|ended without recording an outcome|why it failed is not known/i,
  },
  {
    key: 'wall-clock',
    label: 'Build hit the wall-clock time cap',
    // routes/agentv3.ts OUTCOME_STOPPED / OUTCOME_BUILD_TIMEOUT wording: "the wall-clock cap (30 min) was
    // reached", "Build exceeded the 1740s wall-clock cap and was stopped."
    test: /wall-clock|exceeded the \d+s|build timeout/i,
  },
  {
    key: 'stuck-tool',
    label: 'A tool call got stuck and never returned',
    // BuildDiagnostics.ts STUCK_TOOL: "Stuck on '<tool>' — in-flight …s, never completed."
    test: /stuck on ['"]|never completed/i,
  },
  {
    key: 'tool-call-failed',
    label: 'A tool call failed',
    // BuildDiagnostics.ts TOOL_ERROR: "Tool call failed: <summary>". The card's fourth row.
    test: /tool call failed/i,
  },
  {
    key: 'hooks-violation',
    label: 'React Rules-of-Hooks violation',
    // ToolDispatcher.ts: "<n> React Rules-of-Hooks violation(s) (crash at runtime): …"
    test: /rules[- ]of[- ]hooks|hook.*(conditional|after an early return|in a loop)/i,
  },
  {
    key: 'review-critical',
    label: 'A reviewer found a critical issue',
    // BuildDiagnostics.ts deriveRootCause: "Critical issue found by review: <finding>"; the retired
    // card's "reviewer [CRITICAL]" shapes.
    test: /critical issue found by review|reviewer \[critical\]|\[critical\] finding|reviewer .*not verifiably/i,
  },
  {
    key: 'typecheck-failed',
    label: 'TypeScript / compile check failed',
    test: /\btsc\b|typecheck|type error|compil(e|ation) (fail|error)/i,
  },
  {
    key: 'syntax-error',
    label: 'The generated code did not parse',
    test: /syntax error|does not parse|already been declared|unexpected token/i,
  },
  {
    key: 'dependency-error',
    label: 'A dependency / package could not be installed or resolved',
    test: /npm (err|install)|module not found|cannot find (module|package)|unresolved import|missing (local )?module|dependency (error|failed)|missing dependenc|not in package\.json|undeclared package/i,
  },
  {
    key: 'preview-failed',
    label: 'The preview did not render',
    // ⚠️ Deliberately NOT a bare `port` — see the module note. "dev server did not" and the real
    // "nothing is listening on that port" sentence are the grounded shapes.
    test: /preview (failed|error|unverified)|did not render|blank (page|screen)|dev server did not|nothing is listening on (that|the) port/i,
  },
  {
    key: 'runtime-error',
    label: 'A runtime / console error in the built app',
    test: /runtime error|console error|uncaught|unhandled (rejection|exception)/i,
  },
  {
    key: 'empty-build',
    label: 'No files were produced',
    // routes/agentv3.ts emptyBuildFailureSummary: "The build produced no files."; ProjectSummary.ts on an
    // analysis-only turn: "no files were changed" (a legacy empty build's loudest sentence).
    test: /no files (were )?(changed|written|produced)|produced (no|zero) files|empty build|nothing was written/i,
  },
];

/**
 * One build's failure reason. The CODE is read first, because it is a fact the build recorded rather
 * than a guess about what its prose means; the text is the fallback for a record that has no code.
 * PURE, total: never throws, and an unmatched reason is `OTHER_REASON` — never the raw text.
 */
export function classifyFailureReason(
  rootCause: string | null | undefined,
  outcomeCode?: string | null,
  outcomeSeverity?: string | null,
): FailureReason {
  const text = String(rootCause ?? '').trim();
  const code = String(outcomeCode ?? '').trim();
  if (code) {
    /**
     * ⚠️ SEVERITY RIDES WITH THE CODE: `OUTCOME_STOPPED` at `warning` is the 2-minute advisory cap on an
     * app that WAS built. Classifying on the code alone would file every one of those as "the run ended
     * before it finished".
     */
    if (isAdvisoryCapOutcome({ code, message: text })
      || (code === 'OUTCOME_STOPPED' && String(outcomeSeverity ?? '') === 'warning' && textIsAdvisoryCap(text))) {
      return ADVISORY_CAP_REASON;
    }
    const mapped = OUTCOME_REASONS[code];
    // An UNRECOGNISED code falls through to the text exactly as it would have before this existed, so
    // a code added later is never silently mis-filed — it simply classifies as it used to.
    if (mapped) return mapped;
  }
  if (!text) return NO_ROOT_CAUSE_REASON;
  if (textIsAdvisoryCap(text)) return ADVISORY_CAP_REASON;
  for (const p of REASON_PATTERNS) if (p.test.test(text)) return { key: p.key, label: p.label };
  /**
   * 🔴 TWO DIFFERENT PROBLEMS, AND THEY NEEDED DIFFERENT NAMES. Reaching here with a CODE in hand
   * means the engine said why it ended and our list has no word for it — a vocabulary gap, fixed by
   * adding a pattern. Reaching here with NO code means the engine never said, and no pattern that
   * could ever be written would change that — the fix is upstream, at whichever ending path records
   * nothing. Filing both as "Other (not yet in the known pattern list)" made the second one look
   * like the first, which is how the panel's biggest row stayed unfixed while two separate fixes
   * were shipped AT it.
   */
  return code ? OTHER_REASON : NO_OUTCOME_REASON;
}
