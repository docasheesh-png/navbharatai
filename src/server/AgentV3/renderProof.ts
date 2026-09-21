/**
 * 🔴 THE EVIDENCE LEDGER'S WRITE HALF, for the one fact this engine trusts most — *"a real browser
 * opened this app and it rendered"* (autopsy 697b38ee, SEVENTH appearance of this root cause).
 *
 * CLAUDE.md names the missing subsystem and says exactly what it is missing:
 *
 *   > *"Until one ledger exists that any actor writes a proven fact into and every verdict reads
 *   > from, this class returns."*
 *
 * `provenFromTimeline.ts` built the READ half and found that most actors already write: a published
 * address records `PREVIEW_PUBLISHED`, a clean runtime records `RUNTIME_VERIFIED`. **The render proof
 * was the exception — it was written to LOCAL VARIABLES and to nothing else**, and that is how the
 * defect below survived.
 *
 * ## The defect this module exists to make impossible
 *
 * FOUR variables held the one fact, each assigned by hand, and the two producers did not agree:
 *
 * | | `previewVerifiedRendered` | `browserRenderProven` | `buildObs.previewRendered` | the ledger |
 * |---|---|---|---|---|
 * | the preview verify loop | set | set | set | — |
 * | **the render rescue** | set | set | **never set** | — |
 *
 * So after a RESCUED render — the path whose own record says it upgrades the build *"so health,
 * billing and the verdict are honest"* — every reader of the third copy was told the app had not
 * rendered. In `routes/agentv3.ts` two of those copies answer the SAME question in ADJACENT BRANCHES
 * OF ONE `if`: `verifiedNoChangeSummary` is passed `previewVerifiedRendered`, and ten lines below
 * `emptyBuildFailureSummary` is passed `buildObs.previewRendered`.
 *
 * **What that actually cost, checked one reader at a time rather than assumed:**
 *
 * - 🔴 **The failure card the admin asked for could never fire for a rescued build.** The `result`
 *   event's `appRendered` is that third copy, and `appRanDespiteFailedVerdict` requires it to be
 *   `true`. A rescued app whose verdict a LATER flip turned back to `ok: false` — a stopped build is
 *   exactly such a case, since `runProvenApp` does not hold a flip for one — therefore showed the
 *   plain failure card and its *"finish/fix the build so the app works end-to-end"* button. That is
 *   the admin's own 2026-09-14 mechanism, verbatim: *"ham aise builds ko fix with ai press hote hi
 *   SACH ME TOD DETE HAI"*. The half that was built to be durable was disarmed by a missing line.
 * - 🔴 **The admin Monitor under-counted it.** Both exits report `previewAllowed` from the same copy,
 *   so every rescued render read as a build whose preview never came up.
 * - ⚠️ **The cancelled-build bill reads it too** (`appRendered: buildObs.previewRendered === true`),
 *   and a Stop arriving after the rescue has run is ordinary — which under-charges for an app the
 *   browser had just watched rendering, against the admin's standing rule (*"agar preview chala gaya
 *   to ₹0 charge karoge to aise to mai barbaad ho jaunga"*). Reachable by ordering; **not observed in
 *   a report**, and recorded as the weaker claim it is.
 * - ✅ **`emptyBuildFailureSummary` was NOT affected, and saying so closes the obvious wrong
 *   conclusion.** It is the guard that copy most visibly serves, but `renderRescueEligible` requires
 *   `filesWritten > 0` and that summary returns `null` on `fileCount > 0` before it ever reads the
 *   render. The argument is dead on this path.
 *
 * 🔒 **WHY A RECORDED FACT AND NOT A FOURTH BOOLEAN.** A boolean has to be assigned at every producer, so a
 * new producer is one forgotten line away from the bug above — which is what happened. A recorded fact
 * is written once, by one function, and read by everyone; `provenFromTimeline` then answers for every
 * consumer, including ones nobody has written yet.
 *
 * 🔒 **ONLY A REAL BROWSER COUNTS, and the decision lives HERE rather than at the call sites.** This
 * repo already draws that line — `browserRenderProven` and the green-freeze latch both require
 * `shot.source === 'browser'`, because a curl fallback's empty-shell "render" cannot be trusted
 * (adversarial review 2026-08-12). Passing a non-browser source returns `null`: there is nothing to
 * record, rather than a weaker fact for a later reader to mistake for proof.
 *
 * PURE. No I/O, no clock, never throws.
 */

import { IN_BUILD_GREEN_CODE } from './inBuildGreen';

/**
 * The one code that means *"a real browser opened this app and it rendered"*.
 *
 * ⚠️ Imported by `provenFromTimeline.ts` rather than re-typed there. A reader holding its own copy of
 * a writer's string is the drift this repo has paid for repeatedly (four `safeRelPath`s, two
 * complex-app detectors) — one constant, two sides.
 */
export const APP_RENDERED_CODE = 'APP_RENDERED' as const;

/**
 * 🔴 EVERY CODE THAT, ON ITS OWN, MEANS *"a real browser opened this app and it rendered"*.
 *
 * ## Why a SET, when this module already had one code (2026-09-21, EIGHTH appearance)
 *
 * The docblock above promises that a recorded fact is *"written once, by one function, and read by
 * everyone"*. Half of that was true and the half that was not is the bug: `appRenderedRecord` is
 * indeed the only writer of `APP_RENDERED` — and it is called from exactly TWO places, both inside
 * `markAppRendered`, which sets the local `previewVerifiedRendered` flag **first**. So
 * `provenFromTimeline(…).preview === 'passed'` could never be true while that flag was false: **the
 * ledger could not answer a question the local boolean could not already answer.** It looked like a
 * ledger and behaved like a mirror.
 *
 * Meanwhile `inBuildGreen` — a pass that opens the app in a real browser, refuses a curl capture
 * outright, and records *"The app rendered in a real browser Ns into this build"* — wrote its proof
 * to its own private code and **no verdict in the engine read it**. That is the root cause in one
 * sentence: not a missing store, but a missing shared VOCABULARY. One actor proves the app renders;
 * another verdict, reading a different code-set, says it never did.
 *
 * ## The bar for membership, and it is not negotiable
 *
 * A code belongs here only when its producer is **structurally incapable** of recording it for a
 * non-browser capture — verified by reading that producer, never by reading its message:
 *
 * | code | the guard that makes it browser-only |
 * |---|---|
 * | `APP_RENDERED` | `appRenderedRecord`: `if (source !== 'browser') return null` |
 * | `IN_BUILD_GREEN` | `inBuildGreen`: `if (input.shot.source !== 'browser') return { kind: 'no-browser' }` |
 *
 * ⚠️ **TWO CODES WERE CONSIDERED AND REFUSED, and the reasons matter more than the list.**
 *
 * - **`PREVIEW_PUBLISHED`** — an address that is listening is not an app that painted. That is
 *   `provenFromTimeline`'s own distinction and it stands.
 * - **`GREEN_GUARD_SAVE`** — and this one is a CORRECTION. `BuildDiagnostics.appWasSeenRunning`
 *   states in writing that it *"is recorded only after the app was opened in a real browser and seen
 *   rendering"*. **The code does not honour that.** It is written from `previewGreen`, which both of
 *   its producers set on `verdict.rendered` alone — the `shot.source === 'browser'` test sitting
 *   three lines below guards the green-freeze latch and `markAppRendered`, not this flag. A curl
 *   capture's empty-shell "render" therefore reaches it. It stays out of this set, and the false
 *   sentence is corrected where it is written.
 */
export const RENDER_PROVEN_CODES: ReadonlySet<string> = new Set<string>([
  APP_RENDERED_CODE,
  IN_BUILD_GREEN_CODE,
]);

/** The one shape this reader needs. Structural, so any recorded issue list fits. */
export interface RecordedRenderFact {
  code?: string | null;
  severity?: string | null;
}

/**
 * Did any actor record that a real browser saw this app render?
 *
 * ⚠️ **`severity === 'info'` is required, and it is not ceremony.** Both producers write these codes
 * as `info`. A future WARNING carrying the same code would be some new, weaker sense of the word, and
 * the safe answer to a shape we do not recognise is to say nothing — the discipline
 * `provenFromTimeline` already established for exactly these two codes.
 *
 * `false` means *"the timeline does not settle this"*, never *"the app did not render"*. A caller
 * fills a gap from this; it must not demote evidence it already holds.
 */
export function renderProvenByAnyActor(
  facts: ReadonlyArray<RecordedRenderFact> | null | undefined,
): boolean {
  for (const f of facts || []) {
    const code = typeof f?.code === 'string' ? f.code : '';
    if (code && RENDER_PROVEN_CODES.has(code) && f.severity === 'info') return true;
  }
  return false;
}

/** Shape matches `BuildDiagnostics.record`'s `BuildIssue`; structural, to avoid a circular import. */
export interface RenderProofRecord {
  phase: 'preview';
  severity: 'info';
  code: typeof APP_RENDERED_CODE;
  message: string;
  autoResolved: true;
  detail?: string;
}

/** Where the render was observed. Mirrors the actuator's `browseUrl` result. */
export type RenderProofSource = 'browser' | 'curl' | undefined;

/**
 * The write. Returns the record to file, or `null` when nothing was PROVEN.
 *
 * `where` is free text naming which pass saw it (the verify loop, the render rescue) — it reaches the
 * admin report's detail only, and no reader parses it. What a reader is entitled to conclude is
 * carried by the CODE, never by the sentence.
 */
export function appRenderedRecord(source: RenderProofSource, where: string): RenderProofRecord | null {
  if (source !== 'browser') return null;
  const at = String(where || '').trim().slice(0, 80);
  return {
    phase: 'preview',
    severity: 'info',
    code: APP_RENDERED_CODE,
    message: 'The app was opened in a real browser and rendered — recorded so every later verdict reads '
      + 'one proof instead of keeping its own.',
    autoResolved: true,
    ...(at ? { detail: `observed by: ${at}` } : {}),
  };
}
