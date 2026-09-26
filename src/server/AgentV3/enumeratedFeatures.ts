/**
 * HOW MANY DISTINCT PARTS DOES THIS PROMPT ASK FOR? — one counter, read by every gate that decides
 * whether a request is a PROJECT rather than an app.
 *
 * 🔴 WHY THIS MODULE EXISTS (2026-09-18). Two live gates decide that a build is too big for one
 * pass, and on the day the admin switched the first of them ON, BOTH were measured and BOTH were
 * blind to how a real person writes:
 *
 *   - `megaProjectSignals` (ProjectPlan.ts) counted `^[-*•] ` / `^1. ` LINES only.
 *   - `featureCount` (lib/appScopeAnalyzer.ts) counted those same lines plus loose VERBS.
 *
 * Neither could see a COMMA. So of fourteen realistic prompts — "school ERP with students, teachers,
 * attendance, fees, exams, timetable, library, transport", a factory ERP naming eight modules, a
 * hospital system naming seven — **not one fired**, while `ProjectPlan.test.ts`'s own passing case is
 * a hospital system written as a bulleted spec. The gates were built to read a DEVELOPER'S spec, and
 * real users write one line with commas.
 *
 * That is the same class as the scoring fix shipped hours earlier the same day: `COMPLEX_APP_SIGNAL`
 * listed the words a developer writes (saas, crm, checkout) and scored "hospital management system" 5
 * — the score of the word "hi". The instance was fixed in the SIZER; these two siblings were never
 * hunted. This module is the sibling fix, centralized so a third gate cannot be written blind.
 *
 * 🔒 STRICT BY CONSTRUCTION, because both callers are GATES and over-counting costs real money (an
 * extra planner call and a decomposition on an ordinary app). A counted item must look like a named
 * PART, not like prose:
 *   - a bullet / numbered line is one item (the signal that already worked — never regressed);
 *   - an inline run needs at least MIN_RUN_ITEMS separators before any of it counts, so a single
 *     comma in a sentence enumerates nothing;
 *   - an item is at most MAX_ITEM_WORDS words, which is what keeps a comma-joined SENTENCE from
 *     inflating the count;
 *   - items are de-duplicated case-insensitively.
 *
 * PURE. No I/O, no clock, no env.
 */

/** A run must carry at least this many pieces before it reads as an enumeration rather than a pause. */
export const MIN_RUN_ITEMS = 3;
/** A named part is short. Longer than this and it is prose, which enumerates nothing. */
export const MAX_ITEM_WORDS = 5;
/** Nothing downstream benefits from a bigger number, and a runaway prompt must not produce one. */
export const MAX_COUNTED = 40;

/**
 * A request for BIG software by name — the one definition every gate reads (ProjectPlan's project
 * gate and the scope analyzer's small-app hint). Written once so the two cannot drift apart.
 */
export const BIG_SOFTWARE_NOUN =
  /\b(?:erp|crm|lms|hms|hrms|pos)\b|management system|management software|enterprise|saas platform|multi[- ]tenant|marketplace|social network|super ?app|full[- ](?:fledged|scale)/i;

/** A list-opening connective: what follows it is the list, whatever preceded it was the request. */
const LIST_OPENER =
  /\b(?:with|including|includes|such as|like|having|jisme|jismein|jinme|jinmein|jaise|aur usme|ke saath)\b|:/i;

/** The separators a person actually types between parts of a list, in English and in Hinglish. */
// ⛔ NO DANDA `।` HERE EITHER — the same measurement, and the same reason. See the long note on
// `enumeratedParts` in RequestAnalyser.ts: a comma-separated Indic list already counts correctly
// (Hindi 8/8, Bengali 8/8 on the school-ERP request), and `।` is the Indic FULL STOP, so admitting it
// would score Indic PROSE as a feature list while identical English prose scores nothing. This
// counter gates Software Project Mode and the mega-roadmap, so a false 8 there spends a planner call
// on somebody describing their shop in six sentences.
// ⚠️ A SLASH SEPARATES ONLY WITH SPACE ON BOTH SIDES (autopsy SignBridge, 2026-09-26). Unspaced it
// joins alternatives of ONE thing — "image/video/animation", "build/test process" — or names a path,
// "src/ components/ pages/": that folder listing alone counted as ten features.
const ITEM_SEPARATOR = /\s*(?:[,;|]|\s\/\s|\band\b|&|\baur\b|\btatha\b|\bplus\b)\s*/i;

/** Code or data pasted into a prompt — `{ sign: "HELLO", confidence: 0.92 }` — enumerates no parts. */
const CODE_LINE = /[{}]|=>/;
/** Quoted text is a string the app shows ("Connecting Signs, Voice and People."), never a list of parts. */
const QUOTED = /"[^"\n]*"|“[^”\n]*”|'[^'\n]{3,}'/g;
/** A sentence this long with no list opener is PROSE: its commas are pauses, not a list. */
const PROSE_WORDS = 12;
const SENTENCE_END = /[.!?।]\s*$/;

/** A bullet or numbered list marker at the head of a line. */
const LINE_MARKER = /^\s*(?:[-*•]|\d{1,3}[.)])\s+\S/;

/** Trailing filler a Hinglish list ends with — "…, patient history sab ho". Not part of the item. */
const TRAILING_FILLER = /\b(?:sab|sabhi|etc\.?|vagairah|waghera|wagera|ho|hona|chahiye|honi|hona chahiye)\b/gi;

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Strip the marker, the filler and the punctuation a real sentence leaves around an item. */
function tidy(raw: string): string {
  return String(raw ?? '')
    .replace(LINE_MARKER, (m) => m.replace(/\S.*$/, '')) // keep the text, drop the marker
    .replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '')
    .replace(TRAILING_FILLER, ' ')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this look like a NAMED PART rather than a clause? */
function isItem(s: string): boolean {
  if (!s) return false;
  if (!/\p{L}/u.test(s)) return false;
  return words(s) <= MAX_ITEM_WORDS;
}

/**
 * 🔴 A FIELD OF ONE RECORD IS NOT A FEATURE OF THE APP (autopsy 2a7fa4b0, 2026-09-25).
 *
 * *"App to add expenses with date, category, amount, payment method like cash card UPI, search and
 * sort, total amount and report generation. Backup and restore option too"* counted EIGHT features,
 * and eight is the mega-roadmap line: an ordinary expense tracker was split into six checkpoints, the
 * user got step one (a form, a list and a total) for ₹81, and the search, sort, report and backup they
 * had asked for in the same sentence never arrived. Four of the eight were the COLUMNS of an expense —
 * date, category, amount, payment method — which every one-screen app has, however small.
 *
 * So an item that IS a common attribute of a record, or that attribute followed only by its example
 * values ("payment method like cash card UPI"), is not counted. A module name — students, fees,
 * attendance, pharmacy, payroll — is never on this list, so the project gates that read module lists
 * keep their count. Deliberately a closed list of words, not a heuristic: a gate that spends a planner
 * call must be able to say exactly why it did not.
 */
const RECORD_ATTRIBUTE =
  /^(?:date|dates|time|timing|due date|start date|end date|category|categories|amount|amounts|price|prices|cost|qty|quantity|name|names|title|description|email|e-?mail id|phone|phone number|mobile|mobile number|address|status|priority|note|notes|tag|tags|label|labels|rating|age|gender|remarks?|payment (?:method|mode|type|option)s?)(?:\s+(?:like|such as|e\.?g\.?|ex)\b.*)?$/i;

function isRecordAttribute(item: string): boolean {
  return RECORD_ATTRIBUTE.test(item.trim());
}

/**
 * Count the distinct parts a prompt enumerates — bullets, numbered lines, and inline comma /
 * "and" / "aur" runs alike.
 *
 * ⚠️ It counts ASKS, never words: a long, flowery prompt for a todo app still counts one or two.
 */
export function countEnumeratedFeatures(prompt: string): number {
  return Math.min(enumeratedFeatureItems(prompt).length, MAX_COUNTED);
}

/** The items themselves, in first-seen order — what `countEnumeratedFeatures` counts. PURE. */
export function enumeratedFeatureItems(prompt: string): string[] {
  const text = String(prompt ?? '');
  if (!text.trim()) return [];

  const seen = new Set<string>();
  const add = (raw: string): void => {
    const item = tidy(raw);
    if (!isItem(item)) return;
    if (isRecordAttribute(item)) return;
    seen.add(item.toLowerCase());
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    // A bullet / numbered line is ONE item — the signal that already worked, kept exactly.
    if (LINE_MARKER.test(line)) {
      add(line);
      continue;
    }

    // Code/data and quoted strings enumerate nothing (autopsy SignBridge, 2026-09-26: a pasted JSON
    // example and a quoted tagline were counted as features of a one-app spec, and the prompt was
    // decomposed as a mega project whose planner then burned 315 seconds).
    if (CODE_LINE.test(line)) continue;
    const plain = line.replace(QUOTED, ' ');

    // An inline run. Whatever sits before a list opener is the REQUEST ("ek hospital management
    // system banao jisme …"); the list is what follows it.
    const opener = plain.search(LIST_OPENER);
    const opened = plain.match(LIST_OPENER);
    // No opener, a sentence end and a sentence's length ⇒ prose ("Before finalizing, run the build and
    // fix …", "इसके बाद जो build error, preview error … मिले").
    if (!(opener >= 0 && opened) && SENTENCE_END.test(plain.trim()) && words(plain) > PROSE_WORDS) continue;
    const tail = opener >= 0 && opened ? plain.slice(opener + opened[0].length) : plain;

    const pieces = tail.split(ITEM_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    if (pieces.length < MIN_RUN_ITEMS) continue;
    for (const piece of pieces) add(piece);
  }

  return [...seen];
}
