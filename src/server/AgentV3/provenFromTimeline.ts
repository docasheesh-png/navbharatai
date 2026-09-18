/**
 * 🔴 THE EVIDENCE LEDGER'S SECOND READER — what the build ALREADY PROVED, read back from its own
 * recorded timeline (autopsy 697b38ee; SIXTH appearance of this root cause, 2026-09-18).
 *
 * CLAUDE.md names the missing subsystem in its own words, and has named it since 2026-09-14:
 *
 *   > *"there is no shared EVIDENCE LEDGER. The agent's shell commands and the platform's gates keep
 *   > private notions of what has been proven, and the gates trust only their own … Until one ledger
 *   > exists that any actor writes a proven fact into and every verdict reads from, this class
 *   > returns."*
 *
 * That report contained `RUNTIME_UNCHECKED` recorded after three successful browser console reads, and
 * a release gate telling the user the app *"has no test suite that could be run here"* about a suite
 * its own log showed passing. `agentRunEvidence.ts` closed the half those two share — facts settled by
 * the SHELL COMMAND LOG — and its docblock names what it deliberately did not touch:
 *
 *   > *"That proof does not live in the shell-command log at all — it is held by the page checks — so
 *   > it needs the ledger's WRITE half (an actor recording a proven fact), not this READ half."*
 *
 * 🔑 **AND THE WRITE HALF TURNS OUT TO ALREADY EXIST.** Every actor that proves something already
 * records it — `RUNTIME_VERIFIED` when the app was loaded in a real browser with no errors,
 * `PREVIEW_PUBLISHED` / `PLATFORM_PREVIEW_UP` when an address really went up. The build's own issue
 * timeline IS the ledger. **Nothing read it back.** So this is not a new store to thread through
 * twelve call sites — it is the missing READ over a ledger the engine has been writing all along, and
 * the route already proves the pattern works: `stoppedByUser` is read off this same timeline
 * precisely so the gate and `rootCause` "can never tell the reader different stories about one build".
 *
 * ⚠️ **WHY THIS IS A SIBLING OF `agentRunEvidence` AND NOT A BRANCH INSIDE IT.** That module answers
 * "what does the COMMAND LOG settle?" and parses shell output; this one answers "what did an ACTOR
 * record as proven?" and reads issue codes. Merging them would put two different sources of truth
 * behind one name, and a caller could no longer tell which kind of evidence it was trusting.
 *
 * 🔒 **IT CANNOT CHANGE A BILL, AND THAT WAS CHECKED RATHER THAN ASSUMED.** A gate goes RED only on
 * `!buildOk`, on a check recorded as `'failed'`, or on blockers — and RED is what flips a build to
 * `ok: false` and therefore FREE. This module only ever promotes a check from `'not-run'` to
 * `'passed'`, which removes no failure and adds none: a RED build stays RED and free, and an
 * UNKNOWN build becomes YELLOW. It moves the SENTENCE, never the money.
 *
 * PURE. No I/O, no clock, never throws.
 */
import type { CheckOutcome } from './releaseGate';
import { APP_RENDERED_CODE } from './renderProof';

/** The one shape of a recorded fact this reader needs. Structural, so any issue list fits. */
export interface RecordedFact {
  code?: string | null;
  severity?: string | null;
  autoResolved?: boolean | null;
}

/**
 * `RUNTIME_VERIFIED` has exactly TWO producers in `AutoFix.ts`, and both mean the same thing —
 *   · `runtimeVerifiedRecord()`   — *"the app ran in the browser with no actionable console errors"*
 *   · `runtimeRecordFromPageChecks()` — *"every one of the N page(s) was loaded in a real browser and
 *     produced no page or console errors"*
 *
 * ⚠️ **It is mapped to `pages`, NOT to `preview`, and the narrower claim is deliberate.** `preview`
 * means the LIVE PREVIEW came up; the page-check producer runs precisely when that session is not up
 * and says so in its own message. `pages` — *"did the app's own page routes render in a real
 * browser?"* — is established by BOTH producers, so it is the strongest claim that is true either
 * way. Reading our own prose to tell the two apart would be a parser over a sentence we are free to
 * reword, which is how a fact becomes fiction one edit later.
 */
const APP_RAN_IN_A_BROWSER = 'RUNTIME_VERIFIED';

/** An address really went up. Wording only — see `previewUrlPublished` on `RuntimeEvidence`. */
const PREVIEW_ADDRESS_CODES = new Set(['PREVIEW_PUBLISHED', 'PLATFORM_PREVIEW_UP']);

export interface TimelineProof {
  /** Only ever `'passed'` — this reader promotes, and never demotes or fails a check. */
  pages?: Extract<CheckOutcome, 'passed'>;
  /**
   * The app itself was seen RENDERING in a real browser — written by `renderProof.appRenderedRecord`,
   * which is where the "real browser only" rule lives. Only ever `'passed'`, same as `pages`.
   *
   * ⚠️ This is a STRONGER claim than `previewUrlPublished` and must not be confused with it: an
   * address that is listening is not an app that painted, which is the distinction `PREVIEW_PUBLISHED`
   * was reworded to respect (*"Whether the app itself renders is checked next"*).
   */
  preview?: Extract<CheckOutcome, 'passed'>;
  /** Changes how an unproven preview is EXPLAINED, never the verdict. */
  previewUrlPublished?: boolean;
}

/**
 * Read back what this build's own actors recorded as proven.
 *
 * Returns only the facts the timeline SETTLES. An absent key means "the timeline does not answer
 * this" — never a silent negative, the same discipline `typecheckEvidenceFromCommands` established:
 * a gate fills a gap from this, it never overwrites evidence it already has.
 */
export function provenFromTimeline(
  facts: ReadonlyArray<RecordedFact> | null | undefined,
): TimelineProof {
  const list = facts || [];
  const out: TimelineProof = {};
  for (const f of list) {
    const code = typeof f?.code === 'string' ? f.code : '';
    if (!code) continue;
    // ⚠️ `RUNTIME_VERIFIED` is an `info` record in both producers. A future WARNING carrying the same
    // code would be some new, weaker sense of the word, and must not silently count as proof — the
    // safe answer to a shape we do not recognise is to say nothing.
    if (code === APP_RAN_IN_A_BROWSER && f.severity === 'info') out.pages = 'passed';
    // Same discipline as the line above: `APP_RENDERED` is written as `info` by its one producer, and
    // a future warning carrying the code would be a weaker sense of the word that must not pass as
    // proof.
    if (code === APP_RENDERED_CODE && f.severity === 'info') out.preview = 'passed';
    if (PREVIEW_ADDRESS_CODES.has(code)) out.previewUrlPublished = true;
  }
  return out;
}
