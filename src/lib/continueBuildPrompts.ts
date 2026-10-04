// THE PLATFORM'S OWN "CONTINUE" SENTENCES — written once, recognised by the server.
//
// 🔴 WHY (autopsy Sur Taal / cda57ed6, 2026-10-04). A Software Project Mode build paused after module 2.
// The user pressed our own "Continue building" button, which sends:
//
//     "Continue the build from where it left off and finish the remaining steps."
//
// The server did not recognise its own sentence. `isContinuationMessage` (the only door that advances a
// paused project plan) accepted "continue" and a few short phrasings, not this one, and the intent ladder
// read the NOUN "build" ("the build") as an ORDER to build — new_build at HIGH confidence, turned into an
// edit because files existed. So the plan stayed paused, the architect was handed the whole 14-module
// design as one edit, four parallel specialists each built the whole app, and the turn ran the full
// 25-minute window and ended RED: $3.35 of NavBharatAI's money on a free build.
//
// The same class as `platformFixRequest.ts` (autopsy f5351721): a prompt WE compose must never be guessed
// at. The client sends these constants; the server recognises them with `isPlatformContinuePrompt`.
//
// ⚠️ The phone apps are bundled, so an installed build keeps sending the sentence it shipped with. Never
// reword a constant here without keeping the old wording in `RETIRED_CONTINUE_PROMPTS`, or every phone
// still in use is a client the server no longer understands.
//
// PURE. Imported by client and server.

/** The "This build didn't finish" card (an interrupted build). */
export const CONTINUE_INTERRUPTED_BUILD_PROMPT = 'Continue the build from where it left off and finish the remaining steps.';

/** The budget-reached card: the user chooses to spend more. */
export const CONTINUE_PAST_BUDGET_PROMPT = 'Continue building from where you left off and finish the app — I understand this uses more of my budget.';

/** The failed-build card's "Fix with AI". */
export const CONTINUE_AND_FIX_BUILD_PROMPT = 'Continue from where you left off and finish/fix the build so the app works end-to-end.';

/** Every continuation sentence the platform sends. */
export const PLATFORM_CONTINUE_PROMPTS: readonly string[] = [
  CONTINUE_INTERRUPTED_BUILD_PROMPT,
  CONTINUE_PAST_BUDGET_PROMPT,
  CONTINUE_AND_FIX_BUILD_PROMPT,
];

/** Wordings an older installed app may still send. Empty today. */
export const RETIRED_CONTINUE_PROMPTS: readonly string[] = [];

function normalise(text: string): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const KNOWN = new Set([...PLATFORM_CONTINUE_PROMPTS, ...RETIRED_CONTINUE_PROMPTS].map(normalise));

/** Is this message one of the platform's own continuation sentences? Exact match after spacing/case. */
export function isPlatformContinuePrompt(text: string): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return KNOWN.has(normalise(text));
}
