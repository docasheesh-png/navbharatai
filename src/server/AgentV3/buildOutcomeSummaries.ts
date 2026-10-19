// Build-outcome summaries, extracted verbatim from routes/agentv3.ts (owner item 5: agentv3.ts is at the
// TypeScript control-flow-analysis size limit). Pure; re-exported from routes/agentv3.ts so existing importers
// are unchanged. Behaviour-preserving move — no logic or wording edits.

/**
 * EMPTY-BUILD HONESTY (deep-test App #7, 2026-07-13). A build that EXPECTED artifacts (a new build / edit)
 * but produced ZERO files is a FAILURE — never "✓ Done". The App #7 report showed `ok: true` / "Done · 9
 * steps" over an EMPTY preview because the sandbox could not be set up (SANDBOX_UNAVAILABLE), so no file
 * could ever be written, yet the turn still ran the model 29× and reported success. Returns an honest,
 * retry-able summary when the build must be forced to `ok:false`, or null when it produced files / didn't
 * expect any. Pure + exported for testing.
 */
export function emptyBuildFailureSummary(
  expectsArtifacts: boolean,
  fileCount: number,
  sandboxUnavailable: boolean,
  /**
   * Did the server's OWN eyes see this app come up and render in a browser on this turn?
   *
   * 🔴 THE FOURTH REASON "ZERO FILES" IS NOT A FAILURE (report fd021c64, 2026-09-14). A user typed
   * "Yess create karo" into a workspace already holding their 25-file Fantasy Football app. The
   * engine restored it, started the dev server, opened it in a real browser, confirmed it rendered,
   * ran the production build green, and saved it as the last known good state — then told the user
   * **"The build produced no files. Please try again"** and asked them to **add credits**.
   *
   * Nothing was broken. Nothing NEEDED writing. The whole build then ran a SECOND time on a stronger
   * model to reach the same conclusion — five minutes and sixteen model calls to tell somebody their
   * working app does not exist.
   *
   * 🔒 WHY THE RENDER IS THE RIGHT EVIDENCE, and not the model's own word for it. `ok: true` from the
   * runner is a CLAIM — build 5b4f9b63 is exactly that claim being false ("your to-do app is complete
   * and ready" over an unrelated project, zero files). A verified render is a MEASUREMENT the platform
   * took itself. "Preview is EARNED" cuts both ways: it refuses a green tick without proof, and it
   * must equally refuse a failure verdict against proof.
   */
  appRenders = false,
  /**
   * Did the model ASK THE USER A QUESTION instead of building?
   *
   * 🔴 THE HALF THAT MAKES THE RETRY FIX SAFE (autopsy e628efd4, 2026-09-25). Suppressing the retry
   * alone would have replaced a good answer with a false one: the turn ends with zero files, and
   * this function would tell the user *"The build produced no files. Please try again"* over the
   * very question the model had just asked them. That is 697b38ee's sin in a new place.
   *
   * 🔒 AND IT IS WHAT KEEPS THE UPSELL QUIET, WITHOUT A SECOND ANSWER ANYWHERE. The "add credits"
   * block downstream is gated on `!result.ok`; standing down here leaves `ok` true, so that gate
   * never opens — exactly the architecture the comment beside it demands ("Writing it a second time
   * here would leave two answers to one question"). The bill is ₹0 either way: a turn that wrote no
   * files is zeroed unconditionally, whatever its verdict.
   *
   * ⚠️ It claims NOTHING about an app, which is why it needs no browser evidence (unlike
   * `verifiedNoChangeSummary`, which asserts "your app works" and therefore must prove it). It only
   * declines to call an ANSWER an empty build.
   */
  askedTheUser = false,
  /**
   * Did the model DECLINE? The sibling `askedTheUser` was given in e628efd4 and this one was not
   * (2026-09-26). A declined zero-file turn had its refusal REPLACED with "please try again" — an
   * instruction to retry something the engine will decline again — and that replacement is what
   * the free-tier upsell then read, finding no refusal in it and asking the user for money. A
   * refusal is a FINAL answer (`shouldRetryEmptyBuild` already says so), so it is left standing,
   * exactly as a question is. See `turnAnswer.ts`.
   */
  declined = false,
): string | null {
  if (!expectsArtifacts) return null;
  // SANDBOX DOWN ⇒ FAILURE regardless of file count (deep-test App #11, 2026-07-14). When the sandbox
  // could not be set up (403 "team is blocked: missing payment method"), EVERY write_file/bash 403'd, so
  // NOTHING was persisted to the sandbox and NOTHING was ever installed/compiled/run. But the per-file
  // generator still recorded 23 in-memory files (flushed only to the durable Firestore store), so
  // `fileCount > 0` was true — and the old `fileCount > 0 → null` guard let the build report ok:true /
  // "READY 100/100" over a preview with ZERO files ("0 file par build health 100%"). A dead sandbox can
  // never have produced a real, runnable, VERIFIED app, so fail unconditionally when it was unavailable.
  if (sandboxUnavailable) {
    return 'The build could not run — the sandbox was unavailable (no files could be created, installed, or verified). Please try again in a moment; you have not been charged.';
  }
  if (fileCount > 0) return null;
  // AN ANSWER IS NOT AN EMPTY BUILD. Checked after `sandboxUnavailable` for the same reason as
  // `appRenders`: a dead sandbox is an infrastructure fact that must still win.
  if (askedTheUser) return null;
  if (declined) return null;
  // A WORKING APP IS NOT AN EMPTY BUILD. Checked after `sandboxUnavailable` on purpose: a dead sandbox
  // can never have rendered anything, so that verdict must still win if the two ever disagree.
  if (appRenders) return null;
  return 'The build produced no files. Please try again — you have not been charged.';
}

/**
 * THE MACHINE FACT THE EMPTY-BUILD FLIP NEVER RECORDED (the "Top failure patterns" autopsy, 2026-09-17).
 *
 * Every other verdict flip in this route records an `OUTCOME_*` issue beside its `ok:false` —
 * `OUTCOME_PREVIEW_COMPILE`, `OUTCOME_SYNTAX_ERROR`, `OUTCOME_REVIEW_CRITICAL` — and `deriveRootCause`
 * reads that code before anything else. The empty-build flip (`emptyBuildFailureSummary`) flipped the
 * verdict and recorded NOTHING, so the report had no fact to name and fell to the loudest recorded
 * warning. On the admin's card that produced three "failure patterns" that were one build's own
 * sentence each: the model's summary narration (*"🔍 I analyzed your project — no files were
 * changed"*), a provider diagnostic (*"The GLM rung answered inside its clock and produced nothing"*),
 * and a tool error (*"Tool call failed: edit_file: old_string not found"*). All three were empty
 * builds; none of the three sentences was the reason.
 *
 * Two codes, because the two causes are different work: a sandbox that could not be set up is
 * infrastructure (the same distinction `isInfra` already draws for `SANDBOX_UNAVAILABLE`), while a
 * build that had a sandbox and still wrote nothing is the engine's. Both are mapped in
 * `src/lib/failureReason.ts` and `BuildRetrospectiveEngine.ts` (drift-guarded by
 * `tests/failureNaming.test.ts`). Pure + exported for testing.
 */
export function emptyBuildOutcomeIssue(
  sandboxUnavailable: boolean,
): { phase: 'build'; severity: 'error'; code: 'OUTCOME_EMPTY_BUILD' | 'OUTCOME_SANDBOX_UNAVAILABLE'; message: string; autoResolved: false } {
  return sandboxUnavailable
    ? {
      phase: 'build', severity: 'error', code: 'OUTCOME_SANDBOX_UNAVAILABLE', autoResolved: false,
      message: 'Build outcome: SANDBOX_UNAVAILABLE — the build sandbox could not be set up, so no file could be created, installed or verified. Infrastructure condition, not the app or the prompt.',
    }
    : {
      phase: 'build', severity: 'error', code: 'OUTCOME_EMPTY_BUILD', autoResolved: false,
      message: 'Build outcome: EMPTY — the build expected to produce files and wrote none, and the app was not seen rendering. Nothing to run, nothing to verify.',
    };
}

/**
 * The honest SUCCESS summary for a turn that changed nothing because nothing needed changing — and
 * PROVED it.
 *
 * 🔴 THE REPORT (697b38ee, 2026-09-14). "Continue from where you left off and finish/fix the build so
 * the app works end-to-end." The engine did exactly that, twice over: `tsc --noEmit` exit 0, `npm run
 * build` exit 0, dev server up, preview published, opened in a real browser and seen rendering, the
 * project's own Playwright suite installed and PASSED, PROD_BUILD_OK, GREEN_GUARD_SAVE, release gate
 * "It runs and renders". Then it told the user:
 *
 *     "The build produced no files. Please try again — you have not been charged."
 *     "NavBharatAI's engine is running slowly right now and your build could not finish."
 *
 * Every clause of that is false. The build finished, the engine answered, and the app works. The user
 * asked whether their app was working; we checked, found that it was, and reported a failure.
 *
 * 🔒 THE CLASS, AND WHY A NARROWER PATCH WOULD NOT HAVE FIXED IT: the platform measures DELIVERY by
 * FILES WRITTEN. A turn whose correct output is a VERDICT rather than a diff — "continue", "is it
 * working?", "did you finish?", "fix the build" — is therefore structurally incapable of succeeding,
 * however well it runs. `shouldRetryEmptyBuild` had already conceded the point in words two months ago
 * ("the distinction is not 'did files change' but 'is there an app'") and applied it only to the
 * RETRY. This applies it to the VERDICT, which is the half the user actually reads.
 *
 * ⚠️ EVIDENCE, NEVER ASSUMPTION. It returns a success ONLY when a real browser was watched rendering
 * the app on this run (`appRendered`, the same flag the release gate is fed). A turn that wrote nothing
 * and proved nothing is still an honest failure — silence about an app is not good news about it, and
 * "no files" must never become a way to pass.
 *
 * 🔴 AND IT USED TO END THE CONVERSATION ON THE ONE PROMPT IT COULD NOT ANSWER (report
 * a48d0f9e, 2026-09-19). The user typed **"Repair some parts."** — a request to FIX things. The turn
 * ran a typecheck and a lint, both clean, changed no file, and replied *"Nothing needed changing … it
 * works"*, followed by *"tell me exactly what's not working and I'll fix them"*.
 *
 * Thirty-five seconds EARLIER, the same build had already recorded, in this same report:
 * `ACCESSIBILITY — 70/100, 34 form field(s) with no label across 21 files. Worst: Marksheets (12),
 * ReportCards (11), Students (10)` — and a YELLOW release gate. **We held a list of thirty-four
 * concrete, named defects and asked the user to name one for us.**
 *
 * The findings were not lost: `buildFindingSuggestions` maps them to user-facing titles for the 💡
 * bulb. But that is a SEPARATE surface, read from the PREVIOUS build's saved report, which the user has
 * to go and open — while the answer to the question they actually asked said there was nothing.
 *
 * 🔒 SO THE SUMMARY NOW CARRIES THEM, and it reuses that exact table rather than inventing a second
 * vocabulary: the same titles, the same ranking, the same `NEVER_SUGGEST` exclusions, so a
 * process-only code can no more reach this sentence than it can reach the bulb.
 *
 * ⚠️ WITH NO FINDINGS THE SENTENCE IS BYTE-IDENTICAL to what it has always said — the whole
 * behaviour rides on a list being non-empty, so a build with nothing to report cannot regress. And it
 * changes the WORDS only: `ok` stays true and the turn stays free, because a check that checked is
 * still a check that checked.
 * Pure + exported for testing.
 */
export function verifiedNoChangeSummary(opts: {
  expectsArtifacts: boolean;
  filesWritten: number;
  sandboxUnavailable: boolean;
  /** The turn ran as an edit — there was an app here before it started. */
  isEditMode: boolean;
  existingProjectFiles: number;
  /** Did the user ask for an APP TO BE PRODUCED? See `userAskedForAnAppToBeBuilt`. */
  userAskedToBuildAnApp: boolean;
  /** A real browser was opened on the running app and it rendered. The one piece of proof that counts. */
  appRendered: boolean;
  /**
   * What this build ALREADY MEASURED and has not fixed — the user-facing titles from
   * `buildFindingSuggestions`, in its ranking. See the 🔴 note below: empty or absent leaves the
   * sentence byte-identical to what it has always said.
   */
  openFindings?: readonly string[];
  /**
   * Did the model answer the user — decline, or ask them something — instead of building?
   *
   * 🔴 THE SIBLING e628efd4 NEVER REACHED (2026-09-26). On an existing, working app, *"make the header
   * blue"* → the model asks *"navy or sky blue?"* → zero files → this function REPLACED that question
   * with *"Nothing needed changing — I checked your app from end to end and it works."* The request
   * was dropped and the user was told it had been handled. The sentence below is a claim that
   * nothing needed doing; a model that asked or declined has said the opposite, so the model's own
   * words stand. See `turnAnswer.ts`.
   */
  modelAnsweredTheUser?: boolean;
}): string | null {
  if (!opts.expectsArtifacts || opts.filesWritten > 0) return null;
  if (opts.modelAnsweredTheUser) return null;            // the model's own answer stands
  if (opts.sandboxUnavailable) return null;              // nothing could have been verified either
  if (!opts.isEditMode || opts.existingProjectFiles <= 0) return null; // no app to have been fine already
  if (opts.userAskedToBuildAnApp) return null;           // they wanted an app produced; none was
  if (!opts.appRendered) return null;                    // no proof ⇒ no success

  const found = (opts.openFindings ?? []).map((t) => String(t || '').trim()).filter(Boolean);
  if (found.length === 0) {
    return (
      'Nothing needed changing — I checked your app from end to end and it works. '
      + 'It compiles, the production build succeeds, the server starts, and I opened it in a real browser '
      + 'and watched it render. No file was modified, because none had to be.'
    );
  }
  const list = found.length === 1
    ? found[0]
    : `${found.slice(0, -1).join(', ')} and ${found[found.length - 1]}`;
  return (
    'I checked your app from end to end and it works — it compiles, the production build succeeds, '
    + 'the server starts, and I opened it in a real browser and watched it render. No file was modified, '
    + 'because nothing is stopping it from running. '
    + `I can see ${found.length} thing${found.length === 1 ? '' : 's'} worth fixing though: ${list}. `
    + "Say the word and I'll fix them."
  );
}

/**
 * FINAL-SYNTAX-ERROR HONESTY (sibling of the reviewer-CRITICAL false-success fix, 2026-07-21). The final
 * syntax re-verify catches a LATE repair (endgame / reviewer-autofix) that reintroduced a non-parsing
 * file after the early syntax gate. It already records an UNRESOLVED OUTCOME_SYNTAX_ERROR so the health
 * card can't say READY — but it never flipped the build's `ok` verdict, so a build that WON'T COMPILE
 * could still emit ok:true and be BILLED as success (only the preview-verify path zeroed billing, and
 * only when it actually observed the non-render). An app that does not compile is not a delivered app
 * (the "working app or free" law) — force ok:false with an honest, resumable summary so both exit paths
 * (the deadline finalizer and the normal settle) agree and the failed-build billing guard makes it free.
 * White-label: no provider/model names. Pure + exported for testing.
 */
export function finalSyntaxErrorSummary(fileCount: number): string {
  const n = Math.max(1, fileCount);
  return (
    `Your app is saved, but ${n} file${n === 1 ? '' : 's'} in the final build ${n === 1 ? "doesn't" : "don't"} ` +
    `compile yet — so it isn't runnable. You have NOT been charged for this build. Reply "continue" and I'll finish the fix.`
  );
}
