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
import { isCodeWithoutInstruction } from '../lib/pastedSource';
export { isCodeWithoutInstruction };
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

/**
 * 🔴 A DOCUMENT IS AN ANSWER, NOT AN APP (failedbr #1420, #1430, 2026-11-20). "Create a comprehensive game design document
 * (GDD) for a mobile 3D cricket game…" was built as an app (the starter was still showing at the end), and "Design a
 * complete progression loop for a Player Career Mode… Outline the journey… Detail XP/skill trees…" ran as a build whose
 * model answered with the design document — the right answer — and was then told to "act now". The deliverable in both
 * is a DOCUMENT: written in chat, with the build offered after.
 *
 * Two shapes, both precision-first: the order's object is a document noun (a GDD, design document, PRD, specification,
 * business plan, pitch deck, essay, report, proposal — never "a document management app"), or the message is written
 * in document imperatives (two or more sentences opening with Outline / Detail / Describe / Explain / Summarize). "Design a login page" is neither, and still builds.
 */
const DOCUMENT_ORDER = /^\s*(?:please\s+)?(?:create|write|make|draft|prepare|generate|give\s+me|design)\s+(?:me\s+)?(?:a|an|the|my)?\s*(?:(?:complete|comprehensive|detailed|full|short|brief|professional|one-page)\s+)*(?:(?:game|product|technical|software|app)\s+)?(?:design\s+doc(?:ument)?|gdd|prd|spec(?:ification)?\s+doc(?:ument)?|business\s+plan|pitch\s+deck|essay|report|proposal|white\s?paper)\b(?!\s+(?:[\w-]+\s+)?(?:app|apps|application|website|tool|generator|maker|builder|system|platform|software|manager|tracker)\b)/i;
const DOCUMENT_IMPERATIVE = /(?:^|[.!?]\s+|\n\s*)(?:outline|detail|describe|explain|summari[sz]e)\s+[A-Za-z\u0900-\u097F]/gi;
export function requestsADocument(message: string): boolean {
  const text = String(message ?? '');
  if (DOCUMENT_ORDER.test(text)) return true;
  return (text.match(DOCUMENT_IMPERATIVE) ?? []).length >= 2;
}

/**
 * 🔴 "NHI BANAO" IS "DON'T BUILD" (failedbr #1270, 2026-11-20). The whole message was "Nhi banao" — do not make it — and
 * the keyword ladder read "banao" as an unmistakable order (`explicit-order`, high confidence); "mat banao" / "na banao" /
 * "abhi mat banao" confirmed too. A negation word IMMEDIATELY BEFORE the build verb is a refusal: "na" after the verb
 * ("bana do na") is the polite tag and stays an order. The order is still found anywhere else in the message, so
 * "ads mat banao, game banao" builds.
 */
const NEGATED_ORDER = /(?:^|[\s,.!?।])(?:mat|mt|nahi|nahin|nhi|nai|na|no)\s+(?:abhi\s+)?(?:banao|bnao|banaao|banaiye|banaye|banado|bana\s+do|bnado|banana|bana|karo|kro|kar\s+do|build|make|create)\b|(?:मत|नहीं|ना)\s+बना(?:ओ|इए|ना|\s+दो)?|\b(?:don'?t|do\s+not|dont|never)\s+(?:build|make|create)\s+(?:it|this|that|anything|an?\s+app|the\s+app)?\b/gi;
export function declinesTheBuild(message: string): boolean {
  const text = String(message ?? '');
  if (!new RegExp(NEGATED_ORDER.source, 'i').test(text)) return false;
  const rest = text.replace(NEGATED_ORDER, ' ');
  return !firstNewBuildOrder(rest.toLowerCase()) && !/\b(?:banao|bnao|banado|bana\s+do|banaiye|build|make|create)\b/i.test(rest);
}


/**
 * Does this turn ask whether the message itself confirms a build? A new build always; an edit only when no earlier request
 * left an app — or when the message is code with no words, which is no instruction on any app (failedbr #1278). PURE.
 */
export function buildConfirmationApplies(intent: string, earlierRequestLeftAnApp: boolean, message: string): boolean {
  if (intent === 'new_build') return true;
  return intent === 'edit_existing' && (!earlierRequestLeftAnApp || isCodeWithoutInstruction(message));
}

/** The Devanagari `बना-` family ("बनाओ", "बना दो") — the order no Roman list can see. */
const DEVANAGARI_BUILD_VERB = /बन(?:ा|वा)/;

export type BuildConfirmationReason =
  | 'explicit-order'
  | 'explicit-edit'
  | 'complete-build'
  | 'fresh-start'
  | 'pasted-source'
  | 'names-something-to-build'
  | 'asks-for-a-document'
  | 'declines-the-build'
  | 'code-without-instruction'
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
  // failedbr #1270: "nhi banao" / "mat banao" refuses the build; it never confirms one.
  if (text && declinesTheBuild(text)) return { confirmed: false, reason: 'declines-the-build' };
  if (text && isCodeWithoutInstruction(text)) return { confirmed: false, reason: 'code-without-instruction' };
  // failedbr #1420 / #1430: a document is written in chat (its reply offers the build), even after "create" / "design".
  if (text && requestsADocument(text)) return { confirmed: false, reason: 'asks-for-a-document' };
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
  // failedbr #1270: "na banao" (don't build) was a YES because "na" is a filler — as the tag AFTER a verb it is ("bana do
  // na"); BEFORE one it is the refusal. Any refusal is never an acceptance.
  if (declinesTheBuild(String(message ?? ''))) return false;
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
