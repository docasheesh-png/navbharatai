/**
 * 🔴 THE NUDGE THAT OVERRODE AN ANSWER AND REWROTE A USER'S APP (autopsy 95598899, 2026-09-18).
 *
 * The user had a 35-file Qiikr classifieds marketplace in the workspace and typed:
 * *"Make a video of parrot talking about the benefits of fruits in urdu"*.
 *
 * The first model answered **correctly and completely** in 8 seconds — that NavBharatAI builds web
 * apps and cannot make videos, and did they want the Qiikr app continued, or something else? Zero
 * tool calls, `finish_reason: end_turn`. **That was the right answer, and it should have been the
 * end of the build.**
 *
 * Instead `AgentRunner`'s NUDGE-TO-BUILD fired. It exists for a real bug — a model that narrates
 * *"here's my plan… now I'll create index.html"* and never acts — and its only test for that bug is
 * `no tool calls yet`. An answer looks identical to a stall through that test. So the engine replied
 * to its own model, verbatim:
 *
 *   > *"Do NOT just describe or delegate in prose — ACT NOW … Start by writing the entry file
 *   > (e.g. index.html or src/main)."*
 *
 * **And that is exactly what happened next, to somebody else's working app**: `index.html`,
 * `src/main.tsx`, `src/App.tsx`, `src/index.css` overwritten, an `rm` attempted on `src/`, the
 * platform's injected preview bridge destroyed, the app left throwing
 * `Cannot read properties of null (reading 'useState')` — and the user charged ₹23.81 for it. They
 * had to type *"No parrot or no app, don't work on any project"* to make it stop.
 *
 * ⚠️ **THE NUDGE OUTLIVES THE MODEL IT WAS AIMED AT.** GLM produced the refusal, then timed out
 * twice and was benched; KIMI picked up the SAME transcript, read the nudge as an instruction, and
 * complied. So a nudge written for a stalling model became an order to a model that had never
 * stalled — one more reason it must never be issued against an answer.
 *
 * 🔑 THE CLASS, named so it is recognised again: **`toolUses.length === 0` is not evidence of a
 * stall.** It is equally the shape of a model that declined, asked a question, or reported that the
 * request cannot be built. Before overriding a model's judgement, the engine must ask what the turn
 * WAS, not merely count what it did.
 *
 * 🔒 THE ASYMMETRY THAT SETTLES EVERY JUDGEMENT CALL HERE, and it must not be reversed. Standing
 * down wrongly costs ONE turn: the build ends with the model's own words, `ok: false`, and — by the
 * billing law — **no charge**, and the user re-sends. Nudging wrongly costs a working app.
 */
import { looksLikeRefusal } from '../lib/promptSafety';

/** Question marks a user of this product actually types — Latin, full-width CJK, and Arabic/Urdu. */
const QUESTION_MARKS = /[?？؟]$/;

/**
 * Markdown and quoting that can sit AFTER the question mark.
 *
 * ⚠️ The first draft of this file omitted it, and its own test caught that: the real turn from
 * autopsy 95598899 ends `**Or clarify if you need something different?**` — a bold list item — so a
 * bare `/[?]$/` scored the clearest question in the whole transcript as "not a question". A model
 * writing markdown is the normal case here, not an edge one.
 */
const TRAILING_DECORATION = /[*_`)\]"'”’»]+$/;

/**
 * Emoji (and the joiners and variation selectors that build them) after a question: *"Shall I
 * continue? 🙏"*. A courtesy mark does not turn a question into a statement.
 */
const TRAILING_EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\s]+$/u;

/**
 * A closing request for the user's reply — *"let me know"*, *"बता दीजिए"*, *"batao"*. On its own it is
 * the commonest courtesy after a plan (*"I'll build it now — let me know if you want changes!"*), so
 * it counts ONLY beside a real question mark: see `turnAskedTheUser`.
 */
const INVITATION_TO_REPLY = new RegExp(
  '(?:let (?:me|us) know|tell me|please (?:confirm|reply)|just say'
  + '|बता(?:\\s*दीजिए|\\s*दीजिये|\\s*दें|\\s*दो|इए|इये|एं|एँ|ओ|ना)|बताएं|कहिए|कहें'
  + '|bata(?:\\s*dijiye|\\s*dijie|\\s*do|\\s*dena|iye|ye|yein|yen|en|o|na))'
  + '[\\s.!।॥…,:;—–-]*$',
  'iu',
);

/** A closing line that asks the user to answer, anywhere in it (the closing section must hold a question). */
const REPLY_REQUEST =
  /^(?:please\s+)?(?:reply|answer|respond|write back)\b|\b(?:let (?:me|us) know|tell me)\b|\b(?:once|when|as soon as) you (?:reply|answer|confirm|tell me|let me know|choose|pick|decide)\b/iu;

function withoutTrailingDecoration(line: string): string {
  let s = line;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(TRAILING_EMOJI, '').replace(TRAILING_DECORATION, '').trimEnd();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Did this turn ASK the user something, rather than narrate a plan it failed to carry out?
 *
 * Deliberately narrow: only the LAST non-empty line counts. A stall regularly contains a rhetorical
 * question in passing (*"Ready? Let's build it."*) and ends on an intention; a turn that genuinely
 * hands the decision back ends ON the question. Anything else is left to `looksLikeRefusal`.
 *
 * ⚠️ HONEST LIMIT: a question mark is the only cross-lingual signal here, and the build prompt
 * mirrors the user's language, so a model that asks without punctuating will not be caught by this
 * half. That is why `declined` below is a second, independent test rather than an alternative.
 */
export function turnAskedTheUser(text: string | null | undefined): boolean {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  const tail = withoutTrailingDecoration(last);
  if (QUESTION_MARKS.test(tail)) return true;
  // 🔴 A QUESTION FOLLOWED BY "PLEASE TELL ME" IS STILL A QUESTION (autopsy e6d46cde, 2026-09-30). The
  // model answered *"एक ऐप बनाओ टेलीनॉर"* with *"क्या आप इसी तरह का ऐप चाहते हैं? अगर आपके मन में कुछ और
  // है … तो बता दीजिए। 🙏"* — a question, then "if you had something else in mind, tell me". The line
  // ended on the invitation, not on the question mark, so this read it as a stall; the build was
  // nudged into an app the user had just been asked about, and their reply ("Archer Ai") arrived
  // mid-build and was never acted on.
  // A question mark in the last line with only an invitation to reply after it — or a last line that
  // IS only that invitation, right after a line ending in a question — is the turn handing the
  // decision back. *"Ready? Let's build it."* is still a stall: what follows its question is an intent.
  // 🔴 A CLOSING THAT ASKS FOR A REPLY, AFTER QUESTIONS, IS A QUESTION (autopsy 0473628e). "…2. Should I start
  // with sample tracks, or upload your own? (If uploads need saving, connect a database.)\n\nReply with your
  // must-haves and I'll get building right away." The question sits two lines up, behind a parenthetical, and
  // the closing line asks for a reply without ending on one of the phrases above, so the turn was read as a
  // stall and nudged into a build, while the same engine's previous turn, which ended on its question, was
  // left as an answer. A reply request anywhere in the closing line counts, provided the closing section
  // (the six lines before it) asks something. "Ready? Let's build it." asks for nothing and stays a stall.
  if (REPLY_REQUEST.test(tail) && lines.slice(-7, -1).some((l) => /[?？؟]/.test(l))) return true;
  if (!INVITATION_TO_REPLY.test(tail)) return false;
  if (/[?？؟]/.test(tail)) return true;
  const before = lines[lines.length - 2];
  return before !== undefined && QUESTION_MARKS.test(withoutTrailingDecoration(before));
}

/**
 * The user asked for their app as a PHONE PACKAGE — an .apk / .aab / .ipa. PURE.
 *
 * A verb of wanting or making, then the package kind (*"Make in .apk files"*, *"apk bana do"*, *"I need
 * the aab"*), or the package kind as a destination (*"in .apk"*, *"into an apk"*). "Add a download-APK
 * button" orders a feature and does not match: `add` is not one of the verbs.
 */
const PACKAGE_REQUEST = /\b(?:make|build|create|convert|export|generate|get|give|want|need|bana\w*|chahiye)\b[^.\n?]{0,40}?\.?\b(?:apk|aab|ipa)s?\b|\b(?:apk|aab|ipa)s?\s*(?:files?|bana\w*|chahiye|de\s*do|dedo|download)\b|\bin(?:to)?\s+(?:an?\s+)?\.?(?:apk|aab|ipa)\b/i;

export function asksForAppPackage(request: string | null | undefined): boolean {
  return PACKAGE_REQUEST.test(String(request ?? ''));
}

/** The names NavBharatAI's own packaging flow goes by on screen (AppKnowledgeBase: "More → Download APK"). */
const PLATFORM_PACKAGE_PATH = /\bDownload APK\b|\bAPK Builder\b|\bBuild my APK\b/i;

/**
 * Did this turn ANSWER a packaging request by pointing to NavBharatAI's own APK flow? PURE.
 *
 * 🔴 AUTOPSY 0c2a987a (2026-09-30). *"Make in .apk files"* on an existing app. The model answered
 * correctly in its first turn — More → Download APK → "Get my app ready to build" → "Build my APK now";
 * no code change is needed, because NavBharatAI builds the package itself. It was nudged twice ("ACT
 * NOW"), the empty-build retry then ran the whole build again one rung higher, and that attempt was
 * nudged once more — six model calls and 3.4 minutes for the answer the first call already gave. A
 * pointer to the platform's own feature is a FINAL answer, like a refusal or a question: the thing the
 * user asked for is not made by writing files.
 *
 * Both halves are required, which is the precision lock: the REQUEST asked for a package, and the
 * ANSWER names the platform's flow. A build that merely mentions the APK builder in passing, for a
 * request that asked for an app, is still nudged.
 */
export function turnPointedToPlatformFeature(text: string | null | undefined, request: string | null | undefined): boolean {
  return asksForAppPackage(request) && PLATFORM_PACKAGE_PATH.test(String(text ?? ''));
}

/** The model said it cannot do the thing. Reuses the repo's ONE refusal test — never a second copy. */
export function turnDeclined(text: string | null | undefined): boolean {
  return looksLikeRefusal(text);
}

export type NudgeStandDownReason = 'asked-the-user' | 'declined' | 'pointed-to-feature';

export interface NudgeDecision {
  /** true ⇒ inject `message` and give the model another turn. false ⇒ end the turn as it stands. */
  nudge: boolean;
  message: string;
  /** Set only when a nudge was possible and was deliberately withheld — for the admin report. */
  standDown?: NudgeStandDownReason;
}

/**
 * The wording is split because the old single message was written for an EMPTY workspace and is
 * destructive in an established one: *"Start by writing the entry file (e.g. index.html or
 * src/main)"* names precisely the files an existing app cannot afford to lose, and this autopsy is
 * what that costs. On an edit the nudge still says ACT NOW — it just stops dictating a rewrite.
 */
const NUDGE_FRESH =
  'You described a plan but have not created any files yet. Do NOT just describe or '
  + 'delegate in prose — ACT NOW: use the tools (write_file / write_files_batch, and run '
  + 'commands as needed) to actually create the project files this turn. Start by writing '
  + 'the entry file (e.g. index.html or src/main). Output tool calls, not a description.';

const NUDGE_EDIT =
  'You described a plan but have not changed any files yet. Do NOT just describe or delegate in '
  + 'prose — ACT NOW: use the tools (read_file, edit_file, write_file) to make the change this turn. '
  + 'This project ALREADY EXISTS: make the smallest targeted edit that satisfies the request, and do '
  + 'NOT rewrite, replace or delete the existing app or its entry files. Output tool calls, not a '
  + 'description.';

export interface NudgeInput {
  /** The turn's text. */
  text: string;
  /** False on a chat turn — the nudge never applies there. */
  expectsArtifacts: boolean;
  /** Tools called by this run so far. The nudge is only for a run that has done nothing at all. */
  totalToolUses: number;
  nudgesUsed: number;
  maxNudges: number;
  /** True when the workspace already holds an app — chooses the wording, and never the decision. */
  editingExistingApp: boolean;
  /** The user's request — read only by `turnPointedToPlatformFeature`. Absent ⇒ that test never fires. */
  request?: string;
}

export function decideBuildNudge(input: NudgeInput): NudgeDecision {
  const eligible = input.expectsArtifacts
    && input.totalToolUses === 0
    && input.nudgesUsed < input.maxNudges;
  if (!eligible) return { nudge: false, message: '' };

  // 🔒 The order is deliberate: DECLINED is checked first because it is the stronger claim and the
  // one this autopsy turned on. Either alone ends the turn.
  if (turnDeclined(input.text)) return { nudge: false, message: '', standDown: 'declined' };
  if (turnAskedTheUser(input.text)) return { nudge: false, message: '', standDown: 'asked-the-user' };
  if (turnPointedToPlatformFeature(input.text, input.request)) return { nudge: false, message: '', standDown: 'pointed-to-feature' };

  return { nudge: true, message: input.editingExistingApp ? NUDGE_EDIT : NUDGE_FRESH };
}

/** One sentence for the admin report — never user-facing, so it may name the mechanism. */
export function standDownNote(reason: NudgeStandDownReason): string {
  if (reason === 'pointed-to-feature') {
    return 'The user asked for a phone package and the model pointed to NavBharatAI\'s own APK flow, which needs no code change — so its answer was given to the user instead of being overridden with "act now". Before 2026-09-30 it was nudged twice and the whole build was retried.';
  }
  return reason === 'declined'
    ? 'The model said it cannot build what was asked, so its answer was given to the user instead of being overridden with "act now". Before 2026-09-18 the engine nudged it to write files anyway.'
    : 'The model asked the user a question, so its answer was given to the user instead of being overridden with "act now". Before 2026-09-18 the engine nudged it to write files anyway.';
}
