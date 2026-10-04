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
// So each rule needs TWO independent signals in the same app — a subject AND a context — which is
// what an actual offending page has and an innocent mention does not.
//
// ── 🔴 AN HONEST LIMIT, STATED RATHER THAN HIDDEN (fourth absolute rule, step 6) ─────────────────
// This reads TEXT. It cannot see images. Real CSAM detection is perceptual image hashing against
// NCMEC/PhotoDNA-class databases, which NavBharatAI does not have access to and cannot fake — so an
// image-only offence passes this scanner. That is an OPEN ROOT CAUSE, not a solved problem, and it
// is recorded as one. What this does catch is the text an offending app carries around its images:
// the offer, the label, the search box. That is worth having and is not the same as protection.
//
// PURE + deterministic + bounded. No model call, so a clean publish costs nothing.

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
 * ⚠️ Devanagari only. Bengali, Tamil, Telugu, Urdu and the rest are still unread here (an open row in
 * BUILD_REPORT_QUEUE.md).
 */
const DEVA_START = '(?<![\\w\\u0900-\\u097F])';
const END = '(?![\\u0900-\\u097F])';
/** An optional nukta. After NFC a nukta letter (फ़, ड़, ज़) is always the base letter plus U+093C. */
const NUKTA = '\\u093C?';

function withDevanagari(latin: RegExp, devanagari: readonly string[]): RegExp {
  return new RegExp(`(?:${latin.source})|${DEVA_START}(?:${devanagari.join('|')})`, 'i');
}

/**
 * The form both consumers scan. NFC, so a nukta written as one code point (फ़ U+095E) and as two
 * (फ + ़) read the same; and zero-width characters removed, so "p​orn" or a ZWJ inside a
 * Devanagari word cannot split a word in two and walk past every pattern. Pure.
 */
export function normalizeScanText(text: string): string {
  return text.normalize('NFC').replace(/[​-‍⁠﻿]/g, '');
}

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
      ['बच्च', 'नाबालिग', 'बालक', 'बालिका', 'शिशु', 'छोटी\\s+बच्च', '18\\s*साल\\s*से\\s*कम'],
    ),
    // नंगे is deliberately absent: "नंगे पैर" means barefoot, and "बच्चे नंगे पैर स्कूल जाते हैं" is a
    // sentence about poverty, not an offence.
    context: withDevanagari(
      /\b(porn|pornography|nude|nudes|naked|sex|sexual|sexy|erotic|xxx|hardcore|explicit)\b/i,
      ['पोर्न', 'पॉर्न', 'सेक्स', 'यौन', 'अश्लील', 'नग्न', 'नंगी', 'नंगा' + '(?![\\u0900-\\u097F])', 'एक्सएक्सएक्स', 'कामुक'],
    ),
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
      ['डीप\\s*फ' + NUKTA + 'े' + 'क', 'फ' + NUKTA + 'े' + 'स\\s*स्वैप', 'न्यूडिफ', 'कपड' + NUKTA + 'े\\s+उता', 'रिवेंज\\s+पोर्न', 'हिडन\\s+कैम', 'छिप' + '[ाे]' + '\\s+कैमर'],
    ),
    context: withDevanagari(
      /\b(photo|photos|picture|pictures|image|images|video|videos|selfie|her|girlfriend|wife|ex)\b/i,
      ['फ' + NUKTA + 'ोटो', 'तस्वीर', 'इमेज', 'वीडियो', 'सेल्फी', 'गर्लफ्रेंड', 'पत्नी', 'बीवी'],
    ),
    // Asking to build one IS the illicit purpose — there is no benign "undress any photo" tool.
    intent: withDevanagari(
      /\b(app|tool|site|website|bot|service|generator)\b/i,
      ['ऐप', 'एप' + END, 'टूल', 'साइट', 'वेबसाइट', 'बॉट', 'सर्विस', 'जनरेटर'],
    ),
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
      ['पाइप\\s*बम', 'प्रेशर\\s*कुकर\\s*बम', 'आईईडी', 'डेटोनेटर', 'देसी\\s*कट्ट', 'देशी\\s*कट्ट', 'तमंच', 'देसी\\s*बम', 'देशी\\s*बम'],
    ),
    // The instructional half — a news report about a bomb has the subject and never this.
    context: withDevanagari(
      /\b(how[-\s]to[-\s]make|step[-\s]by[-\s]step|instructions|tutorial|recipe|assemble|build[-\s]your[-\s]own|materials[-\s]needed|ingredients)\b/i,
      ['बनाने\\s+का\\s+तरीक', 'बनाने\\s+की\\s+विधि', 'कैसे\\s+बना', 'घर\\s+पर\\s+बना', 'स्टेप\\s+बाय\\s+स्टेप', 'निर्देश', 'ट्यूटोरियल', 'जरूरी\\s+सामान', 'ज' + NUKTA + 'रूरी\\s+सामान'],
    ),
    // NOT "write me a …": a chemistry lesson explaining a detonator is a legitimate request. Only
    // evasion or trade makes it illicit.
    intent: withDevanagari(
      /\b(untraceable|undetectable|evade|bypass[-\s]detection|black[-\s]?market|dark[-\s]?web|without[-\s]a[-\s]licen[cs]e|no[-\s]licen[cs]e|sell|selling|dealer)\b/i,
      ['बेच', 'ब्लैक\\s*मार्केट', 'डार्क\\s*वेब', 'बिना\\s+लाइसेंस', 'अवैध', 'गैरकानूनी', 'डीलर'],
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
      ['कोकीन', 'हेरोइन', 'हिरोइन', 'एमडीएमए', 'मेथ' + END, 'क्रिस्टल\\s*मेथ', 'मेथाम्फेटामाइन', 'एलएसडी', 'केटामाइन', 'मेफेड्रोन', 'ब्राउन\\s*शुगर', 'चरस', 'स्मैक', 'गांजा\\s*स्टॉक', 'गाँजा\\s*स्टॉक'],
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
      ['बिना\\s+पर्च', 'बिना\\s+प्रिस्क्रिप्शन', 'बिना\\s+डॉक्टर\\s+की\\s+पर्च', 'गुप्त\\s+डिलीवरी', 'चुपके\\s+से\\s+डिलीवरी', 'सीक्रेट\\s+डिलीवरी', 'डिस्क्रीट', 'क्रिप्टो\\s+में\\s+ही', 'सिर्फ\\s+क्रिप्टो', 'सिर्फ\\s+बिटकॉइन', 'एस्क्रो'],
    ),
    // Trade, not treatment. A de-addiction helpline and a pharmacy listing both name the drug; only
    // a market names the market.
    intent: withDevanagari(
      /\b(marketplace|market[-\s]?place|dark[-\s]?web|black[-\s]?market|dealer|dealers|street[-\s]?price|anonymous[-\s]?(buy|sale|order)|untraceable)\b/i,
      ['मार्केटप्लेस', 'डार्क\\s*वेब', 'ब्लैक\\s*मार्केट', 'डीलर', 'गुमनाम\\s+(?:खरीद|बिक्री|ऑर्डर)'],
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
      ['पोर्न', 'पॉर्न', 'ब्लू\\s*फ' + NUKTA + 'िल्म', 'अश्लील\\s+(?:वीडियो|फ' + NUKTA + 'िल्म|फ' + NUKTA + 'ोटो|तस्वीर|कंटेंट|सामग्री|क्लिप|चैट)', 'सेक्स\\s*(?:वीडियो|कैम|चैट|फ' + NUKTA + 'िल्म)', 'सेक्सी\\s*(?:वीडियो|फ' + NUKTA + 'ोटो|फ' + NUKTA + 'िल्म)', 'नंग[ीा]\\s*(?:वीडियो|फ' + NUKTA + 'ोटो|तस्वीर)', 'चुदाई', 'चोदा', 'रंडी', 'एक्सएक्सएक्स', 'हेंताई', 'ओनलीफ' + NUKTA + 'ैंस', 'न्यूडिफ'],
    ),
    context: withDevanagari(
      /\b(watch|stream|streaming|live|upload|uploads|gallery|video|videos|clip|clips|category|categories|subscribe|subscription|premium|paywall|webcam|chat|site|website|app|platform|tube|18\+|adults?[-\s]only|banao|bana)\b/i,
      ['देख', 'स्ट्रीम', 'लाइव', 'अपलोड', 'गैलरी', 'वीडियो', 'क्लिप', 'कैटेगरी', 'सब्सक्राइब', 'सब्सक्रिप्शन', 'प्रीमियम', 'चैट', 'साइट', 'वेबसाइट', 'ऐप', 'एप' + END, 'प्लेटफ' + NUKTA + '[ॉो]र्म', 'प्लेटफार्म', 'बना'],
    ),
    intent: withDevanagari(
      /\b(site|website|app|platform|streaming|gallery|tube)\b/i,
      ['साइट', 'वेबसाइट', 'ऐप', 'एप' + END, 'प्लेटफ' + NUKTA + '[ॉो]र्म', 'प्लेटफार्म', 'स्ट्रीमिंग', 'गैलरी'],
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
      ['शिक्षा', 'शैक्षिक', 'जागरूक', 'स्वास्थ्य', 'क्लिनिक', 'डॉक्टर', 'चिकित्सा', 'अस्पताल', 'मरीज', 'थेरेपी', 'परामर्श', 'काउंसलिंग', 'सहमति', 'स्वच्छता', 'प्रजनन', 'गर्भ', 'मातृत्व', 'उत्पीड' + NUKTA + 'न', 'शोषण', 'तस्करी', 'रोकथाम', 'रोकन', 'रोकने', 'बचाव', 'बचान', 'बचाने', 'सुरक्षा', 'सुरक्षित', 'अभिभावक', 'माता-पिता', 'पेरेंट', 'मॉडरेशन', 'फ' + NUKTA + 'िल्टर', 'ब्लॉक', 'डिटेक्ट', 'रिपोर्ट', 'शिकायत', 'हेल्पलाइन', 'एनजीओ', 'पुलिस', 'क' + NUKTA + 'ानून', 'नीति', 'प्रतिबंध', 'आयु\\s+सत्यापन', 'उम्र\\s+सत्यापन'],
    ),
  },
];

export interface IllegalFinding {
  id: string;
  contentClass: Exclude<PublishContentClass, 'general'>;
  description: string;
}

export interface IllegalScanResult {
  findings: IllegalFinding[];
  /** The strictest class found. `illegal` wins over `adult`, which wins over `general`. */
  contentClass: PublishContentClass;
}

/** How much text is examined. Bounded so a giant bundle cannot stall a publish. */
export const SCAN_TEXT_CAP = 2_000_000;

/**
 * Classify an app's own text. PURE.
 *
 * 🔒 NO MATCHED TEXT IS RETURNED. The other rules in this scanner carry a `matchSnippet` so an admin
 * can judge a phishing lure for themselves — right for that category and wrong for these. Quoting the
 * matched line back would mean storing, displaying and (through the takedown record) RETAINING the
 * very sentence we are acting on, in a Firestore document and on an admin screen. The rule id and its
 * description say enough to act; the app itself is there to be opened by anyone who needs more.
 */
export function classifyPublishedText(text: string | null | undefined): IllegalScanResult {
  const body = normalizeScanText(String(text ?? '').slice(0, SCAN_TEXT_CAP));
  const findings: IllegalFinding[] = [];
  if (!body) return { findings, contentClass: 'general' };

  for (const rule of ILLEGAL_RULES) {
    // BOTH halves, in the same app. Either alone is an innocent mention.
    if (rule.subject.test(body) && rule.context.test(body)) {
      findings.push({ id: rule.id, contentClass: rule.contentClass, description: rule.description });
    }
  }

  const contentClass: PublishContentClass = findings.some((f) => f.contentClass === 'illegal')
    ? 'illegal'
    : findings.some((f) => f.contentClass === 'adult')
      ? 'adult'
      : 'general';
  return { findings, contentClass };
}

/** The sentence a blocked creator reads. Names the category and the way to appeal — never the match. */
export function illegalRefusal(finding: IllegalFinding | undefined): string {
  const what = finding?.description || 'breaks our Acceptable Use rules.';
  return `This app was not published: it ${what} `
    + 'Nothing was saved. If you believe this is a mistake, our Grievance Redressal page has the '
    + 'address to write to and the time we must answer within.';
}
