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
    subject: /\b(child|children|kid|kids|minor|minors|underage|under[-\s]?18|preteen|pre[-\s]?teen|toddler|infant|schoolgirl|schoolboy)\b/i,
    context: /\b(porn|pornography|nude|nudes|naked|sex|sexual|sexy|erotic|xxx|hardcore|explicit)\b/i,
  },
  {
    id: 'NON_CONSENSUAL_IMAGERY',
    contentClass: 'illegal',
    description:
      'offers to undress or sexualise a real person from their photograph, or to publish intimate images without consent.',
    // `nudif\w*` rather than `nudify`: the first version missed "nudifies"/"nudified" — a word-boundary
    // rule that stops at the stem is a rule an ordinary sentence walks past.
    subject: /\b(nudif\w*|undress\w*|deep[-\s]?fakes?|face[-\s]?swaps?|revenge[-\s]?porn|upskirt|hidden[-\s]?cam)\b/i,
    context: /\b(photo|photos|picture|pictures|image|images|video|videos|selfie|her|girlfriend|wife|ex)\b/i,
    // Asking to build one IS the illicit purpose — there is no benign "undress any photo" tool.
    intent: /\b(app|tool|site|website|bot|service|generator)\b/i,
  },
  {
    id: 'WEAPON_MANUFACTURE',
    contentClass: 'illegal',
    description:
      'gives instructions for making a weapon or an explosive device, rather than merely mentioning one.',
    // Plurals matter: `ghost gun` alone missed "ghost guns", which is how the phrase is usually written.
    subject: /\b(pipe[-\s]?bombs?|ieds?|improvised[-\s]?explosives?|pressure[-\s]?cooker[-\s]?bombs?|detonators?|blasting[-\s]?caps?|ghost[-\s]?guns?|untraceable[-\s]?(guns?|firearms?)|silencers?|suppressors?)\b/i,
    // The instructional half — a news report about a bomb has the subject and never this.
    context: /\b(how[-\s]to[-\s]make|step[-\s]by[-\s]step|instructions|tutorial|recipe|assemble|build[-\s]your[-\s]own|materials[-\s]needed|ingredients)\b/i,
    // NOT "write me a …": a chemistry lesson explaining a detonator is a legitimate request. Only
    // evasion or trade makes it illicit.
    intent: /\b(untraceable|undetectable|evade|bypass[-\s]detection|black[-\s]?market|dark[-\s]?web|without[-\s]a[-\s]licen[cs]e|no[-\s]licen[cs]e|sell|selling|dealer)\b/i,
  },
  {
    id: 'DRUG_MARKETPLACE',
    contentClass: 'illegal',
    description:
      'sells or ships controlled drugs — a storefront, not a pharmacy listing or a harm-reduction page.',
    subject: /\b(cocaine|heroin|mdma|methamphetamine|crystal[-\s]?meth|lsd|ketamine|mephedrone|brown[-\s]?sugar|charas|ganja[-\s]?stock)\b/i,
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
    context: /\b(discreet[-\s]?(shipping|delivery|packaging)|stealth[-\s]?(shipping|delivery)|escrow|crypto[-\s]?only|bitcoin[-\s]?only|no[-\s]?prescription|without[-\s]a[-\s]prescription)\b/i,
    // Trade, not treatment. A de-addiction helpline and a pharmacy listing both name the drug; only
    // a market names the market.
    intent: /\b(marketplace|market[-\s]?place|dark[-\s]?web|black[-\s]?market|dealer|dealers|street[-\s]?price|anonymous[-\s]?(buy|sale|order)|untraceable)\b/i,
  },
  {
    id: 'ADULT_CONTENT',
    // NOT illegal — lawful adult content. Governed by the creator's own +18 setting (Phase 2).
    contentClass: 'adult',
    description:
      'contains adult sexual content. Lawful, and allowed for a creator who has turned on the 18+ setting.',
    subject: /\b(porn|pornography|xxx|hardcore|erotica|nsfw|adult[-\s]?(video|content|film)s?)\b/i,
    context: /\b(watch|stream|gallery|videos|category|categories|subscribe|premium|18\+|adults?[-\s]only)\b/i,
    intent: /\b(site|website|app|platform|streaming|gallery|tube)\b/i,
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
  const body = String(text ?? '').slice(0, SCAN_TEXT_CAP);
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
