// AgentV3 — Language Detection (Layer 73 / Universal Language).
//
// "Build in the user's language": when a user writes their build request in
// Hindi/Tamil/Bengali/etc., the generated app's USER-FACING text (labels,
// buttons, headings, messages) should come out in THAT language. Claude is
// multilingual, so the route just instructs it. This module names the language
// explicitly for distinctive (non-Latin) scripts, which gives a stronger,
// less-ambiguous instruction than "use the same language as the request".
//
// We deliberately return null for Latin-script input: Latin alone cannot
// distinguish English from Spanish/French/etc., so the route falls back to a
// generic "same language as the request" instruction for those.
//
// PURE & deterministic: no I/O. The route wiring that calls this is wrapped so
// it can NEVER affect (let alone break) a build.

import { devanagariLanguage, detectRomanizedIndic, type LanguageEvidence } from './IndicLanguage';

/** A detected language: a short tag plus an English display name. */
export interface LanguageHint {
  /** Short tag (e.g. 'hi', 'ta'). */
  code: string;
  /** English display name fed into the build instruction (e.g. 'Hindi'). */
  name: string;
  /**
   * HOW we know (Phase 6.1). A distinctive script is proof; a romanized guess is a guess, and the
   * instruction says so out loud rather than asserting it — see `languageInstruction`. Optional so
   * every existing caller keeps compiling unchanged.
   */
  evidence?: LanguageEvidence;
  /**
   * WHAT SHARE of the prompt's counted letters belong to this script, 0–1 (absent for a `romanized`
   * hint, which counts marker words rather than letters).
   *
   * Why it is exposed (ROADMAP item 6): two different consumers key off this ONE measurement at
   * different bars, and they should never each count letters themselves. The APP's generated-text
   * language is right to be generous — `DOMINANCE_THRESHOLD` — because a prompt carrying real Hindi
   * words usually wants a Hindi app. The PLATFORM's own narration has to match something stricter:
   * the language the model REPLIES in, which `LANGUAGE_RULE` mirrors from the user's own words. A
   * mostly-English prompt with one Devanagari label gets an English reply, so English status lines.
   * Exposing the share lets `lib/narrationLanguage` require a higher bar against the SAME count,
   * instead of maintaining a second script table that would drift away from this one.
   */
  scriptShare?: number;
}

/** A Unicode script range mapped to a language hint. */
interface ScriptRange {
  code: string;
  name: string;
  /** Inclusive [start, end] code-point ranges that belong to this script. */
  ranges: Array<[number, number]>;
}

// Distinctive scripts we can name explicitly. Order is irrelevant; we pick the
// dominant one by counted character share. Covers all major Indian scripts plus
// the major world scripts we can reliably distinguish from Latin.
const SCRIPTS: ScriptRange[] = [
  { code: 'hi', name: 'Hindi', ranges: [[0x0900, 0x097f]] }, // Devanagari (also Marathi) → keep simple: Hindi
  { code: 'bn', name: 'Bengali', ranges: [[0x0980, 0x09ff]] },
  { code: 'pa', name: 'Punjabi', ranges: [[0x0a00, 0x0a7f]] }, // Gurmukhi
  { code: 'gu', name: 'Gujarati', ranges: [[0x0a80, 0x0aff]] },
  { code: 'or', name: 'Odia', ranges: [[0x0b00, 0x0b7f]] }, // Oriya
  { code: 'ta', name: 'Tamil', ranges: [[0x0b80, 0x0bff]] },
  { code: 'te', name: 'Telugu', ranges: [[0x0c00, 0x0c7f]] },
  { code: 'kn', name: 'Kannada', ranges: [[0x0c80, 0x0cff]] },
  { code: 'ml', name: 'Malayalam', ranges: [[0x0d00, 0x0d7f]] },
  { code: 'ar', name: 'Arabic/Urdu', ranges: [[0x0600, 0x06ff]] },
  { code: 'zh', name: 'Chinese', ranges: [[0x4e00, 0x9fff]] }, // Han/CJK
  { code: 'ja', name: 'Japanese', ranges: [[0x3040, 0x30ff]] }, // Hiragana + Katakana
  { code: 'ko', name: 'Korean', ranges: [[0xac00, 0xd7af], [0x1100, 0x11ff]] }, // Hangul
  { code: 'ru', name: 'Russian', ranges: [[0x0400, 0x04ff]] }, // Cyrillic
];

/** Basic Latin + Latin-1/extended letter ranges — these never trigger a hint. */
const LATIN_RANGES: Array<[number, number]> = [
  [0x0041, 0x005a], // A–Z
  [0x0061, 0x007a], // a–z
  [0x00c0, 0x024f], // Latin-1 Supplement + Latin Extended-A/B (accented Latin)
];

/**
 * Minimum share of counted letters a distinctive script must reach before we
 * name it. Conservative on purpose: a couple of stray non-Latin characters in
 * an otherwise-English prompt must NOT trigger a hint.
 */
const DOMINANCE_THRESHOLD = 0.15;

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (cp >= start && cp <= end) return true;
  }
  return false;
}

/**
 * Detect a language hint from the dominant distinctive (non-Latin) script in
 * `text`. PURE & deterministic.
 *
 * Returns a hint only when a single distinctive script clearly dominates the
 * letters (≥ DOMINANCE_THRESHOLD of all counted Latin + distinctive-script
 * letters, and it is the top distinctive script). Returns null for empty,
 * Latin-script, or ambiguous input — the caller then uses a generic
 * "same language as the request" instruction.
 */
export function detectLanguageHint(text: string): LanguageHint | null {
  if (typeof text !== 'string' || text.length === 0) return null;

  const counts = new Array<number>(SCRIPTS.length).fill(0);
  let latinLetters = 0;
  let distinctiveLetters = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;

    if (inRanges(cp, LATIN_RANGES)) {
      latinLetters += 1;
      continue;
    }

    for (let i = 0; i < SCRIPTS.length; i += 1) {
      if (inRanges(cp, SCRIPTS[i].ranges)) {
        counts[i] += 1;
        distinctiveLetters += 1;
        break;
      }
    }
    // Anything else (digits, spaces, punctuation, symbols) is ignored — it does
    // not help distinguish a language.
  }

  // NO DISTINCTIVE SCRIPT — but that is NOT the same as "no language" (Phase 6.1). Most Indian
  // users type on a phone in Roman script: "enakku oru kadai app venum" carries zero non-Latin
  // characters, so a script detector is blind to it by construction. Probed before this was added:
  // romanized Tamil, Telugu and Marathi all returned null here. The romanized pass is deliberately
  // timid (≥2 distinct markers, no English lookalikes, ties refused) — a miss costs the generic
  // fallback that already works, while a false positive costs the user their whole app in a
  // language they cannot read.
  if (distinctiveLetters === 0) return detectRomanizedIndic(text);

  // Find the top distinctive script.
  let topIdx = -1;
  let topCount = 0;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] > topCount) {
      topCount = counts[i];
      topIdx = i;
    }
  }
  if (topIdx === -1) return null;

  // Dominance is measured against ALL counted letters (Latin + distinctive),
  // so a couple of non-Latin characters inside a long English prompt stay below
  // the threshold and return null.
  const totalLetters = latinLetters + distinctiveLetters;
  if (totalLetters === 0) return null;
  if (topCount / totalLetters < DOMINANCE_THRESHOLD) return null;

  const script = SCRIPTS[topIdx];
  const scriptShare = topCount / totalLetters;
  // DEVANAGARI IS NOT ONE LANGUAGE (Phase 6.1). Hindi and Marathi share the block, and this table
  // used to map all of it to Hindi with a comment admitting it — so a Marathi user's app was built
  // in Hindi. Marathi has markers Hindi does not use, so the two separate without guessing.
  if (script.code === 'hi') return { ...devanagariLanguage(text), scriptShare };
  return { code: script.code, name: script.name, evidence: 'script', scriptShare };
}
