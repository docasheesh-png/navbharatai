// THE PLATFORM MUST RECOGNISE ITS OWN VOICE — one string, written once, read by both sides.
//
// 🔴 THE DEFECT (autopsy f5351721, 2026-09-17). A paying user pressed "Fix error" on a failed
// preview. NavBharatAI composed the prompt itself:
//
//     "The in-browser preview failed to BUILD with this error: … fix it so the app BUILDS and runs."
//
// The engine then diagnosed it correctly in twelve minutes — the dev server had died, no file needed
// changing — said so, and closed out the plan. The platform read that zero-file outcome as a FAILURE,
// announced "First attempt produced no files", and re-ran the whole build. 23 further minutes,
// 35.6 in total, ₹261.77, for work that was finished at minute 12. (It also claimed the retry used "a
// stronger model"; every one of the 30 calls was the same model.)
//
// WHY. `userAskedForAnAppToBeBuilt` decides whether a zero-file turn may be called a failure. It
// stands down for a CONTINUATION phrase or a PROBLEM phrase — and `PROBLEM_SIGNALS` is a list of how a
// HUMAN says a thing is broken ("doesn't work", "blank screen", "nahi chala"). This text is not human
// prose; it is a pasted MACHINE error. It contains no entry from that list and it contains the word
// "build" twice, so the ladder answered `new_build` at HIGH confidence — of our own sentence.
//
// 🔑 THE FIX IS NOT A BETTER GUESS. A prompt WE generate should never have to be guessed at. The
// template now lives here, and both sides use it: the client BUILDS the message with
// `platformFixRequestPrompt`, the server RECOGNISES it with `isPlatformFixRequest`. One string, so the
// two cannot drift — which is the whole difference between a contract and brittle string-matching.
//
// ⚠️ WHY NOT JUST WIDEN `PROBLEM_SIGNALS`: that list is read in TWO places — this guard AND intent
// routing (`IntentClassifier` step 4), where a match returns `edit_existing` at HIGH confidence.
// Adding "error"/"failed" there would route *"what does this error mean?"* into the build lane at a
// confidence the LLM reader cannot overturn — re-opening the 29-minute "a question built an app" class
// the READ THE MOOD FIRST rule exists to prevent. Fixing one problem by creating another is forbidden.
//
// PURE. No I/O. Imported by client and server alike (60 server files already import from `src/lib/`).

/**
 * The opening line of the platform's own preview-fix request.
 *
 * ⚠️ Changing this string changes what the server recognises. It is matched, not merely displayed —
 * if it is reworded, reword it HERE and both sides move together. A copy pasted into a component is
 * exactly the drift this module exists to end (`tests/platformFixRequest.test.ts` reads the client
 * files and fails if either one hard-codes the sentence again).
 */
export const PLATFORM_FIX_REQUEST_PREFIX = 'The in-browser preview failed to build with this error:';

/**
 * The opening line of the platform's ANDROID build-failure request — the SAME class, found by hunting
 * siblings (rule 3) and confirmed with the real guard: it read `true` too, and this one is dispatched
 * with `autoSend: true`, so it starts a build without the user pressing anything.
 *
 * Composed server-side in `routes/mobileShip.ts` (`failureReport`), which imports this constant so the
 * sentence has one definition here rather than a copy there.
 */
export const ANDROID_BUILD_FIX_PREFIX = 'My Android build failed on GitHub.';

/**
 * Every opening line NavBharatAI itself writes. A prompt we compose must never be guessed at, so each
 * new platform-composed template adds its prefix HERE — and inherits the stand-down for free.
 */
/**
 * 🔴 THE THIRD TEMPLATE, AND IT COST A WHOLE BUILD (autopsy fdd59ef8, 2026-09-17).
 *
 * The "Fix with AI" button beside a build error composes this and drops it in the composer. It was
 * not in this list, so `isPlatformFixRequest` answered FALSE for it — and the message it had wrapped
 * was **our own sign-in notice**: *"Please sign in to build with NavBharatAI Pro."* The builder was
 * handed that as an app request, scored it `debugging` at complexity 45, spent 76 seconds and a
 * sandbox on it, and the model — correctly — replied *"I need to sign in first"* and stopped.
 *
 * This is the exact extension #2987 said this file was for: *"a new platform template inherits the
 * stand-down by adding one prefix."* The design was right; the template was never migrated to it.
 */
export const FIX_ERROR_AND_CONTINUE_PREFIX = 'Fix this error and continue building the app:';

/** Compose the "Fix with AI" prompt. The ONE place this sentence exists. */
export function fixErrorAndContinuePrompt(errorText: string): string {
  return `${FIX_ERROR_AND_CONTINUE_PREFIX}\n\n${String(errorText ?? '')}`;
}

export const PLATFORM_COMPOSED_PREFIXES: readonly string[] = [
  PLATFORM_FIX_REQUEST_PREFIX,
  ANDROID_BUILD_FIX_PREFIX,
  FIX_ERROR_AND_CONTINUE_PREFIX,
];

/** The closing instruction, kept beside the prefix so the whole template has one home. */
export const PLATFORM_FIX_REQUEST_SUFFIX =
  'Please find the cause in the project files and fix it so the app builds and runs.';

/** Compose the platform's preview-fix request around a captured error. PURE. */
export function platformFixRequestPrompt(errorText: string): string {
  return `${PLATFORM_FIX_REQUEST_PREFIX}\n\n${String(errorText ?? '')}\n\n${PLATFORM_FIX_REQUEST_SUFFIX}`;
}

/**
 * Did NavBharatAI itself compose this message? PURE.
 *
 * Deliberately anchored to the START of the trimmed message: the prefix is how the template opens, and
 * a user who happens to QUOTE that sentence mid-message is discussing it, not being it. Case-insensitive
 * because nothing downstream guarantees the original casing survives.
 */
export function isPlatformFixRequest(message: string | null | undefined): boolean {
  const text = String(message ?? '').trim().toLowerCase();
  if (!text) return false;
  return PLATFORM_COMPOSED_PREFIXES.some((p) => text.startsWith(p.toLowerCase()));
}

/**
 * Machine error text a HUMAN asking for a new app would not write — the same class as the button, but
 * typed by the user pasting their own console output.
 *
 * 🔒 PRECISION-FIRST, and the list is short on purpose. Each entry is a multi-word phrase emitted by a
 * toolchain; none of them is something a person says when they want an app built. Single words that
 * could appear in a genuine request ("error", "failed", "fix") are deliberately ABSENT — "build me a
 * dashboard that shows error rates" must keep its today answer.
 *
 * ⚠️ Read ONLY by `userAskedForAnAppToBeBuilt`, never by intent routing — see the header for why that
 * separation is load-bearing.
 */
export const MACHINE_ERROR_SIGNALS: readonly string[] = [
  'failed to build', 'failed to compile', 'failed to connect', 'failed to resolve',
  'cannot find module', 'module not found', 'is not defined', 'is not a function',
  'unexpected token', 'unhandled rejection', 'uncaught typeerror', 'uncaught referenceerror',
  'stack trace', 'command failed with exit code',
];

/** Does this message carry pasted machine error output? PURE. */
export function looksLikeMachineError(message: string | null | undefined): boolean {
  const text = String(message ?? '').toLowerCase();
  if (!text.trim()) return false;
  return MACHINE_ERROR_SIGNALS.some((s) => text.includes(s));
}

/**
 * 🔴 AN ERROR THE SERVER RAISED *BEFORE THE BUILD STARTED* IS NEVER ABOUT THE USER'S CODE.
 *
 * Autopsy fdd59ef8: a 401 ("please sign in") was shown in the build-error banner with a **"Fix with
 * AI"** button under it, exactly as a syntax error would be. The button pre-filled the composer with
 * our own notice; the user sent it; a build ran on it.
 *
 * 🔑 WHY THIS IS A STRUCTURAL TEST AND NOT A KEYWORD LIST. The refusals that produce these errors are
 * returned with `res.status(...).json(...)` BEFORE `flushHeaders` — no stream, no sandbox, no build,
 * not one file touched. So "is there any app code this error could refer to?" has a definitive answer
 * that needs no vocabulary: **no**. A list of message phrases or error codes would need a new entry
 * for every future refusal, and would be wrong the first time somebody forgot one — which is precisely
 * how the sign-in case arrived, since the client already had an `errorCode` branch and `signin` had
 * simply never been added to it.
 *
 * ⚠️ DELIBERATELY NARROW. It answers only for the pre-start case. An error that came out of the BUILD
 * STREAM may well be about the app, so it keeps today's behaviour — the button still appears. Hiding a
 * useful button on a real code error is a small annoyance; offering it on our own operational notice
 * is what fed the builder its own voice.
 */
export function errorCanBeFixedByEditingTheApp(opts: {
  /** True when the failure came from an HTTP refusal raised before the build stream opened. */
  beforeBuildStarted?: boolean;
  message?: string | null;
}): boolean {
  if (opts.beforeBuildStarted) return false;
  return String(opts.message ?? '').trim() !== '';
}
