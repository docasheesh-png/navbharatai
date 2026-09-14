// "RUN IT" IS NOT A BUILD — and a turn that correctly writes nothing must not be called a failure.
//
// ── THE REPORT THIS EXISTS FOR (build 7bc15e40, 2026-09-13, a real user) ─────────────────────────
// The whole prompt was **"Run it"**, on a project that already had 33 files. The engine did exactly
// the right thing: read package.json, started the dev server, published the preview, took a
// screenshot, and reported the app running. It wrote no files, because running an app does not
// involve writing one.
//
// The platform then told that user:
//     "The build produced no files. Please try again — you have not been charged."
//     "✨ Your app needs our strongest engine to finish cleanly. Add credits…"
//
// Their app was up on the preview at that exact moment. We reported a success as a failure and
// asked them for money to fix it.
//
// ── THE CONTRADICTION, WHICH WAS ALREADY IN THE CODE ─────────────────────────────────────────────
// Two functions looked at the same build and disagreed:
//
//   • `shouldRetryEmptyBuild` declined to retry, in its own words: *"An edit on a project that
//     already exists may legitimately change nothing."* It KNEW.
//   • `emptyBuildFailureSummary` was never told. Its whole input is
//     `(expectsArtifacts, fileCount, sandboxUnavailable)` — so it answered "zero files ⇒ failure",
//     because that is the only question it can be asked.
//
// The platform asks **"did this turn write files?"** and uses the answer for **"did this turn do
// what the user asked?"**. For a request whose correct completion involves no write, those two
// questions have opposite answers.
//
// ── WHY THIS IS DELIBERATELY NARROW ──────────────────────────────────────────────────────────────
// The dangerous direction is the other one: calling a genuinely-failed edit a success. "Make the
// button blue" that wrote nothing IS a failure, and must stay one. So a turn is excused only on
// TWO pieces of POSITIVE evidence, never on the absence of something:
//
//   1. the user's own words asked us to RUN or LOOK AT the app, with no change requested; and
//   2. the app was actually brought up and shown — the preview really went live on this turn.
//
// Fail either test and today's behaviour is byte-identical. A request we cannot read as a pure run
// action is not excused, which is the safe way round: a missed one costs a wrong failure message on
// a working app, while a false positive would hide a real one.
//
// PURE — no clock, no I/O, no env.

/**
 * Words that mean the user wants something CHANGED. Their presence vetoes the whole check, however
 * the sentence began: "run it and add a login page" is a build request with a run bolted on front,
 * and a turn that writes nothing has not done it.
 */
const CHANGE_VERBS = new RegExp([
  /\b(add|added|adding)\b/, /\b(make|makes|making)\b/, /\b(create|creates|creating)\b/,
  /\b(build|builds|building)\b/, /\b(change|changes|changing)\b/, /\b(fix|fixes|fixing)\b/,
  /\b(update|updates|updating)\b/, /\b(remove|removes|removing|delete|deletes|deleting)\b/,
  /\b(rename|move|refactor|implement|install|write|edit|improve|redesign|convert)\b/,
  // Hinglish — the same instructions as this product's users actually type them.
  //
  // ⚠️ `karo` / `kardo` are deliberately NOT here, and leaving them in was a real bug in the first
  // draft of this file: they mean "do", not "change". "app chalu karo" is a request to RUN the app
  // and was being vetoed as an edit. The specific verbs still veto the sentences that matter —
  // "chalao aur ek button add karo" is caught by `add`, not by `karo`.
  /\b(banao|bana|banade|jodo|hatao|badlo|theek|sudhar|likho)\b/,
].map((r) => r.source).join('|'), 'i');

/**
 * The request, when it is only ever a request to run or look.
 *
 * Anchored at the START of the sentence so that a run word buried in a longer instruction ("the app
 * should run a report every night") cannot trigger it — that is prose about the app, not an order
 * to start it.
 */
const RUN_ACTION = new RegExp([
  /^\s*(?:please\s+|just\s+|now\s+)?(?:re)?run\s*(?:it|this|the\s+app|the\s+project|the\s+server)?\s*[.!]?\s*$/,
  /^\s*(?:please\s+|just\s+|now\s+)?(?:re)?start\s*(?:it|this|the\s+app|the\s+server|the\s+project)?\s*[.!]?\s*$/,
  /^\s*(?:please\s+)?(?:re)?launch\s*(?:it|this|the\s+app)?\s*[.!]?\s*$/,
  /^\s*(?:show|open)\s+(?:me\s+)?(?:the\s+)?preview\s*[.!]?\s*$/,
  /^\s*preview\s*[.!?]?\s*$/,
  /^\s*(?:is|does)\s+(?:it|this|the\s+app)\s+(?:working|work|running|live|up)\s*[.!?]*\s*$/,
  // Hinglish: "chalao", "chala do", "isko chalao", "app chalu karo"
  /^\s*(?:isko\s+|ise\s+|app\s+)?chal(?:a|au|ao|aao)\s*(?:do|dijiye)?\s*[.!]?\s*$/,
  /^\s*(?:app\s+)?chalu\s+kar(?:o|do|dijiye)?\s*[.!]?\s*$/,
].map((r) => r.source).join('|'), 'i');

/**
 * True when the user's message asks us to RUN or LOOK AT the existing app, and asks for no change.
 *
 * A change verb anywhere in the message returns false, even if the sentence opens with "run it" —
 * see CHANGE_VERBS. PURE.
 */
export function asksToRunNotChange(prompt: string): boolean {
  const text = String(prompt ?? '').trim();
  if (!text || text.length > 120) return false; // a long message is not a bare run order
  if (CHANGE_VERBS.test(text)) return false;
  return RUN_ACTION.test(text);
}

export interface EmptyTurnFacts {
  /** This turn was an edit of an existing project, not a fresh build. */
  isEditMode: boolean;
  /** How many files the project already had when the turn started. */
  existingProjectFiles: number;
  /** The user asked for an APP TO BE BUILT — such a turn writing nothing is always a failure. */
  userAskedToBuildAnApp: boolean;
  /** The user's own message. */
  prompt: string;
  /** Did the app actually come up and get shown on THIS turn? Evidence, never an assumption. */
  appWasRunAndShown: boolean;
}

/**
 * Was producing no files the CORRECT outcome for this turn?
 *
 * True only for a run/inspect request, on an existing project, that genuinely brought the app up.
 * Everything else — including every "build me an app" that wrote nothing — is false, so the empty
 * build stays the failure it has always been. PURE.
 */
export function emptyTurnWasLegitimate(facts: EmptyTurnFacts): boolean {
  if (!facts || facts.userAskedToBuildAnApp) return false;
  if (!facts.isEditMode) return false;
  if (!(Number(facts.existingProjectFiles) > 0)) return false;
  // 🔒 The evidence half. Without it, the word "run" alone would excuse a turn that did nothing at
  // all — which is the failure this must never start hiding.
  if (!facts.appWasRunAndShown) return false;
  return asksToRunNotChange(facts.prompt);
}
