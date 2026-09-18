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

/** A list-opening connective: what follows it is the list, whatever preceded it was the request. */
const LIST_OPENER =
  /\b(?:with|including|includes|such as|like|having|jisme|jismein|jinme|jinmein|jaise|aur usme|ke saath)\b|:/i;

/** The separators a person actually types between parts of a list, in English and in Hinglish. */
const ITEM_SEPARATOR = /\s*(?:[,;/|]|\band\b|&|\baur\b|\btatha\b|\bplus\b)\s*/i;

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
 * Count the distinct parts a prompt enumerates — bullets, numbered lines, and inline comma /
 * "and" / "aur" runs alike.
 *
 * ⚠️ It counts ASKS, never words: a long, flowery prompt for a todo app still counts one or two.
 */
export function countEnumeratedFeatures(prompt: string): number {
  const text = String(prompt ?? '');
  if (!text.trim()) return 0;

  const seen = new Set<string>();
  const add = (raw: string): void => {
    const item = tidy(raw);
    if (!isItem(item)) return;
    seen.add(item.toLowerCase());
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    // A bullet / numbered line is ONE item — the signal that already worked, kept exactly.
    if (LINE_MARKER.test(line)) {
      add(line);
      continue;
    }

    // An inline run. Whatever sits before a list opener is the REQUEST ("ek hospital management
    // system banao jisme …"); the list is what follows it.
    const opener = line.search(LIST_OPENER);
    const opened = line.match(LIST_OPENER);
    const tail = opener >= 0 && opened ? line.slice(opener + opened[0].length) : line;

    const pieces = tail.split(ITEM_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    if (pieces.length < MIN_RUN_ITEMS) continue;
    for (const piece of pieces) add(piece);
  }

  return Math.min(seen.size, MAX_COUNTED);
}
