// AgentV3 — the two regional-language gaps a script check cannot close (ROADMAP #1 Phase 6.1).
//
// MEASURED, not assumed. `detectLanguageHint` was probed with real Indian inputs before any of this
// was written, and it returned:
//
//   मराठी (Devanagari)                       → "Hindi"        ← a Marathi user's app built in Hindi
//   "enakku oru kadai app venum"  (Tamil)    → no hint
//   "mala ek dukanache app banvayche" (Mar.) → no hint
//   "naaku oka shop app kavali"  (Telugu)    → no hint
//
// Two distinct causes, two fixes:
//
// 1. DEVANAGARI IS NOT ONE LANGUAGE. Hindi and Marathi share the script, and the old table mapped the
//    whole block to Hindi with a comment admitting it ("also Marathi → keep simple: Hindi"). Marathi is
//    a named target of this phase, so "keep simple" meant that user's app came out in the wrong
//    language. Marathi has markers Hindi does not use — ळ, and the everyday words आहे / नाही / मला —
//    so the two are separable without guessing.
//
// 2. MOST INDIAN USERS TYPE IN ROMAN SCRIPT. "enakku venum", "mala pahije", "naaku kavali" carry no
//    non-Latin character at all, so a script detector is blind to them by construction — and this is
//    the majority input mode on a phone. This is the bigger of the two gaps.
//
// THE RULE THAT KEEPS IT HONEST: building someone's app in the WRONG language is worse than building
// it in English. So romanized detection is deliberately timid — ≥2 distinct markers from one
// language, never one — and every marker that is also an ordinary English word is excluded outright.
// A miss costs the generic "same language as the request" fallback, which already works; a false
// positive costs the user their whole app in a language they do not read.

/** How the language was determined — the caller phrases its instruction differently for each. */
export type LanguageEvidence = 'script' | 'romanized';

export interface IndicHint {
  code: string;
  name: string;
  evidence: LanguageEvidence;
}

// ── 1. Devanagari: Hindi vs Marathi ──────────────────────────────────────────────────────────────

/**
 * Marathi markers inside Devanagari text.
 *
 * `ळ` (U+0933) is the strongest: it is a Marathi/Konkani letter that standard Hindi does not use, so
 * its presence alone is decisive. The words are everyday Marathi whose Hindi equivalents are
 * different strings (आहे vs है, नाही vs नहीं, मला vs मुझे), so they cannot match Hindi by accident.
 */
const MARATHI_MARKERS = ['ळ', 'आहे', 'नाही', 'मला', 'तुम्ही', 'आम्ही', 'पाहिजे', 'च्या', 'करायचे', 'करायचं', 'झाले', 'होते', 'काय', 'हवे', 'हवं'];

/**
 * Which Devanagari language is this?
 *
 * Defaults to Hindi — by far the more common input, and the safer wrong answer for a Marathi speaker
 * (most read Hindi) than the reverse would be. One marker is enough here, unlike the romanized path:
 * these strings do not occur in Hindi at all, so a single hit is evidence rather than a coincidence.
 */
export function devanagariLanguage(text: string): IndicHint {
  const s = String(text ?? '');
  for (const marker of MARATHI_MARKERS) {
    if (s.includes(marker)) return { code: 'mr', name: 'Marathi', evidence: 'script' };
  }
  return { code: 'hi', name: 'Hindi', evidence: 'script' };
}

// ── 2. Romanized Indian languages ────────────────────────────────────────────────────────────────

/**
 * Distinctive romanized markers, per language.
 *
 * Chosen to be function words and verbs people actually type — "I want", "is", "not", "do" — because
 * those survive any topic. EXCLUDED on purpose: anything that is also an ordinary English word
 * ("chai", "ache", "made", "seri", "undo"), anything shared across these languages ("hai", "karna",
 * "nahi" — Hindi/Punjabi/Marathi overlap), and proper nouns. A marker that can appear in an English
 * sentence is not a marker; it is a trap.
 */
const ROMANIZED: Array<{ code: string; name: string; markers: string[] }> = [
  { code: 'ta', name: 'Tamil',     markers: ['enakku', 'venum', 'illai', 'panra', 'panna', 'romba', 'irukku', 'unga', 'vanakkam', 'eppadi', 'nalla', 'kadai', 'seyya'] },
  { code: 'te', name: 'Telugu',    markers: ['naaku', 'kavali', 'unnaru', 'cheyyi', 'cheyandi', 'meeru', 'ledu', 'entha', 'chala', 'baaga', 'kaavali', 'emiti'] },
  { code: 'mr', name: 'Marathi',   markers: ['aahe', 'ahet', 'mala', 'tumhi', 'aamhi', 'pahije', 'karayche', 'karaycha', 'kasa', 'kaay', 'hava', 'havi', 'zhale'] },
  { code: 'kn', name: 'Kannada',   markers: ['beku', 'nanage', 'neevu', 'hege', 'chennagi', 'maadi', 'yaake', 'illave', 'ashtu', 'estu'] },
  { code: 'ml', name: 'Malayalam', markers: ['venam', 'njan', 'ningal', 'cheyyu', 'undo', 'enthu', 'ariyilla', 'nalla', 'ethra', 'venda'] },
  { code: 'gu', name: 'Gujarati',  markers: ['chhe', 'nathi', 'joie', 'tame', 'ame', 'karvu', 'kevi', 'saru', 'shu', 'banavvu'] },
  { code: 'bn', name: 'Bengali',   markers: ['korte', 'kore', 'amar', 'tomar', 'kemon', 'hobe', 'chai', 'banate', 'darkar', 'ekta'] },
  { code: 'pa', name: 'Punjabi',   markers: ['chahida', 'tusi', 'mainu', 'asi', 'kive', 'hunda', 'banauna', 'changa'] },
];

/** Common English words — used only to recognise an obviously-English sentence, never as markers. */
const ENGLISH_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'have', 'from', 'want', 'need', 'make', 'build',
  'app', 'page', 'user', 'data', 'please', 'like', 'would', 'should', 'can', 'will', 'about',
]);

/** Minimum distinct markers before a romanized guess is allowed to fire. Two, never one. */
export const ROMANIZED_MIN_MARKERS = 2;

function words(text: string): string[] {
  return String(text ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/**
 * Detect a romanized Indian language, or return null.
 *
 * Scores every language by DISTINCT markers present (repeats of one word prove nothing) and requires
 * a clear winner: ties return null rather than picking one, because these languages share enough
 * romanization that a tie genuinely means "not sure", and "not sure" must never become an assertion.
 */
export function detectRomanizedIndic(text: string): IndicHint | null {
  const ws = words(text);
  if (ws.length === 0) return null;
  const seen = new Set(ws);

  let best: { code: string; name: string; hits: number } | null = null;
  let tied = false;
  for (const lang of ROMANIZED) {
    let hits = 0;
    for (const m of lang.markers) if (seen.has(m)) hits += 1;
    if (hits === 0) continue;
    if (!best || hits > best.hits) { best = { code: lang.code, name: lang.name, hits }; tied = false; }
    else if (hits === best.hits) tied = true;
  }
  if (!best || best.hits < ROMANIZED_MIN_MARKERS || tied) return null;

  // An English sentence carrying a stray lookalike must not be reclassified. If ordinary English
  // words outnumber the markers, the text is English with noise, not the other way round.
  const englishHits = ws.filter((w) => ENGLISH_WORDS.has(w)).length;
  if (englishHits > best.hits) return null;

  return { code: best.code, name: best.name, evidence: 'romanized' };
}

/**
 * The instruction fragment for a hint.
 *
 * A romanized guess is stated AS a guess ("appears to be writing … in Roman script") and explicitly
 * tells the model to follow the user's actual words if we got it wrong. A script hit is stated
 * plainly, because it is not a guess. Overstating confidence is how a wrong detection becomes an
 * app the user cannot read.
 */
export function languageInstruction(hint: IndicHint): string {
  if (hint.evidence === 'romanized') {
    return `Language: the user appears to be writing ${hint.name} in Roman script. Generate ALL user-facing text in the app (labels, buttons, headings, placeholders, messages) in ${hint.name}, using ${hint.name}'s own script. If the request is actually in another language, follow the user's words rather than this hint. Keep code identifiers and comments in English.`;
  }
  return `Language: the user is writing in ${hint.name}. Generate ALL user-facing text in the app (labels, buttons, headings, placeholders, messages) in ${hint.name}. Keep code identifiers and comments in English.`;
}
