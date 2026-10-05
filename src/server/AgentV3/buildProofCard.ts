// AgentV3 — THE PROOF THE USER ACTUALLY SEES, from evidence the platform ALREADY collected.
//
// 🔑 THE COMPETITIVE POINT, stated plainly because it is the whole reason this module exists.
// Lovable, Bolt, v0, Replit and Cursor hand you code and hope. NavBharatAI opens the finished app in
// a real browser, fills its form, reloads the page to check the data came back, presses up to twenty
// of its controls on fresh loads, opens it again at 390×844 with touch, runs the app's own test suite
// and compiles it. **Not one competitor can print those sentences, because not one of them collects
// that evidence.** And until this module, the user saw at most two of them.
//
// 🔴 WHY ONLY TWO, and it is a structural reason rather than an oversight. The card was emitted right
// after the click explorer — and at that point in the route the app's own test suite has not run
// (`gateEvidence.tests` is set ~250 lines later), the render proof has not been reconciled
// (`gateEvidence.preview`, later still) and the last-chance proof has not happened at all. So the only
// checks that had answered were the journey and the explorer. The card was not thin by choice; it was
// emitted before its evidence existed. The emit moved to where `gateEvidence` is final — beside
// `RELEASE_GATE`, which reads exactly the same object — and `mergeUserProofs` was already variadic and
// pure, waiting for more proofs.
//
// 🔒 THE HONESTY RULES, each one a lesson this repo has already paid for:
//   • THREE OUTCOMES, NEVER TWO. A check that did not run contributes NOTHING — never a reassuring
//     sentence about work that did not happen (`JOURNEY_NOT_RUN`, `EXPLORE_NOT_RUN`,
//     `MOBILE_LAYOUT_NOT_RUN` all exist for exactly this reason).
//   • OUR OWN STARTER SUITE IS NOT "YOUR APP'S OWN TESTS" (autopsy 6bae5835, 2026-09-27: the gate said
//     *"this project HAS a test suite"* about a suite the platform had written eighteen seconds
//     earlier). `testSuiteIsOurStarter` is read, and that line is withheld.
//   • A JOURNEY THAT WAS NOT APPLICABLE IS NOT A PASS. `none-derivable` and `unreachable` say nothing
//     here — the app had nothing to save, or we could not reach it, and neither is proof.
//   • NO CODES, NO TOOL NAMES, NO VENDOR NAMES (the White-Label Law). Every sentence is in the user's
//     own terms, about their own app.
//   • IT NEVER DECIDES ANYTHING. Pure, no I/O, read only after the release gate has been computed from
//     the same evidence — so the card and the gate cannot tell the user two different stories.
//
// PURE.

import type { UserProof } from './clickExplorer';
import type { CheckOutcome } from './releaseGate';

/** At most this many lines in the card — enough to be convincing, short enough to read on a phone. */
export const MAX_PROOF_LINES = 9;

/** Did the phone-size check run, and what did it find? Mirrors the three-outcome rule above. */
export type PhoneOutcome = 'passed' | 'failed' | 'not-run';

export interface PlatformChecks {
  /** The render proof: was the app seen rendering in a real browser? */
  preview: CheckOutcome;
  /** Every page route opened and rendered. */
  pages: CheckOutcome;
  /** `tsc --noEmit` over the finished app. */
  typecheck: CheckOutcome;
  /** The APP'S OWN test suite, run for real. */
  tests: CheckOutcome;
  /**
   * True when the only suite present is the starter one NavBharatAI wrote into the project this
   * build. Then `tests` is OUR suite passing, which is not a fact about the user's own tests.
   */
  testSuiteIsOurStarter?: boolean;
  /** The 390×844 touch check. */
  phone?: PhoneOutcome;
  /** The game playtest (gamePlaytest.ts): played with keys, a drag and a thumb, and scored. */
  game?: { outcome: PhoneOutcome; score?: number | null };
}

export interface ProofOpts {
  /**
   * Did the journey or the click explorer already speak? Their headline is "NavBharatAI tested your
   * app in a real browser", so repeating "it opened in a real browser" as a line would be the same
   * fact twice. Only when neither spoke does the render proof earn its own line.
   */
  browserAlreadySaid: boolean;
}

/**
 * The checks the platform ran on this app, as sentences a user can read — and silence for every check
 * that did not run. Returns an EMPTY headline when nothing was proven, so the card says nothing rather
 * than something encouraging about work that did not happen. PURE.
 */
export function platformChecksProof(checks: PlatformChecks, opts: ProofOpts): UserProof {
  const passes: string[] = [];
  const problems: string[] = [];

  // Strongest proof first. A user reads two lines and stops, so the two that mean most go on top.
  if (!opts.browserAlreadySaid) {
    if (checks.preview === 'passed') passes.push('Your app was opened in a real browser and it rendered.');
    else if (checks.preview === 'failed') problems.push('Your app was opened in a real browser and it did not render.');
  }

  if (checks.pages === 'passed') passes.push('Every screen of your app was opened, and each one rendered.');
  else if (checks.pages === 'failed') problems.push('One of your app\'s screens did not render when it was opened.');

  // A game is PLAYED, not only opened — the strongest sentence a game can carry, so it goes near the top.
  const g = checks.game;
  if (g && g.outcome === 'passed') passes.push(`NavBharatAI played your game — it answered its controls on a keyboard and a touch screen, and scored ${g.score ?? '—'}/100.`);
  else if (g && g.outcome === 'failed') problems.push(`NavBharatAI played your game and found something to fix (Game Quality Score ${g.score ?? '—'}/100).`);

  if (checks.phone === 'passed') passes.push('Your app was opened on a phone-sized screen — it fits, and its buttons are big enough to tap.');
  else if (checks.phone === 'failed') problems.push('On a phone-sized screen your app does not fit properly yet.');

  // 🔒 Never "your app's own tests" about the suite WE wrote (autopsy 6bae5835).
  if (!checks.testSuiteIsOurStarter) {
    if (checks.tests === 'passed') passes.push('Your app\'s own tests were run, and they passed.');
    else if (checks.tests === 'failed') problems.push('Your app\'s own tests were run, and some of them did not pass.');
  }

  if (checks.typecheck === 'passed') passes.push('The whole app was compiled with no errors.');
  else if (checks.typecheck === 'failed') problems.push('The app compiles with errors still in it.');

  const steps = [...problems, ...passes].slice(0, MAX_PROOF_LINES);
  if (steps.length === 0) return { ok: false, headline: '', steps: [] };
  return {
    ok: problems.length === 0,
    headline: problems.length === 0
      ? 'NavBharatAI checked your app'
      : 'NavBharatAI checked your app and found a problem',
    steps,
  };
}

/**
 * Was the browser-backed proof already spoken by the journey or the explorer? Their headlines both say
 * "in a real browser", which is what the render line would otherwise repeat. PURE.
 */
export function browserAlreadySaid(...proofs: ReadonlyArray<UserProof | null | undefined>): boolean {
  return proofs.some((p) => !!p && !!p.headline && Array.isArray(p.steps) && p.steps.length > 0);
}

/**
 * The phone check's three-way outcome from the code it recorded. One place, so the card and the admin
 * report cannot disagree about what the check found. PURE.
 */
export function phoneOutcomeFromCode(code: string | null | undefined): PhoneOutcome {
  const c = String(code ?? '').trim();
  if (c === 'MOBILE_LAYOUT_OK') return 'passed';
  if (c === 'MOBILE_LAYOUT_ISSUES') return 'failed';
  return 'not-run';
}
