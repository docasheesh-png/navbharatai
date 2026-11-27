// THE CATEGORIES THAT ARE NEVER ALLOWED — and the ones that only need the 18+ switch.
//
// ADMIN 2026-09-12: "Us scanner me illegal categories jodo — CSAM ke signals, hathiyar/dhamaka, drug
// bazaar, non-consensual images, nudity. Sirf saaf-saaf wale cases par publish BLOCK karo. Baaki par
// insaan ki review." Phase 5 of the agreed safety plan.
//
// ── TWO TIERS, AND THE SPLIT IS THE WHOLE DESIGN ─────────────────────────────────────────────────
// `illegal` → BLOCKED for everyone, always, whatever any setting says. `adult` → lawful, and governed
// by the +18 switch built in Phase 2 (which is exactly why that switch shipped first: a nudity
// detector with no legitimate path would have taken a dating app, an anatomy teaching app or a
// life-drawing reference away from an adult who is allowed to build it).
//
// ── 🔒 WHY THESE ARE CO-OCCURRENCE RULES AND NOT A DICTIONARY OF BAD WORDS ───────────────────────
// A bare word list is wrong twice over. It FALSE-POSITIVES constantly — "bomb" appears in a news
// reader, a cricket app and half the Hinglish on the internet; a pharmacy app lists controlled
// medicines for a living — and taking somebody's finished app away over one word is the bug that
// teaches an admin to switch the whole gate off. And for the worst category it would be actively
// harmful: shipping a list of CSAM slang in a source file publishes a lookup table for the people
// we are trying to stop, and puts that vocabulary into a repository forever.
//
// So each rule needs TWO independent signals — a subject AND a context — which is what an actual
// offending page has and an innocent mention does not.
//
// ── 🔴 AND "IN THE SAME APP" WAS THE BUG: THE HALVES MUST SIT TOGETHER IN A PHRASE (Q-3560) ───────
// Admin report 2026-11-26: a plain cricket game was refused from App Mart as CSAM. The publish text is
// EVERY source file, and the pairing used to be "subject anywhere AND context anywhere" — so three.js's
// `object.children` in one kit file and the word "hardcore" in a code comment of another, hundreds of
// kilobytes apart, became "an app pairing a child with sexual words". Every kit-built 3D game carried
// that pair. Whole-document co-occurrence of two word lists over source code is not evidence.
//
// What an offending page cannot avoid is the two halves CLOSE TOGETHER in a phrase a person reads —
// the offer, the label, the search box. So on the publish path (`classifyPublishedFiles`) a pair counts
// only when (1) both halves are in the same FILE, (2) in the same code statement
// (`SEGMENT_BREAK`), (3) within `PAIR_WINDOW` characters of each other, and (4) neither half is a code
// identifier (`obj.children`, `child.position`, `children[0]`). The protective stand-down still reads
// the whole app, exactly as before. Prompt triage (`promptSafety.ts`) is a separate policy and keeps
// its own whole-message test, unchanged.
//
// ── 🔴 AN HONEST LIMIT, STATED RATHER THAN HIDDEN (fourth absolute rule, step 6) ─────────────────
// This reads TEXT. It cannot see images. Real CSAM detection is perceptual image hashing against
// NCMEC/PhotoDNA-class databases, which NavBharatAI does not have access to and cannot fake — so an
// image-only offence passes this scanner. That is an OPEN ROOT CAUSE, not a solved problem, and it
// is recorded as one. What this does catch is the text an offending app carries around its images:
// the offer, the label, the search box. That is worth having and is not the same as protection.
//
// PURE + deterministic + bounded. No model call, so a clean publish costs nothing.

import { INDIC_RULE_WORDS, indicAlternatives, type ScriptWords } from './indicSafetyWords';

/** What a finding says about the app as a whole. */
export type PublishContentClass = 'general' | 'adult' | 'illegal';

export interface IllegalRule {
  id: string;
  /** `illegal` blocks unconditionally; `adult` is governed by the user's own +18 setting. */
  contentClass: Exclude<PublishContentClass, 'general'>;
  /** What an admin reads. Plain, specific, and free of the matched text. */
  description: string;
  /** BOTH must match, in the same app, for the rule to fire. */
  subject: RegExp;
  context: RegExp;
  /**
   * The ILLICIT-PURPOSE signal, for a REQUEST rather than a page (`promptSafety.ts`).
   *
   * 🔴 THIS FIELD EXISTS BECAUSE THE FIRST DESIGN FAILED ITS OWN TESTS. The prompt checker began by
   * pairing `subject` with a generic "is this a request?" pattern (build / make / write / app /
   * site). On an APP BUILDER every message contains those words, so the pair degenerated into the
   * single-signal rule this whole file exists to avoid — and it flagged "build me a school
   * attendance app for children", "a pharmacy app that lists ketamine", "a de-addiction helpline for
   * people struggling with heroin" and "a chemistry lesson about how a detonator works".
   *
   * A request verb carries NO information here. What separates "a marketplace for heroin" from "a
   * helpline for heroin addiction" is the word *marketplace*, not the word *app*. So each rule names
   * the narrow purpose that makes the request illicit — and a rule with no honest way to express
   * that (CSAM: there is no benign request pairing children with sexual content, so `context` is
   * already the whole test) simply omits it and never reaches the weaker tier at all.
   */
  intent?: RegExp;
  /**
   * A context that makes the subject INNOCENT, cancelling the rule outright.
   *
   * Added 2026-09-13 with the pornography ban. The refusal the admin wrote is deliberately blunt — it
   * tells the person NavBharatAI does not want them — which is exactly right for someone who asked
   * for a porn site and a disaster for a doctor building a sexual-health app or an NGO building a
   * harassment-reporting tool. A rule whose refusal is harsh must be able to stand down.
   */
  exempt?: RegExp;
  /**
   * A PROTECTIVE purpose that stands an ILLEGAL rule down — but only while no unambiguously sexual
   * word is present (queue Q-320, admin chose option (b) on 2026-10-04).
   *
   * 🔴 WHY: the CSAM and NCII rules had no stand-down, so "build an app to report child sexual abuse",
   * "POCSO awareness app", "sex education app for kids" and "an app that detects deepfake photos" were
   * refused with the AUP message and logged as the offence itself. `exempt` could not be reused: on
   * these rules "child sexual abuse" IS the name of the offence, so a plain stand-down on "report" or
   * "prevention" would open a hole a single word wide.
   *
   * 🔒 THE CONDITION THAT CLOSES THE HOLE: `unambiguous` names the words a protective app has no reason
   * to use (porn, nude, naked, xxx, erotic, sexy, "sexual videos", "undress", "make a deepfake") and the
   * stand-down never applies when one is present. A request that carries such a word is refused exactly
   * as before, however protective it sounds.
   *
   * ⚠️ The other nine Indian scripts carry only transliterated LOANWORDS as protective words (Q-344, admin
   * 2026-10-04) — report, helpline, POCSO, detect, awareness — because native words need a native reader.
   * Their unambiguous words (porn, obscene, naked, "sex" beside a medium, undress, "make a deepfake") are
   * read the same way, so a guessed word there can only make the rule stricter.
   */
  protective?: { purpose: RegExp; unambiguous: RegExp };
}

/** Does this rule's protective purpose stand it down for `body` (already normalised)? PURE. */
export function protectiveStandDown(rule: IllegalRule, body: string): boolean {
  if (!rule.protective) return false;
  return rule.protective.purpose.test(body) && !rule.protective.unambiguous.test(body);
}

/**
 * DEVANAGARI — the same rules, read in the script half the country types in (queue Q-102, 2026-10-04).
 *
 * 🔴 WHY THIS EXISTS: every pattern below was ASCII, so "पोर्न साइट बनाओ" was ALLOWED while
 * "porn site banao" was refused. Measured, not assumed. The ban the admin wrote in Hindi could be
 * walked past by asking in Hindi.
 *
 * 🔒 WHY THE LATIN `\b` CANNOT SIMPLY BE REUSED: JavaScript's `\b` is an ASCII boundary, and every
 * Devanagari letter is a "non-word" character to it, so `\bपोर्न\b` never matches anything. A
 * Devanagari word starts where the previous character is neither a Devanagari letter nor a word
 * character; that is `DEVA_START`. There is no right boundary by default, because Hindi inflects by
 * adding vowel signs (पोर्न → पोर्नोग्राफी, बच्चा → बच्चों): a stem must match its forms. A stem that
 * is also the start of an innocent word carries its own `END` (मेथ is the drug, मेथी is fenugreek).
 *
 * 🔒 THE SAME PAIRING, THE SAME PRECISION. Each list mirrors its English twin. Nothing here is a
 * bare bad-word list, and the stand-down words for ADULT_CONTENT are mirrored too, so a Hindi
 * sexual-health clinic or a harassment-reporting tool is never shown the ban.
 *
 * Every other Indian script (and Urdu) is read too, from `indicSafetyWords.ts` (Q-321): the same
 * fields, the same pairing, one list per script. A word there starts where the previous character is
 * not a letter of ANY of those scripts (`INDIC_START`).
 */
const DEVA_START = '(?<![\\w\\u0900-\\u097F])';
const END = '(?![\\u0900-\\u097F])';
/** An optional nukta. After NFC a nukta letter (फ़, ड़, ज़) is always the base letter plus U+093C. */
const NUKTA = '\\u093C?';

const INDIC_START = '(?<![\\w\\u0600-\\u06FF\\u0750-\\u077F\\u0900-\\u0DFF])';

function withDevanagari(latin: RegExp, devanagari: readonly string[], other?: ScriptWords): RegExp {
  const indic = other ? `|${INDIC_START}(?:${indicAlternatives(other).join('|')})` : '';
  return new RegExp(`(?:${latin.source})|${DEVA_START}(?:${devanagari.join('|')})${indic}`, 'i');
}

const W = INDIC_RULE_WORDS;

/**
 * The form both consumers scan. NFC, so a nukta written as one code point (फ़ U+095E) and as two
 * (फ + ़) read the same; and zero-width characters removed, so "p​orn" or a ZWJ inside a
 * Devanagari word cannot split a word in two and walk past every pattern. Pure.
 */
export function normalizeScanText(text: string): string {
  return text.normalize('NFC').replace(/[​-‍⁠﻿]/g, '');
}

/**
 * Q-320 — the words of the protective stand-down (see `protective` on IllegalRule).
 *
 * `SEXUAL_UNAMBIGUOUS` is what a child-protection or detection app has no reason to say. "sex" and
 * "sexual" alone are NOT in it — "report child sexual abuse" and "sex education" need both — but
 * "sexual videos", "sex chat" and the like are. The other nine scripts read their own lists from
 * `indicSafetyWords.ts` (Q-344): protective LOANWORDS only (report, helpline, POCSO, detect, awareness),
 * and the same unambiguous words — so a request using only native protective words stays strict.
 */
const SEXUAL_UNAMBIGUOUS_LATIN =
  'porn\\w*|nud(?:e|es|ity)|naked|xxx|erotic\\w*|sexy|hardcore|sexting|'
  + '(?:explicit|sexual|sex)\\s+(?:photos?|pictures?|pics?|images?|videos?|clips?|content|stories|story|chats?|roleplay|role[-\\s]play|acts?|material)';
const SEXUAL_UNAMBIGUOUS_DEVA = [
  'पोर्न', 'पॉर्न', 'नग्न', 'नंगी', 'नंगा' + END, 'एक्सएक्सएक्स', 'कामुक', 'अश्लील',
  '(?:सेक्स|यौन)\\s*(?:वीडियो|फ' + NUKTA + 'ोटो|तस्वीर|चैट|कहानी|सामग्री|कंटेंट)',
];
const CSAM_PROTECTIVE = {
  purpose: withDevanagari(
    /\b(report\w*|prevent\w*|awareness|aware|pocso|helplines?|protect\w*|safety|safeguard\w*|detect\w*|educat\w*|ngos?|police|complaints?|moderat\w*|filter\w*|block(?:s|er|ers|ing|ed)?|counsel\w*)\b/i,
    ['रिपोर्ट', 'शिकायत', 'रोकथाम', 'रोकन', 'रोकने', 'जागरूक', 'पॉक्सो', 'पोक्सो', 'हेल्पलाइन', 'सुरक्षा', 'सुरक्षित', 'बचाव', 'बचान', 'बचाने', 'डिटेक्ट', 'पहचान', 'शिक्षा', 'शैक्षिक', 'पुलिस', 'एनजीओ', 'फ' + NUKTA + 'िल्टर', 'ब्लॉक', 'परामर्श', 'काउंसलिंग'],
    W.CSAM_SIGNAL.protective,
  ),
  unambiguous: withDevanagari(
    new RegExp(`\\b(?:${SEXUAL_UNAMBIGUOUS_LATIN})\\b`, 'i'),
    SEXUAL_UNAMBIGUOUS_DEVA,
    W.CSAM_SIGNAL.unambiguous,
  ),
};

const NCII_PROTECTIVE = {
  purpose: withDevanagari(
    /\b(detect\w*|report\w*|awareness|verif\w*|fact[-\s]?check\w*|identif\w*|spot(?:s|ting)?|authentic\w*|take[-\s]?downs?|complaints?|protect\w*|prevent\w*|educat\w*|police|helplines?)\b/i,
    ['पहचान', 'डिटेक्ट', 'रिपोर्ट', 'शिकायत', 'जागरूक', 'सत्यापन', 'जाँच', 'जांच', 'फ' + NUKTA + 'ैक्ट\\s*चेक', 'बचाव', 'सुरक्षा', 'रोकथाम', 'पुलिस', 'हेल्पलाइन', 'शिक्षा'],
    W.NON_CONSENSUAL_IMAGERY.protective,
  ),
  // The sexual words, the undressing subjects, and any request to MAKE a fake (a detector never says so).
  unambiguous: withDevanagari(
    new RegExp(
      `\\b(?:${SEXUAL_UNAMBIGUOUS_LATIN}|nudif\\w*|undress\\w*|upskirt|hidden[-\\s]?cams?|`
      + '(?:remove|take\\s+off)\\s+(?:her\\s+|his\\s+|their\\s+|the\\s+)?clothes|'
      + '(?:make|making|create|creating|generate|generating)\\s+(?:a\\s+|an\\s+)?(?:deep[-\\s]?fakes?|face[-\\s]?swaps?)|'
      + '(?:deep[-\\s]?fakes?|face[-\\s]?swaps?)\\s+(?:generator|maker|creator|editor)s?)\\b',
      'i',
    ),
    [
      ...SEXUAL_UNAMBIGUOUS_DEVA, 'न्यूडिफ', 'कपड' + NUKTA + 'े\\s+उता', 'हिडन\\s+कैम', 'छिप' + '[ाे]' + '\\s+कैमर',
      'डीप\\s*फ' + NUKTA + 'े' + 'क\\s+(?:बना|जनरेटर)', 'फ' + NUKTA + 'े' + 'स\\s*स्वैप\\s+(?:बना|जनरेटर)',
    ],
    W.NON_CONSENSUAL_IMAGERY.unambiguous,
  ),
};

/**
 * The rules.
 *
 * Every pattern uses word boundaries so it cannot fire inside an identifier (`bombardElement`,
 * `nudeColorPalette`), and every one is paired. Read them as a sentence: "this app talks about X,
 * AND it is doing Y with it".
 */
export const ILLEGAL_RULES: readonly IllegalRule[] = [
  {
    id: 'CSAM_SIGNAL',
    contentClass: 'illegal',
    description:
      'pairs words describing a child with explicitly sexual words. This is the one category we act on without waiting.',
    // Deliberately plain, ordinary English on both sides. A slang dictionary would be a lookup table
    // for offenders; the STRUCTURE is what an offending page cannot avoid having.
    subject: withDevanagari(
      /\b(child|children|kid|kids|minor|minors|underage|under[-\s]?18|preteen|pre[-\s]?teen|toddler|infant|schoolgirl|schoolboy)\b/i,
      ['बच्च', 'नाबालिग', 'बालक', 'बालिका', 'शिशु', 'छोटी\\s+बच्च', '18\\s*साल\\s*से\\s*कम'], W.CSAM_SIGNAL.subject,
    ),
    // नंगे is deliberately absent: "नंगे पैर" means barefoot, and "बच्चे नंगे पैर स्कूल जाते हैं" is a
    // sentence about poverty, not an offence.
    context: withDevanagari(
      /\b(porn|pornography|nude|nudes|naked|sex|sexual|sexy|erotic|xxx|hardcore|explicit)\b/i,
      ['पोर्न', 'पॉर्न', 'सेक्स', 'यौन', 'अश्लील', 'नग्न', 'नंगी', 'नंगा' + '(?![\\u0900-\\u097F])', 'एक्सएक्सएक्स', 'कामुक'], W.CSAM_SIGNAL.context,
    ),
    protective: CSAM_PROTECTIVE,
  },
  {
    id: 'NON_CONSENSUAL_IMAGERY',
    contentClass: 'illegal',
    description:
      'offers to undress or sexualise a real person from their photograph, or to publish intimate images without consent.',
    // `nudif\w*` rather than `nudify`: the first version missed "nudifies"/"nudified" — a word-boundary
    // rule that stops at the stem is a rule an ordinary sentence walks past.
    subject: withDevanagari(
      /\b(nudif\w*|undress\w*|deep[-\s]?fakes?|face[-\s]?swaps?|revenge[-\s]?porn|upskirt|hidden[-\s]?cam)\b/i,
      ['डीप\\s*फ' + NUKTA + 'े' + 'क', 'फ' + NUKTA + 'े' + 'स\\s*स्वैप', 'न्यूडिफ', 'कपड' + NUKTA + 'े\\s+उता', 'रिवेंज\\s+पोर्न', 'हिडन\\s+कैम', 'छिप' + '[ाे]' + '\\s+कैमर'], W.NON_CONSENSUAL_IMAGERY.subject,
    ),
    context: withDevanagari(
      /\b(photo|photos|picture|pictures|image|images|video|videos|selfie|her|girlfriend|wife|ex)\b/i,
      ['फ' + NUKTA + 'ोटो', 'तस्वीर', 'इमेज', 'वीडियो', 'सेल्फी', 'गर्लफ्रेंड', 'पत्नी', 'बीवी'], W.NON_CONSENSUAL_IMAGERY.context,
    ),
    // Asking to build one IS the illicit purpose — there is no benign "undress any photo" tool.
    intent: withDevanagari(
      /\b(app|tool|site|website|bot|service|generator)\b/i,
      ['ऐप', 'एप' + END, 'टूल', 'साइट', 'वेबसाइट', 'बॉट', 'सर्विस', 'जनरेटर'], W.NON_CONSENSUAL_IMAGERY.intent,
    ),
    protective: NCII_PROTECTIVE,
  },
  {
    id: 'WEAPON_MANUFACTURE',
    contentClass: 'illegal',
    description:
      'gives instructions for making a weapon or an explosive device, rather than merely mentioning one.',
    // Plurals matter: `ghost gun` alone missed "ghost guns", which is how the phrase is usually written.
    // `desi katta` / `tamancha` are India's country-made pistols — the ghost gun of this market.
    subject: withDevanagari(
      /\b(pipe[-\s]?bombs?|ieds?|improvised[-\s]?explosives?|pressure[-\s]?cooker[-\s]?bombs?|detonators?|blasting[-\s]?caps?|ghost[-\s]?guns?|untraceable[-\s]?(guns?|firearms?)|silencers?|suppressors?|desi[-\s]?katt[ae]s?|tamanch[ae]s?)\b/i,
      ['पाइप\\s*बम', 'प्रेशर\\s*कुकर\\s*बम', 'आईईडी', 'डेटोनेटर', 'देसी\\s*कट्ट', 'देशी\\s*कट्ट', 'तमंच', 'देसी\\s*बम', 'देशी\\s*बम'], W.WEAPON_MANUFACTURE.subject,
    ),
    // The instructional half — a news report about a bomb has the subject and never this.
    context: withDevanagari(
      /\b(how[-\s]to[-\s]make|step[-\s]by[-\s]step|instructions|tutorial|recipe|assemble|build[-\s]your[-\s]own|materials[-\s]needed|ingredients)\b/i,
      ['बनाने\\s+का\\s+तरीक', 'बनाने\\s+की\\s+विधि', 'कैसे\\s+बना', 'घर\\s+पर\\s+बना', 'स्टेप\\s+बाय\\s+स्टेप', 'निर्देश', 'ट्यूटोरियल', 'जरूरी\\s+सामान', 'ज' + NUKTA + 'रूरी\\s+सामान'], W.WEAPON_MANUFACTURE.context,
    ),
    // NOT "write me a …": a chemistry lesson explaining a detonator is a legitimate request. Only
    // evasion or trade makes it illicit.
    intent: withDevanagari(
      /\b(untraceable|undetectable|evade|bypass[-\s]detection|black[-\s]?market|dark[-\s]?web|without[-\s]a[-\s]licen[cs]e|no[-\s]licen[cs]e|sell|selling|dealer)\b/i,
      ['बेच', 'ब्लैक\\s*मार्केट', 'डार्क\\s*वेब', 'बिना\\s+लाइसेंस', 'अवैध', 'गैरकानूनी', 'डीलर'], W.WEAPON_MANUFACTURE.intent,
    ),
  },
  {
    id: 'DRUG_MARKETPLACE',
    contentClass: 'illegal',
    description:
      'sells or ships controlled drugs — a storefront, not a pharmacy listing or a harm-reduction page.',
    // मेथ carries an END: मेथी is fenugreek, which a grocery app sells by the kilo.
    subject: withDevanagari(
      /\b(cocaine|heroin|mdma|methamphetamine|crystal[-\s]?meth|lsd|ketamine|mephedrone|brown[-\s]?sugar|charas|ganja[-\s]?stock)\b/i,
      ['कोकीन', 'हेरोइन', 'हिरोइन', 'एमडीएमए', 'मेथ' + END, 'क्रिस्टल\\s*मेथ', 'मेथाम्फेटामाइन', 'एलएसडी', 'केटामाइन', 'मेफेड्रोन', 'ब्राउन\\s*शुगर', 'चरस', 'स्मैक', 'गांजा\\s*स्टॉक', 'गाँजा\\s*स्टॉक'], W.DRUG_MARKETPLACE.subject,
    ),
    /**
     * CONCEALMENT, not commerce — and this narrowing came from a failing test, which is the point of
     * having written the test as a real app first.
     *
     * The first draft included `add to cart` / `buy now`. A perfectly legal pharmacy listing reads
     * "Ketamine injection 50mg — prescription required. Add to cart" and was classified ILLEGAL by
     * it. Ordinary shop words are exactly what a lawful seller of a controlled medicine also has, so
     * they carry no signal at all; what a lawful seller never has is discreet packaging, escrow,
     * crypto-only payment or "no prescription needed".
     */
    context: withDevanagari(
      /\b(discreet[-\s]?(shipping|delivery|packaging)|stealth[-\s]?(shipping|delivery)|escrow|crypto[-\s]?only|bitcoin[-\s]?only|no[-\s]?prescription|without[-\s]a[-\s]prescription)\b/i,
      ['बिना\\s+पर्च', 'बिना\\s+प्रिस्क्रिप्शन', 'बिना\\s+डॉक्टर\\s+की\\s+पर्च', 'गुप्त\\s+डिलीवरी', 'चुपके\\s+से\\s+डिलीवरी', 'सीक्रेट\\s+डिलीवरी', 'डिस्क्रीट', 'क्रिप्टो\\s+में\\s+ही', 'सिर्फ\\s+क्रिप्टो', 'सिर्फ\\s+बिटकॉइन', 'एस्क्रो'], W.DRUG_MARKETPLACE.context,
    ),
    // Trade, not treatment. A de-addiction helpline and a pharmacy listing both name the drug; only
    // a market names the market.
    intent: withDevanagari(
      /\b(marketplace|market[-\s]?place|dark[-\s]?web|black[-\s]?market|dealer|dealers|street[-\s]?price|anonymous[-\s]?(buy|sale|order)|untraceable)\b/i,
      ['मार्केटप्लेस', 'डार्क\\s*वेब', 'ब्लैक\\s*मार्केट', 'डीलर', 'गुमनाम\\s+(?:खरीद|बिक्री|ऑर्डर)'], W.DRUG_MARKETPLACE.intent,
    ),
  },
  {
    id: 'REAL_MONEY_GAMBLING',
    contentClass: 'illegal',
    description:
      'offers betting or gambling for real money (deposits, bets, withdrawals or cash prizes), which India\'s Promotion and '
      + 'Regulation of Online Gaming Act, 2025 bans. The same game with pretend chips or coins is fine.',
    /**
     * ADMIN 2026-11-20: "other app builder jo karte hai, same karo". What they publish: Bolt (StackBlitz) and Builder.io
     * forbid UNLAWFUL gambling (Builder.io allows it only with the licences), Replit lists gambling among illegal uses.
     * The shared standard is "no unlawful gambling" — and in India the 2025 Act makes every real-money online game
     * unlawful, skill or chance, and facilitating one a cognizable, non-bailable offence. So for an Indian platform the
     * same standard means: never the real-money part. A Teen Patti, poker, Ludo or casino-style game with pretend chips
     * is a game, and is built.
     */
    subject: withDevanagari(
      /\b(bet|bets|betting|wager\w*|gambl\w*|casinos?|satta|matka|sportsbooks?|bookies?|lotter(?:y|ies)|jackpots?|roulette|slot[-\s]?machines?|poker|teen[-\s]?patti|rummy|andar[-\s]?bahar|aviator[-\s]?game|fantasy[-\s]+(?:cricket|football|kabaddi|sports?|leagues?|teams?))\b/i,
      ['सट्ट', 'मटका', 'जुआ' + END, 'जुए' + END, 'कैसीनो', 'बेटिंग', 'तीन\\s*पत्ती', 'रम्मी', 'लॉटरी', 'पोकर', 'फ' + NUKTA + 'ैंटेसी\\s*(?:क्रिकेट|टीम|लीग)'], W.REAL_MONEY_GAMBLING.subject,
    ),
    /**
     * REAL MONEY MOVING IN OR OUT — what a pretend-chips game never has. Negated mentions are skipped inside the pattern
     * itself ("no real money", "never a deposit", "without cash prizes", and after it: "real-money play is not supported"), because the PUBLISH scanner reads this context
     * with no exempt step — and the board-games kit's own generated files say "never real money, never a deposit, a
     * wallet top-up or a cash prize" beside "Teen Patti". A kit-built fun game must not be blocked by its own disclaimer.
     * A sentence that says real money is BANNED is the same kind of disclaimer (the Business kit: "India bans real-money
     * online games"), so a ban word — bans, banned, prohibited, forbidden, illegal, outlawed — counts as a negation too.
     */
    context: withDevanagari(
      /(?<!\b(?:no|not|never|nor|without|zero|fake|pretend|non|instead\s+of|bans?|banned|banning|prohibit\w*|forbid\w*|illegal|outlaw\w*)\b[^.!?\n]{0,48})\b(deposit\w*|withdraw\w*|cash[-\s]?outs?|payouts?|real[-\s]?(?:money|cash|rupees?)|cash[-\s]?prizes?|prize[-\s]?money|win(?:ning)?[-\s]+(?:real\s+)?(?:money|cash|rupees?|₹)|add[-\s]+money|upi\s+(?:deposit|top[-\s]?ups?)|wallet[-\s]+top[-\s]?ups?|asli\s+paise|paise?\s+(?:jeet\w*|lagao|lagaa?ye|lagaa?na|jama|nikaal\w*|kamao))\b(?![-\s\w]{0,30}\b(?:is|are|was|were)\s+(?:not|never|banned|prohibited|forbidden|illegal|outlawed)\b)/i,
      ['असली\\s+पैसे', 'पैसे\\s+(?:जमा|निकाल|लगा|जीत)', 'कैश\\s+प्राइज' + NUKTA + '?', 'डिपॉजिट', 'विड्रॉ', 'इनाम\\s+की\\s+राशि'], W.REAL_MONEY_GAMBLING.context,
    ),
    // Recorded, not refused: a betting word and money mentioned in a request to build — a human looks later.
    intent: withDevanagari(
      /\b(money|cash|rupees?|inr|₹|paisa|paise|earn|earning|payments?|wallet)\b/i,
      ['पैसे', 'पैसा', 'रुपये', 'कमाई', 'वॉलेट'], W.REAL_MONEY_GAMBLING.intent,
    ),
    // An app that HELPS people away from gambling, or reports illegal betting, is not the offence it fights.
    exempt: withDevanagari(
      /\b(addict\w*|de-?addiction|recover\w*|helplines?|awareness|counsel\w*|therap\w*|report(?:s|ing)?\s+illegal|illegal\s+betting\s+(?:report|complaint)s?|ban\s+on\s+(?:betting|gambling))\b/i,
      ['लत' + END, 'नशा\\s*मुक्ति', 'छुटकारा', 'हेल्पलाइन', 'जागरूक', 'काउंसलिंग', 'परामर्श'], W.REAL_MONEY_GAMBLING.exempt,
    ),
  },
  {
    id: 'ADULT_CONTENT',
    contentClass: 'adult',
    /**
     * 🔴 BANNED ON NAVBHARATAI — admin decision 2026-09-13, and it REVERSES what this rule said
     * yesterday.
     *
     * This entry used to read *"NOT illegal — lawful adult content. Governed by the creator's own +18
     * setting"*, and `promptSafety` therefore returned FLAG: the request was recorded and the build
     * ran. Build report 03997004 is what that looked like in production — a user asked for a porn
     * site with uploads, streaming and anonymous chat, and the platform spent 171 seconds and eight
     * model calls asking models to build it. Every model refused, which is the model's virtue and was
     * never the platform's design.
     *
     * The admin's ruling is not "lawful, tag it at publish". It is *"पोर्नोग्राफी बैन है"* — this is an
     * Indian product and it does not build this, for anyone, at any tier. So the class stays `adult`
     * (the publish scanner's tagging is unchanged and still useful) while the PROMPT verdict becomes a
     * refusal — see `triagePrompt`.
     */
    description:
      'asks for pornographic or sexually explicit content. Banned on NavBharatAI — refused at the prompt.',
    // Widened the same day: the original subject missed every brand and every Hinglish spelling a real
    // user types, so "onlyfans clone with premium subscribe" was ALLOWED outright (verified, not assumed).
    subject: withDevanagari(
      /\b(porn|porno|pornography|pornographic|pornhub|xvideos|xnxx|xhamster|redtube|youporn|brazzers|onlyfans|hentai|rule34|camgirl|cam[-\s]?girl|camwhore|sex[-\s]?cam|nudify|deepnude|xxx|hardcore|erotica|nsfw|adult[-\s]?(video|content|film)s?|blue[-\s]?film|chudai|chodai|randi|nang[ai][-\s]?video|sexy[-\s]?video|sex[-\s]?videos?)\b/i,
      ['पोर्न', 'पॉर्न', 'ब्लू\\s*फ' + NUKTA + 'िल्म', 'अश्लील\\s+(?:वीडियो|फ' + NUKTA + 'िल्म|फ' + NUKTA + 'ोटो|तस्वीर|कंटेंट|सामग्री|क्लिप|चैट)', 'सेक्स\\s*(?:वीडियो|कैम|चैट|फ' + NUKTA + 'िल्म)', 'सेक्सी\\s*(?:वीडियो|फ' + NUKTA + 'ोटो|फ' + NUKTA + 'िल्म)', 'नंग[ीा]\\s*(?:वीडियो|फ' + NUKTA + 'ोटो|तस्वीर)', 'चुदाई', 'चोदा', 'रंडी', 'एक्सएक्सएक्स', 'हेंताई', 'ओनलीफ' + NUKTA + 'ैंस', 'न्यूडिफ'], W.ADULT_CONTENT.subject,
    ),
    context: withDevanagari(
      /\b(watch|stream|streaming|live|upload|uploads|gallery|video|videos|clip|clips|category|categories|subscribe|subscription|premium|paywall|webcam|chat|site|website|app|platform|tube|18\+|adults?[-\s]only|banao|bana)\b/i,
      ['देख', 'स्ट्रीम', 'लाइव', 'अपलोड', 'गैलरी', 'वीडियो', 'क्लिप', 'कैटेगरी', 'सब्सक्राइब', 'सब्सक्रिप्शन', 'प्रीमियम', 'चैट', 'साइट', 'वेबसाइट', 'ऐप', 'एप' + END, 'प्लेटफ' + NUKTA + '[ॉो]र्म', 'प्लेटफार्म', 'बना'], W.ADULT_CONTENT.context,
    ),
    intent: withDevanagari(
      /\b(site|website|app|platform|streaming|gallery|tube)\b/i,
      ['साइट', 'वेबसाइट', 'ऐप', 'एप' + END, 'प्लेटफ' + NUKTA + '[ॉो]र्म', 'प्लेटफार्म', 'स्ट्रीमिंग', 'गैलरी'], W.ADULT_CONTENT.intent,
    ),
    /**
     * 🔒 THE STAND-DOWN. Any of these anywhere in the text cancels the rule, because each names an app
     * NavBharatAI should WANT: a sexual-health clinic, a school safety curriculum, a harassment or
     * trafficking reporting tool, a parental filter, a moderation dashboard, a legal-compliance page.
     * All of them legitimately contain both halves of the pair. Missing a cleverly-worded porn request
     * costs one model refusal, which already works; insulting a doctor costs a user forever.
     */
    /**
     * 🔴 THE ENGLISH HALF NOW MATCHES INFLECTIONS (2026-10-04). It named `parental` and `blocker` and
     * so missed "an app to block porn for parents", which was shown the ban: measured, not assumed.
     * The same lesson as `nudif\w*` above: a stand-down that stops at one word form is a stand-down
     * an ordinary sentence walks past. Only forms of the words already here were added; no new idea.
     */
    exempt: withDevanagari(
      /\b(educat\w*|awareness|health|healthcare|clinic\w*|doctors?|medical|hospitals?|patients?|therap\w*|counsel\w*|consent|hygiene|reproductive|fertility|pregnan(?:cy|t)|maternity|harass\w*|assault\w*|traffick\w*|exploitation|prevent\w*|protect\w*|parent\w*|moderat\w*|filter\w*|block(?:s|er|ers|ing|ed)?|detect\w*|report\w*|complaints?|helplines?|ngos?|police|legal|compliance|polic(?:y|ies)|banned|restrict\w*|age[-\s]verification|safeguard\w*)\b/i,
      ['शिक्षा', 'शैक्षिक', 'जागरूक', 'स्वास्थ्य', 'क्लिनिक', 'डॉक्टर', 'चिकित्सा', 'अस्पताल', 'मरीज', 'थेरेपी', 'परामर्श', 'काउंसलिंग', 'सहमति', 'स्वच्छता', 'प्रजनन', 'गर्भ', 'मातृत्व', 'उत्पीड' + NUKTA + 'न', 'शोषण', 'तस्करी', 'रोकथाम', 'रोकन', 'रोकने', 'बचाव', 'बचान', 'बचाने', 'सुरक्षा', 'सुरक्षित', 'अभिभावक', 'माता-पिता', 'पेरेंट', 'मॉडरेशन', 'फ' + NUKTA + 'िल्टर', 'ब्लॉक', 'डिटेक्ट', 'रिपोर्ट', 'शिकायत', 'हेल्पलाइन', 'एनजीओ', 'पुलिस', 'क' + NUKTA + 'ानून', 'नीति', 'प्रतिबंध', 'आयु\\s+सत्यापन', 'उम्र\\s+सत्यापन'], W.ADULT_CONTENT.exempt,
    ),
  },
];

/** Where a publish-path finding was seen: the file, and the short phrase around the pair. */
export interface IllegalEvidence {
  file: string;
  excerpt: string;
}

export interface IllegalFinding {
  id: string;
  contentClass: Exclude<PublishContentClass, 'general'>;
  description: string;
  /**
   * The phrase(s) that paired, for the ADMIN's review screen only (admin 2026-11-26: "admin ko saf
   * saf bataya jaye"). Never sent to the creator. Bounded: at most `MAX_EVIDENCE` excerpts of at most
   * `EXCERPT_CHARS` characters each.
   */
  evidence?: IllegalEvidence[];
}

export interface IllegalScanResult {
  findings: IllegalFinding[];
  /** The strictest class found. `illegal` wins over `adult`, which wins over `general`. */
  contentClass: PublishContentClass;
}

/** How much text is examined. Bounded so a giant bundle cannot stall a publish. */
export const SCAN_TEXT_CAP = 2_000_000;

/** The most characters allowed BETWEEN a subject and its context for them to count as one phrase. */
export const PAIR_WINDOW = 80;
/**
 * A pair never crosses a code statement or block edge. A sentence end and a line break are
 * deliberately NOT breaks: "Play Teen Patti now! Deposit ₹100" is one offer in two sentences, and a
 * JSX page puts its heading and its button on separate lines. The 80-character window is what keeps
 * a pair inside one short phrase (measured on the repo's own 3,162 source files: adding the line
 * break as a separator removed one hit and caught nothing the window did not).
 */
const SEGMENT_BREAK = /[;{}]/g;
/** Excerpts kept per finding, and their length — enough for an admin to judge, never a transcript. */
export const MAX_EVIDENCE = 3;
export const EXCERPT_CHARS = 200;
/** A runaway match list (a minified bundle full of "app") is cut off, so pairing stays bounded. */
const MAX_MATCHES_PER_LIST = 20_000;

type Span = readonly [number, number];

/**
 * Is the token at [s, e) a CODE identifier rather than a word a person reads? `obj.children`,
 * `child.position`, `children[0]`, `child(`, `_child`, `$child` are code. PURE. Deliberately narrow:
 * a sentence-final "kids." (a dot then a space or the end) stays a word.
 */
export function isCodeToken(body: string, s: number, e: number): boolean {
  const before = s > 0 ? body[s - 1] : '';
  const after = body[e] ?? '';
  if (before === '.' || before === '_' || before === '$') return true;
  if (after === '(' || after === '[' || after === '_' || after === '$') return true;
  if (after === '.' && /[A-Za-z_$]/.test(body[e + 1] ?? '')) return true;
  return false;
}

/** What makes "explicit" / "hardcore" sexual rather than "explicit dispose" or a game's "hardcore mode". */
const SEXUAL_NOUN_AFTER = /^\s+(?:porn\w*|sex\w*|nud\w*|naked|photos?|pictures?|pics?|images?|videos?|clips?|content|material|scenes?|movies?|films?|chats?|stories|story)\b/i;
/** "sex" as a form field or a statistic ("Child sex: M/F", "sex ratio"), not a sexual word. */
const SEX_AS_FIELD_AFTER = /^\s*(?:[:=/|(,]|\s+(?:ratio|m\/f|male|female|of\s+the\s+(?:child|baby|student)))/i;

/**
 * Is this match one of the words that are ambiguous ALONE? PURE. Read by BOTH readers: the publish
 * scanner (via `humanSpans`) and prompt triage (via `matchesUnambiguously`).
 *
 * A game has a "hardcore mode", a codebase says "explicit dispose of child meshes", a school form asks
 * "Child sex: M/F". Each word is sexual only next to a sexual noun, so on its own it is not one half of
 * a pair. Measured, not guessed: "a cricket game for kids with a hardcore mode" paired CSAM_SIGNAL and
 * "Hardcore mode: watch the timer" paired ADULT_CONTENT before this (Q-3560 on the publish path, Q-3561
 * on the prompt path — where a refusal is final, so a false one costs a user their build outright).
 */
export function isAmbiguousWordAlone(word: string, after: string): boolean {
  const w = word.toLowerCase();
  if (w === 'explicit' || w === 'hardcore') return !SEXUAL_NOUN_AFTER.test(after);
  if (w === 'sex') return SEX_AS_FIELD_AFTER.test(after);
  return false;
}

/**
 * Does `re` match `body` at least once with a word that is NOT ambiguous alone? PURE + bounded.
 *
 * The prompt reader's version of `humanSpans`. A prompt is prose, so it keeps its whole-message pairing
 * (a request names the subject and the offence in one message, often one long sentence) and does not
 * use the publish path's code-identifier or 80-character rules — only this one word-level precision
 * rule, which is true of prose and code alike. Precision-first is the existing triage policy
 * (docs/claude/PRODUCT_POLICY_PRECEDENTS.md); a refusal stays final.
 */
export function matchesUnambiguously(re: RegExp, body: string): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let seen = 0;
  for (const m of body.matchAll(g)) {
    if (!m[0]) continue;
    const e = (m.index ?? 0) + m[0].length;
    if (!isAmbiguousWordAlone(m[0], body.slice(e, e + 40))) return true;
    if (++seen >= MAX_MATCHES_PER_LIST) return false;
  }
  return false;
}

function humanSpans(re: RegExp, body: string): Span[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: Span[] = [];
  for (const m of body.matchAll(g)) {
    if (!m[0]) continue;
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (isCodeToken(body, s, e)) continue;
    if (isAmbiguousWordAlone(m[0], body.slice(e, e + 40))) continue;
    out.push([s, e]);
    if (out.length >= MAX_MATCHES_PER_LIST) break;
  }
  return out;
}

/** First index in sorted `xs` whose value is >= v. */
function lowerBound(xs: readonly number[], v: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * The phrase-level pairs of `rule` in ONE file's text (already normalised). PURE + bounded.
 * Returns the [start, end) of each paired phrase (subject through context), at most `limit` of them.
 */
export function pairedPhrases(rule: Pick<IllegalRule, 'subject' | 'context'>, body: string, limit = MAX_EVIDENCE): Span[] {
  if (limit <= 0) return [];
  const subjects = humanSpans(rule.subject, body);
  if (subjects.length === 0) return [];
  const contexts = humanSpans(rule.context, body);
  if (contexts.length === 0) return [];
  const breaks: number[] = [];
  for (const m of body.matchAll(SEGMENT_BREAK)) breaks.push(m.index ?? 0);
  // Global matches never overlap, so their ends are sorted — binary search the first one in reach.
  const ctxEnds = contexts.map((c) => c[1]);
  const out: Span[] = [];
  for (const [ss, se] of subjects) {
    for (let k = lowerBound(ctxEnds, ss - PAIR_WINDOW); k < contexts.length; k++) {
      const [cs, ce] = contexts[k];
      if (cs > se + PAIR_WINDOW) break;
      const gapStart = Math.min(se, ce);
      const gapEnd = Math.max(ss, cs);
      if (gapEnd - gapStart > PAIR_WINDOW) continue;
      // No segment break may sit in the gap between the two halves.
      if (gapEnd > gapStart) {
        const b = lowerBound(breaks, gapStart);
        if (b < breaks.length && breaks[b] < gapEnd) continue;
      }
      out.push([Math.min(ss, cs), Math.max(se, ce)]);
      break;
    }
    if (out.length >= limit) break;
  }
  return out;
}

function excerptOf(body: string, [s, e]: Span): string {
  const pad = Math.max(0, Math.floor((EXCERPT_CHARS - (e - s)) / 2));
  const raw = body.slice(Math.max(0, s - pad), Math.min(body.length, e + pad));
  return raw.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
}

/**
 * Classify an app's own files — the PUBLISH path. PURE.
 *
 * A rule fires only on a phrase-level pair inside one file (see the Q-3560 note at the top). The
 * protective stand-down reads the whole app, exactly as it always did. The total text read is capped
 * at `SCAN_TEXT_CAP`, in file order, so a giant bundle cannot stall a publish.
 *
 * 🔁 POLICY CHANGE (admin 2026-11-26): each finding now carries the paired phrase(s) and their file,
 * for the admin's review screen. The 2026-09-12 rule "no matched text is returned" is superseded by
 * the admin's own instruction — a flagged app is now HELD for a person to review rather than refused,
 * and that person must see exactly what the check saw. The excerpt is short, bounded, and never shown
 * to the creator. See docs/claude/PRODUCT_POLICY_PRECEDENTS.md.
 */
export function classifyPublishedFiles(files: Iterable<readonly [string, string]>): IllegalScanResult {
  const parts: Array<[string, string]> = [];
  let budget = SCAN_TEXT_CAP;
  for (const [file, text] of files) {
    if (budget <= 0) break;
    const body = normalizeScanText(String(text ?? '').slice(0, budget));
    budget -= body.length;
    if (body) parts.push([file, body]);
  }
  const findings: IllegalFinding[] = [];
  if (parts.length === 0) return { findings, contentClass: 'general' };
  let whole: string | null = null;
  const wholeApp = (): string => (whole ??= parts.map(([, b]) => b).join('\n'));

  for (const rule of ILLEGAL_RULES) {
    const evidence: IllegalEvidence[] = [];
    for (const [file, body] of parts) {
      for (const span of pairedPhrases(rule, body, MAX_EVIDENCE - evidence.length)) {
        evidence.push({ file, excerpt: excerptOf(body, span) });
      }
      if (evidence.length >= MAX_EVIDENCE) break;
    }
    // A protective app (Q-320) is not the offence it protects against — judged on the whole app.
    if (evidence.length > 0 && !protectiveStandDown(rule, wholeApp())) {
      findings.push({ id: rule.id, contentClass: rule.contentClass, description: rule.description, evidence });
    }
  }

  const contentClass: PublishContentClass = findings.some((f) => f.contentClass === 'illegal')
    ? 'illegal'
    : findings.some((f) => f.contentClass === 'adult')
      ? 'adult'
      : 'general';
  return { findings, contentClass };
}

/** Classify one block of published text (a single page): the same phrase-level test, file `''`. */
export function classifyPublishedText(text: string | null | undefined): IllegalScanResult {
  return classifyPublishedFiles([['', String(text ?? '')]]);
}

// `illegalRefusal` (the "This app was not published: it pairs words describing a child…" sentence) was
// removed on 2026-11-26: a classifier finding no longer refuses a publish, it holds it for a person
// (storePublishSafety.ts → HELD_FOR_REVIEW_MESSAGE). Nothing else ever called it.
