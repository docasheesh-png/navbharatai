/**
 * A BUILD STARTS ONLY WHEN THE USER CERTAINLY ASKED FOR ONE (admin 2026-10-03, after autopsy 3f959fde).
 *
 * Admin, verbatim: *"hamesa agar direct app banane ki jagah kuch aur line hai, koi simple text hai, koi
 * question hai, ya kuch bhi aisi baat hai, jisse app banana 100% confirm nahi hai, to pahle user ko text
 * reply dena hai, aur app banane ke bare me puchna hai!!"*
 *
 * 🔴 WHY. "Ipudu e data ni check cheyu …" (Telugu: "now check this data, which algorithm suits") with a
 * sheet attached named nothing to build. The keyword pass said so (LOW confidence), the intention reader
 * answered "build", and the route trusted it: a 17.6-minute, ₹272 build whose summary answered the
 * user's question in its last paragraph. The reader is a guess with a project in front of it. A guess is
 * not a confirmation.
 *
 * 🔒 THE RULE. A `new_build` verdict — or an "edit" of a workspace that holds nothing of the user's, which
 * is a build by another name — goes ahead only when the MESSAGE ITSELF confirms it:
 *  - an unmistakable order the keyword pass was certain of ("build a notes app", "ek billing app banao"),
 *    an explicit complete-app request, or an explicit fresh start;
 *  - pasted code or a URL the keyword pass was certain of (the pasted-app path);
 *  - otherwise: not a question, and it names something to build (an app noun, a Devanagari build verb, a
 *    build order).
 * Anything else is answered in chat, and the reply asks whether to build. A reply of "haan" to that offer
 * builds the ORIGINAL request (`isOfferAcceptance`, `OFFER_LIFETIME_MS`).
 *
 * ⚠️ The asymmetry this repo already rests on (2026-09-13): wrong toward chat costs one message and the
 * answer is useful anyway; wrong toward build costs minutes and money for something nobody asked for.
 *
 * PURE. No I/O, no clock, no env.
 */

import { isSourcePathOnly } from '../lib/sourcePathPrompt';
import {
  classifyIntentWithConfidence,
  firstNewBuildOrder,
  isExplicitCompleteBuild,
  namesSomethingToBuild,
  readsAsQuestion,
  wantsFreshStart,
} from './IntentClassifier';
import { namesNoObject } from './buildableInput';

/**
 * A WHOLE PRODUCT, as opposed to a part of one. `IntentClassifier`'s build nouns also list parts — table,
 * button, page, chart, login — which are right for "is anything buildable mentioned?" and wrong for "did
 * they ask for an app?": "check the draws in the first data TABLE" names a table, not an app (autopsy
 * a4be7fa2). On the uncertain branch, only an order or a product confirms a build.
 */
const PRODUCT_NOUN =
  /\b(?:apps?|application|website|web\s?site|site|webpage|web\s?page|portal|software|program|game|bot|tool|dashboard|landing\s+page|blog|store|shop|crm|erp|calculator|tracker|system|platform|extension|plugin)\b|ऐप|एप|वेबसाइट|सॉफ्टवेयर|गेम/i;
/**
 * 🔴 A SENTENCE ABOUT WHAT NAVBHARATAI DOES NOT MAKE IS NOT AN ORDER (failedbr #1879, 2026-11-20). "YouTube dekh raha
 * tha aur mujhe tera ad mila… tu to game banate hi nahin hai" — I saw your ad; you don't even make games — confirmed
 * a build on the word "game" alone, and a YouTube-clone roadmap with a game kit was built for a remark. The verb was
 * there, but negated and habitual ("banate … nahin", "don't make", "can't build"): a statement about the product,
 * not a request. On the uncertain branch such a message is answered in chat (whose reply offers the build); an
 * imperative beside it ("… nahin banate, ek bana do") still confirms through `firstNewBuildOrder`.
 */
const NEGATED_BUILD_STATEMENT = new RegExp([
  String.raw`\b(?:bana|bna|banaa)(?:te|ta|ti|tey)\b[^.?!।]{0,24}\b(?:nahi|nahin|nhi|nai)\b`,
  String.raw`\b(?:nahi|nahin|nhi|nai)\b[^.?!।]{0,12}\b(?:bana|bna|banaa)(?:te|ta|ti|tey|ega|egi|oge|sakte|sakta)\b`,
  String.raw`\b(?:bana|bna)\s+(?:nahi|nahin|nhi)\s+(?:sakte|sakta|sakti|paate|pata|pati)\b`,
  String.raw`\b(?:nahi|nahin|nhi)\s+(?:bana|bna)\s+(?:sakte|sakta|sakti|paate|pata|pati)\b`,
  String.raw`\b(?:you|u|it|navbharat\w*)\s+(?:guys\s+|people\s+)?(?:don'?t|doesn'?t|dont|doesnt|can'?t|cannot|never|won'?t|couldn'?t)\s+(?:even\s+)?(?:make|build|create)\b`,
  'बना(?:ते|ता|ती)[^।?!]{0,24}नहीं',
  'नहीं[^।?!]{0,12}बना(?:ते|ता|ती|एगा|एगी|ओगे)',
].join('|'), 'i');

/** The Devanagari `बना-` family ("बनाओ", "बना दो") — the order no Roman list can see. */
const DEVANAGARI_BUILD_VERB = /बन(?:ा|वा)/;

export type BuildConfirmationReason =
  | 'explicit-order'
  | 'explicit-edit'
  | 'complete-build'
  | 'fresh-start'
  | 'pasted-source'
  | 'names-something-to-build'
  | 'question'
  | 'names-nothing-to-build';

export interface BuildConfirmation {
  confirmed: boolean;
  reason: BuildConfirmationReason;
}

/** `AGENTV3_CONFIRM_BUILD=off` restores the old behaviour (the reader's verdict builds). Default ON. */
export function buildConfirmationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CONFIRM_BUILD ?? '').trim().toLowerCase() !== 'off';
}

/** Does this message itself confirm that an app should be built now? PURE. */
export function buildConfirmation(message: string): BuildConfirmation {
  const text = typeof message === 'string' ? message.trim() : '';
  // Defense in depth: a bare file location is not a build order, even if another classifier changes.
  if (isSourcePathOnly(text)) return { confirmed: false, reason: 'names-nothing-to-build' };
  const lower = text.toLowerCase();
  if (text && isExplicitCompleteBuild(text)) return { confirmed: true, reason: 'complete-build' };
  if (text && wantsFreshStart(text)) return { confirmed: true, reason: 'fresh-start' };
  const kw = classifyIntentWithConfidence(text);
  if (kw.confidence === 'high') {
    if (kw.intent === 'edit_existing') return { confirmed: true, reason: 'explicit-edit' };
    if (kw.intent === 'new_build') {
      if (kw.signal === 'code-or-url') return { confirmed: true, reason: 'pasted-source' };
      // Length alone is the weakest evidence in the ladder: a long message that names nothing to build is
      // text, not an order (the f2ff962f "call me Boss" instructions were built as an app on it).
      if (kw.signal === 'long-message') {
        return namesSomethingToBuild(text)
          ? { confirmed: true, reason: 'names-something-to-build' }
          : { confirmed: false, reason: 'names-nothing-to-build' };
      }
      return { confirmed: true, reason: 'explicit-order' };
    }
  }
  if (readsAsQuestion(lower)) return { confirmed: false, reason: 'question' };
  // BR1976: a category word ("App", "website") is not a deliverable. PRODUCT_NOUN matches `apps?`
  // and would otherwise confirm a billed invented stub. High-confidence orders and edits above are
  // unchanged — "make an app" / "app banao" stay explicit-order (the ask-what-to-build gate still
  // asks about them) and "add it to this app" stays an explicit edit.
  if (text && namesNoObject(text)) return { confirmed: false, reason: 'names-nothing-to-build' };
  // The order is looked for OUTSIDE the negated span, so "you don't even make games" is not read as "make games".
  if (NEGATED_BUILD_STATEMENT.test(text) && !firstNewBuildOrder(lower.replace(new RegExp(NEGATED_BUILD_STATEMENT.source, 'gi'), ' '))) {
    return { confirmed: false, reason: 'names-nothing-to-build' };
  }
  if (firstNewBuildOrder(lower) || DEVANAGARI_BUILD_VERB.test(text) || PRODUCT_NOUN.test(text)) {
    return { confirmed: true, reason: 'names-something-to-build' };
  }
  return { confirmed: false, reason: 'names-nothing-to-build' };
}

/** An offer to build stays answerable for this long. A "yes" a day later is about something else. */
export const OFFER_LIFETIME_MS = 6 * 60 * 60 * 1000;

/** Words that, on their own, say "yes, do it". */
const YES_WORDS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'ya', 'yah', 'sure', 'ok', 'okay', 'okk', 'okey', 'k', 'haan', 'han', 'haa', 'ha',
  'hanji', 'ji', 'theek', 'thik', 'thick', 'chalo', 'avunu', 'aama', 'ama', 'sari', 'seri', 'ho', 'houdya',
  'हाँ', 'हां', 'हा', 'जी', 'ठीक', 'అవును', 'ஆமா', 'ஆம்', 'হ্যাঁ', 'હા',
]);
/** Words that say "build it" — enough on their own, or beside a yes. */
const DO_IT_WORDS = new Set([
  'build', 'make', 'create', 'start', 'go', 'proceed', 'bana', 'banao', 'banado', 'bnao', 'bnado', 'kardo',
  'karo', 'kar', 'shuru', 'cheyyi', 'cheyi', 'cheyandi', 'pannu', 'pannunga', 'बना', 'बनाओ', 'बनाइए', 'करो', 'शुरू',
]);
/** Filler that may sit beside them without changing the answer. */
const FILLER_WORDS = new Set([
  'please', 'pls', 'plz', 'it', 'do', 'that', 'this', 'the', 'app', 'ahead', 'now', 'abhi', 'hai', 'he', 'h',
  'dijiye', 'de', 'dena', 'dijie', 'na', 'bhai', 'sir', 'boss', 'for', 'me', 'mere', 'liye', 'is',
  'ise', 'isko', 'yeh', 'ye', 'dear', 'thanks', 'thank', 'you', 'on', 'दो', 'दीजिए', 'है',
]);

/**
 * Is this short message a YES to an offer to build? Only words from the three lists above, at least one of
 * them a yes or a build verb, at most eight words. "haan, bana do" is; "haan, par pehle batao" is not —
 * the extra words are a new request, and that one goes through the ordinary path. PURE.
 */
export function isOfferAcceptance(message: string): boolean {
  const words = String(message ?? '')
    .toLowerCase()
    .split(/[\s,.!?।]+/u)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  let decisive = false;
  for (const w of words) {
    if (YES_WORDS.has(w) || DO_IT_WORDS.has(w)) { decisive = true; continue; }
    if (FILLER_WORDS.has(w)) continue;
    return false;
  }
  return decisive;
}

/** The chat reply's instruction when a build was not confirmed: answer, then offer. */
export const BUILD_OFFER_STEER =
  '\n\nThe user has NOT clearly asked for an app to be built. Answer their message itself, fully and '
  + 'helpfully, in their language — if they asked a question, answer it; if they shared data or a file, '
  + 'work with it directly. Do NOT build anything and do NOT say that you are building. Then, in ONE short '
  + 'final sentence, offer to build an app for this and say they can reply "yes" to start.';
