// A BUILD'S OWN ENDING IS NOT AN ERROR IN THE APP — the sentences the platform writes when IT stopped a build.
//
// 🔴 THE DEFECT (autopsy 05eb30ba, 2026-11-18). A Weak build was stopped mid-way because the user's wallet
// could not cover the rest of it. The build's summary — our own sentence, "Your balance is not enough for this
// build, please recharge!" — landed in the error banner, and the "Fix with AI" button under it composed
//
//     "Fix this error and continue building the app:\n\nYour balance is not enough for this build, please recharge!"
//
// The user pressed it and an 11.7-minute build ran on our own billing notice. The model had to work out that the
// "error" was not in the app ("the recharge text is not present in the app, confirming it came from the
// platform"), and the user was told by the button that a recharge notice is something an AI edit can fix.
//
// 🔑 WHY THE EXISTING NET MISSED IT. `errorCanBeFixedByEditingTheApp` stands down for a refusal raised BEFORE the
// stream opened (autopsy fdd59ef8) and for the two reconnect refusals (BR1995). A mid-build stop comes out of the
// STREAM, as the build's summary, so neither rule saw it — and it is not one sentence but a family: every reason
// a build's abort signal can carry (`AbortCause` in src/server/AgentV3/buildAbortCause.ts) ends with its own.
//
// THE CLASS, AND THE LOCK. Every ending the platform writes for a build IT stopped is listed here by its opening,
// and `tests/aPlatformStopIsNotAnAppError.test.ts` walks EVERY `AbortCause` (with every saved/seed/minutes
// variant), the wall-clock and stalled-model endings and both wallet notices, and fails when one of them would
// still be offered "Fix with AI". A new cause whose sentence is not listed here fails that census — the next
// sibling cannot arrive silently.
//
// ⚠️ OPENINGS, NOT SUBSTRINGS. A user who QUOTES one of these sentences mid-message is talking about it; only a
// message that IS one starts with it. PURE. No I/O; imported by client and server alike.

/** How every platform-written build ending opens. Exported so the census can say which one matched. */
export const PLATFORM_STOP_NOTICE_OPENINGS: readonly string[] = [
  // the wallet (balanceRechargeNotice.ts, Affordability.ts, buildAbortCause 'wallet-empty')
  'Your balance is not enough for this build',
  'इस build के लिए आपका balance पर्याप्त नहीं है',
  // the user's own Stop (buildAbortCause 'user-stop', stopSignal.ts)
  'Stopped, as you asked.',
  'Stopped — the build was asked to stop.',
  // our clocks (watchdog, futile, timed out, a stalled model call)
  'I stopped after about ',
  'I stopped this build because it was taking too long',
  'This build stopped making progress',
  'This build was not getting anywhere',
  'A model response stalled',
  "The model didn't respond in time",
  // our engine, our platform
  "NavBharatAI's engine was running slowly",
  'NavBharatAI’s engine is running slowly',
  'NavBharatAI restarted (a deploy) while this build was running.',
  'This build was replaced by a newer one',
  'Build ownership could not be confirmed',
  'This build stopped responding and was cleaned up.',
  'This build reached its size limit',
  'Your app is built. I stopped the final polish checks early',
  // a pass's own budget
  'The final review had used its time',
  'The second look after the repair had used its time',
  'This repair had used its time',
  // aborted with no recorded cause
  'This build was stopped before it finished.',
];

/** Is this message one of the platform's own build endings? PURE. */
export function isPlatformStopNotice(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (!text) return false;
  return PLATFORM_STOP_NOTICE_OPENINGS.some((opening) => text.startsWith(opening));
}
