// THE PLATFORM MUST RECOGNISE THE WORDS IT PUT IN THE USER'S MOUTH.
//
// 🔴 THE DEFECT (Q-1037, found fixing Q-997). A build succeeds, the readiness scan has CONFIRMED that
// one requested feature was not built, and the closing message says, verbatim:
//
//     ⚠️ One thing you asked for isn't in the app yet: **search**. Reply "add it" and I'll put it in.
//
// The user replies "add it", which is the one thing the message asked them to do. MEASURED, this is
// what happens to it:
//
//     "add it"              intent=new_build  conf=low   confirmed=FALSE (names-nothing-to-build)
//     "add them"            intent=new_build  conf=low   confirmed=FALSE (names-nothing-to-build)
//     "add it please"       intent=new_build  conf=low   confirmed=FALSE (names-nothing-to-build)
//
// `add` lives only in `BUILD_SIGNALS`, the catch-all of ambiguous verbs, so the ladder calls it a NEW
// BUILD at LOW confidence; `buildConfirmation` then finds no product noun and no build order in two
// words and answers `names-nothing-to-build`; and the route turns the turn into `intent = 'chat'`
// (`routes/agentv3.ts`, the `offerToBuild` branch). So the feature is not added on that turn: the user
// is answered and offered a build they had just asked for.
//
// ⚠️ AND THIS WAS ALREADY KNOWN — written down here because finding it out AFTER building the fix is
// what not searching with the right word costs. `tests/aPromiseToTheUserHasAHandler.test.ts` (Q-997 —
// the row Q-1037 was itself found while fixing) lists "add it" as HANDLED, and its proof is deliberately
// the weaker `reachesReaderAsWork` rather than `reachesConfirmedWork`, with the case argued in its own
// comment: an "add …" order is never certain to the keyword pass, the intention reader decides it with
// the project in front of it, and with no reader an unconfirmed order is answered with an offer that a
// "yes" then builds. Every word of that is true. So this is not a promise dropped on the floor — it is
// a promise that costs a second round trip and leans on a model call, under a sentence that says "I'll
// put it in". These phrases are OURS: nothing has to be inferred about them, so nothing should be.
//
// 🔑 THE CLASS, and this repo has now written it down four times: PLATFORM-WRITTEN TEXT MUST NEVER BE
// GUESSED AT.
//   · `platformFixRequest.ts`   (autopsy f5351721) — a sentence the platform SENDS from a button.
//   · `continueBuildPrompts.ts` (autopsy cda57ed6) — the same, for "Continue building".
//   · `platformNoticeEcho.ts`   (autopsy 12511a9c) — our own notice PASTED BACK as a request; answer,
//                                never build, because our words name nothing the user asked for.
//   · this module — the fourth and last shape: a phrase the platform tells the user to TYPE. Neither of
//     the first two could cover it (nothing is sent, so there is no exact sentence on the wire), and the
//     third is its mirror image (that one must not build; this one must).
//
// ⚠️ SIBLINGS (rule 3), found by grepping every user-facing `reply "…"` in the engine rather than by
// trusting the row's single instance. Five of the nine were being guessed at:
//
//   | the phrase                | who writes it            | measured, before this module        |
//   |---------------------------|--------------------------|-------------------------------------|
//   | "add it" / "add them"     | `missingFeatureNotice`   | new_build/low → NOT confirmed ❌    |
//   | "add it to this app"      | `unrelatedRequest`       | new_build/low — confirmed only      |
//   |                           |                          | because the word "app" is a         |
//   |                           |                          | PRODUCT_NOUN, and LOW still sends   |
//   |                           |                          | it to the reader, which may differ  |
//   | "make it real"            | `fakeFeatureScan`        | new_build/HIGH — certain, and wrong |
//   | "keep my changes"         | `GreenGuard`             | chat/low — see below ⬇️             |
//
// 🔴 AND THE "keep my changes" ONE IS THE WORST OF THEM, because the module that writes it says in its
// own words why: *"Matching is EXACT-PHRASE, never a classifier: guessing wrong here either strands the
// user or restores a broken tree over a working one, and neither is worth a probabilistic win rate."*
// That is true of the RESTORE DECISION (`wantsAttemptBack`, an exact-phrase test) and it was not true of
// REACHING it. Measured: a bare "keep my changes" classifies `chat` at LOW, which makes the turn a plain
// chat turn (`routes/agentv3.ts`, `isPlainChatTurn`) that RETURNS before the restore code is reached —
// unless the LLM intention reader, consulted precisely because the confidence was low, happens to say
// `edit_existing`. So the escape hatch a user is told to trust was behind a coin toss. Registering the
// phrase removes the toss; the restore itself is untouched.
//
// ✅ ALREADY CERTAIN, SO DELIBERATELY NOT TOUCHED — recorded here so a future session does not "fix"
// what is already right: "fix it" / "fix them" / "fix these" / "fix the styling" (`fix` is an
// EDIT_SIGNAL → edit_existing/high) and "continue" (a CONTINUATION_SIGNAL → edit_existing/high).
//
// ⚠️ WHY THIS IS NOT AN `includes()`, AND THE PRECISION THAT COSTS. A phrase must be the WHOLE message
// (after normalisation and politeness), because the registry returns HIGH confidence and HIGH
// confidence SKIPS the intention reader — the hard lock that autopsy 5abad374 measured at 29 wasted
// minutes when a keyword won an argument the sentence's own grammar had lost. "add it and also build a
// new login page" must stay on the ladder, where both halves are read. The one exception is
// `wantsAttemptBack`, which is substring-matched in GreenGuard BY DESIGN ("people write 'keep my
// changes and add a login'") and is consulted here through that module rather than re-listed, so the
// two can never drift.
//
// ⚠️ WHAT IS DELIBERATELY NOT HERE: Hindi or Hinglish forms of these phrases ("add kar do", "jod do").
// They are the USER'S words, not ours, and inventing a list of them would be the guessing this module
// exists to end. They stay on the ladder at the confidence they have today.
//
// PURE. No I/O.
import { normaliseNoticeText } from './platformNoticeEcho';
import { fakeFeatureTails } from './fakeFeatureScan';

/** `missingFeatureNotice`, one missing feature. */
export const ADD_MISSING_FEATURE_REPLY_ONE = 'add it';
/** `missingFeatureNotice`, more than one. */
export const ADD_MISSING_FEATURE_REPLY_MANY = 'add them';
/** `unrelatedRequest`'s "add it here, or make a new app?" question. */
export const ADD_TO_THIS_APP_REPLY = 'add it to this app';
/** `fakeFeatureScan`'s "the key is saved, now wire it in". */
export const MAKE_IT_REAL_REPLY = 'make it real';

/**
 * What the platform means when it suggests a reply. Every one of them is an EDIT of the app that is
 * already here — which is what makes them safe to answer at HIGH confidence: there is no reading of
 * "add it" or "make it real" that creates a fresh app, so nothing is being decided by a guess.
 */
export type SuggestedReplyIntent = 'edit_existing';

export interface PlatformSuggestedReply {
  /** The exact phrase the platform tells the user to type. */
  readonly phrase: string;
  /** What it means. */
  readonly intent: SuggestedReplyIntent;
  /** The module that writes it, so the pair can be found from either side. */
  readonly composedBy: string;
}

/**
 * 🔴 AND THE PHRASE IS NOT ALWAYS IN ENGLISH — the sibling that nearly got away (measured 2026-10-17).
 *
 * `fakeFeatureScan` writes its closing line in **twelve** languages, and each one tells the user to type
 * a phrase in THEIR language: Hindi "असली बनाओ", Tamil "உண்மையாக்கு", Telugu "నిజం చేయి", and nine more.
 * Registering only the English "make it real" would have left eleven of the twelve exactly as broken as
 * "add it" was — and the ladder treats them very differently, which is why counting on it is the bug:
 * the Hindi one survives today only INCIDENTALLY, because `बनाओ` happens to match the Devanagari build
 * verb in `buildConfirmation`, while the Tamil one matches no signal at all and ends as chit-chat.
 *
 * ⚠️ The phrases are EXTRACTED from that module's own strings, never retyped here. A list of twelve
 * translations typed into a second file is the drift this module exists to end, and a thirteenth
 * language would be added there and forgotten here. `tests/thePlatformKnowsItsOwnSuggestedReplies.test.ts`
 * holds the two halves together: every tail must yield exactly one quoted phrase, and that phrase must be
 * registered.
 */
const QUOTED = /[“"„]([^“”"„‟]{2,40})[”"‟]/g;

function phrasesInTails(): string[] {
  const found: string[] = [];
  for (const tail of fakeFeatureTails()) {
    for (const m of String(tail ?? '').matchAll(QUOTED)) {
      const phrase = m[1].trim();
      if (phrase) found.push(phrase);
    }
  }
  return found;
}

export const PLATFORM_SUGGESTED_REPLIES: readonly PlatformSuggestedReply[] = [
  { phrase: ADD_MISSING_FEATURE_REPLY_ONE, intent: 'edit_existing', composedBy: 'missingFeatureNotice.ts' },
  { phrase: ADD_MISSING_FEATURE_REPLY_MANY, intent: 'edit_existing', composedBy: 'missingFeatureNotice.ts' },
  { phrase: ADD_TO_THIS_APP_REPLY, intent: 'edit_existing', composedBy: 'unrelatedRequest.ts' },
  ...phrasesInTails().map((phrase) => ({ phrase, intent: 'edit_existing' as const, composedBy: 'fakeFeatureScan.ts' })),
];

/**
 * Politeness a real person adds to a two-word instruction. Stripped from either end, repeatedly, so
 * "please add it" and "add it please thanks" are the same instruction as "add it".
 *
 * ⚠️ These are not build words and must never become one: `karo` / `kar do` / `do` are stripped as
 * TRAILING politeness on a phrase that already names the action ("add it karo"), never read as the
 * action themselves — an object-less "karo" on its own normalises to the empty string and matches
 * nothing, which is the behaviour #3039 owns.
 */
const POLITENESS = new Set([
  'please', 'pls', 'plz', 'kindly', 'thanks', 'thank', 'you', 'thankyou', 'ty',
  'ok', 'okay', 'yes', 'ha', 'haan', 'han', 'ji', 'bhai', 'sir', 'na', 'to', 'toh',
  'karo', 'kardo', 'kar', 'do', 'dijiye', 'de', 'dena',
]);

const PHRASES: ReadonlyMap<string, PlatformSuggestedReply> =
  new Map(PLATFORM_SUGGESTED_REPLIES.map((r) => [normaliseNoticeText(r.phrase), r]));

/**
 * The message reduced to the instruction inside it: markdown, case and spacing set aside by the
 * normaliser this repo already has (`platformNoticeEcho.ts` — one normaliser, not a fourth copy),
 * then surrounding quotation marks, trailing punctuation and politeness removed.
 *
 * A user who is shown `Reply "add it"` quite often types the quotes too.
 */
export function suggestedReplyKey(text: string): string {
  let words = normaliseNoticeText(text)
    .replace(/[“”„‟"'‘’]/g, ' ')
    .replace(/[.!?,;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let trimmed = true;
  while (trimmed && words.length) {
    trimmed = false;
    if (POLITENESS.has(words[0])) { words = words.slice(1); trimmed = true; }
    if (words.length && POLITENESS.has(words[words.length - 1])) { words = words.slice(0, -1); trimmed = true; }
  }
  return words.join(' ');
}

/**
 * Is this whole message one of the replies the platform told the user to type? Returns the registered
 * entry, so the caller states OUR meaning rather than deriving one. PURE.
 */
export function platformSuggestedReply(text: string): PlatformSuggestedReply | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  return PHRASES.get(suggestedReplyKey(text)) ?? null;
}
