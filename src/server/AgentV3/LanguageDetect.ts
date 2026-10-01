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

import { devanagariLanguage, detectRomanizedIndic, languageInstruction, type LanguageEvidence } from './IndicLanguage';

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
  // DEVANAGARI IS NOT ONE LANGUAGE (Phase 6.1). Hindi and Marathi share the block, and this table
  // used to map all of it to Hindi with a comment admitting it — so a Marathi user's app was built
  // in Hindi. Marathi has markers Hindi does not use, so the two separate without guessing.
  if (script.code === 'hi') return devanagariLanguage(text);
  return { code: script.code, name: script.name, evidence: 'script' };
}

// ── The build's language line — ONE source for the architect and every sub-agent ───────────────────

/**
 * Does the request itself ask for a language, a translation or a script? ("hindi me banao", "in
 * Tamil", "bilingual", "translate the labels"). When it does, the user has decided and the generic
 * "follow the request" line is the right one — this module must never override an explicit ask.
 * Deliberately broad: a false match only costs today's behaviour.
 */
const NAMES_A_LANGUAGE_RE =
  /\b(?:hindi|marathi|tamil|telugu|bengali|bangla|gujarati|kannada|malayalam|punjabi|odia|oriya|urdu|assamese|sanskrit|nepali|konkani|devanagari|hinglish|english|spanish|french|german|arabic|japanese|chinese|multi-?lingual|bi-?lingual|translat\w*|i18n|locali[sz]\w*|languages?|bhasha)\b/i;

export function requestNamesAppLanguage(text: string): boolean {
  return NAMES_A_LANGUAGE_RE.test(String(text ?? ''));
}

/**
 * 🔴 A REQUEST WRITTEN IN LATIN LETTERS IS NOT AN INVITATION TO SWITCH SCRIPT (autopsy 466c260a,
 * 2026-09-29). "Notes, Visualizeusing, pdf code file handling picture editor, pro chat codestudeo and
 * more" — every word English, no Indian script, no romanized marker — was built with every label in
 * Devanagari (`src/locales/hi.ts`), the reply opened "Namaste!", and the summary told the user
 * "Saara user-facing text Hindi mein hai, jaise aapne request ki thi". They had requested nothing of
 * the kind.
 *
 * The detector was right (it returned null); the INSTRUCTION was the gap. "Use the same language the
 * user used" leaves the choice to a model whose system prompt carries Indian branding and Hindi
 * phrases — the exact bias `systemPrompt.ts` already names for the chat reply. The line now states the
 * one fact the detector established: the request is in Latin letters, so the app stays in Latin
 * letters. It does not force ENGLISH (Latin cannot tell English from Spanish), and Roman Hinglish
 * stays allowed for a request that mixes Hindi words — only the unrequested switch of script and
 * language is forbidden.
 *
 * 🔴 CORRECTED (autopsy 6e646503, 2026-09-30): it used to say the request was "English, or Hindi words
 * typed in Roman letters" — so a romanized GUJARATI question the detector could not name was, in the
 * model's instructions, English or Hinglish, and it was answered in English. The line now names the
 * Indian languages people type in Roman letters and forbids answering them in English.
 */
export const LATIN_REQUEST_LANGUAGE_LINE =
  'Language: the user wrote this request in LATIN letters — English, or an Indian language (Hindi, Gujarati, '
  + 'Marathi, Tamil, …) typed in Roman letters — and did not ask for any other language. Write ALL user-facing '
  + 'text in the app (labels, buttons, headings, placeholders, messages) in the SAME language they wrote in, in '
  + 'Latin letters — English for an English request, that language in Roman letters for anything else. NEVER '
  + 'switch to Devanagari or any other script, never translate the app into a language they did not write in, '
  + 'and never tell them they asked for one. Reply to them in the language they wrote in — a message that is '
  + 'not English is never answered in English. Keep code identifiers and comments in English.';

const GENERIC_LANGUAGE_LINE =
  'Language: generate all user-facing text in the app in the SAME language the user used in this request '
  + '(default to English if it is English). Keep code identifiers and comments in English.';

/**
 * The language line for a build — the architect's prompt and every sub-agent's context read THIS, so
 * the child that actually writes the labels is never told less than the parent (in 466c260a the
 * frontend specialist wrote `locales/hi.ts` because the only language it ever heard of was the one
 * the architect chose). PURE.
 */
/**
 * 🔴 AN EDIT KEEPS THE APP'S LANGUAGE (autopsy 4d538ca3, 2026-10-01). A Bengali personal-assistant app
 * (every label Bengali: "💬 চ্যাট", "🧠 মেমরি") was continued with an ENGLISH message, and the line above
 * told the builder to write ALL user-facing text "in the SAME language they wrote in, in Latin letters"
 * and "never translate the app into a language they did not write in" — an order to put English labels
 * into a Bengali app. The model happened to keep Bengali; the instruction pointed the other way. The
 * language of one follow-up message is not the language of the app it edits. Unless the request names
 * a language, new text matches what the app already uses, and only the REPLY follows the message.
 */
export const EDIT_LANGUAGE_LINE =
  'Language: this turn changes an EXISTING app. Every new label, button, heading, placeholder and message '
  + 'you add must be in the language and script the app ALREADY uses — read its current labels and match '
  + 'them, even when the user wrote this message in another language. Never mix two languages in one app '
  + 'unless the user asks for it. Reply to the user in the language they wrote this message in. Keep code '
  + 'identifiers and comments in English.';

export function appLanguageInstruction(prompt: string, opts: { editingExistingApp?: boolean } = {}): string {
  if (opts.editingExistingApp && !requestNamesAppLanguage(prompt)) return EDIT_LANGUAGE_LINE;
  const hint = detectLanguageHint(prompt);
  if (hint) return languageInstruction({ code: hint.code, name: hint.name, evidence: hint.evidence ?? 'script' });
  if (requestNamesAppLanguage(prompt)) return GENERIC_LANGUAGE_LINE;
  return /[A-Za-z]/.test(String(prompt ?? '')) ? LATIN_REQUEST_LANGUAGE_LINE : GENERIC_LANGUAGE_LINE;
}
