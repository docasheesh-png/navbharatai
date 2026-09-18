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

/**
 * The one code that means *"a real browser opened this app and it rendered"*.
 *
 * ⚠️ Imported by `provenFromTimeline.ts` rather than re-typed there. A reader holding its own copy of
 * a writer's string is the drift this repo has paid for repeatedly (four `safeRelPath`s, two
 * complex-app detectors) — one constant, two sides.
 */
export const APP_RENDERED_CODE = 'APP_RENDERED' as const;

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
