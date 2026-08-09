/**
 * WHICH LANGUAGE THE PLATFORM SPEAKS IN (ROADMAP item 6, half 1).
 *
 * THE PROBLEM THIS EXISTS FOR: `LANGUAGE_RULE` already makes the MODEL mirror the user's language —
 * a user who writes in Hindi gets Hindi replies and Hindi narration from the AI. But roughly 157
 * narration lines during a build are emitted by OUR SERVER (`ToolDispatcher`, `routes/agentv3.ts`)
 * and never pass through a model at all: "🗄️ Provisioning a local PostgreSQL…", "🔐 Loaded 3 of your
 * saved keys…". No prompt rule can reach those. The result is one feed where the AI speaks Hindi and
 * the platform answers in English — the single most jarring thing about using NavBharatAI in an
 * Indian language.
 *
 * HOW THE LANGUAGE IS DECIDED — from the user's OWN WORDS, by SCRIPT, exactly as `LANGUAGE_RULE`
 * instructs the model. Script detection is used rather than a language-detection model because it is
 * deterministic, free, instant, and cannot disagree with itself between two lines of the same build.
 *
 * ⚠️ ROMANISED HINDI ("Hinglish") DELIBERATELY RESOLVES TO ENGLISH. A user typing `mujhe ek todo app
 * banao` in Latin script gets English narration — and that is CORRECT, not a gap: `LANGUAGE_RULE`
 * tells the model to decide from the user's own words too, so the model also answers such a prompt in
 * romanised Hindi/English. Guessing Devanagari output for a Latin-script prompt would make the
 * platform disagree with the AI in the very same feed, which is the bug this module exists to kill.
 */

/** A language the platform itself can speak. Adding one is a catalogue entry, never a code change. */
export type NarrationLanguage = 'en' | 'hi';

/** Every language with a COMPLETE catalogue. `en` is the source language and is always present. */
export const SUPPORTED_NARRATION_LANGUAGES: readonly NarrationLanguage[] = ['en', 'hi'];

export function isSupportedNarrationLanguage(v: unknown): v is NarrationLanguage {
  return typeof v === 'string' && (SUPPORTED_NARRATION_LANGUAGES as readonly string[]).includes(v);
}

/**
 * Scripts we can recognise. A script is NOT a language (Devanagari carries both Hindi and Marathi),
 * so this reports the script honestly and `resolveNarrationLanguage` maps it to a language we
 * genuinely have words for — it never claims Marathi by writing Hindi.
 */
export type DetectedScript = 'devanagari' | 'tamil' | 'bengali' | 'telugu' | 'gujarati' | 'kannada' | 'malayalam' | 'gurmukhi' | 'odia' | 'latin' | 'unknown';

const SCRIPT_RANGES: ReadonlyArray<{ script: DetectedScript; re: RegExp }> = [
  { script: 'devanagari', re: /[ऀ-ॿ]/g },
  { script: 'bengali', re: /[ঀ-৿]/g },
  { script: 'gurmukhi', re: /[਀-੿]/g },
  { script: 'gujarati', re: /[઀-૿]/g },
  { script: 'odia', re: /[଀-୿]/g },
  { script: 'tamil', re: /[஀-௿]/g },
  { script: 'telugu', re: /[ఀ-౿]/g },
  { script: 'kannada', re: /[ಀ-೿]/g },
  { script: 'malayalam', re: /[ഀ-ൿ]/g },
  { script: 'latin', re: /[A-Za-z]/g },
];

/**
 * Share of the prompt's LETTERS that must belong to a non-Latin script before we call the prompt that
 * script's. A threshold (not "one character wins") because prompts routinely carry an app name, a
 * quoted label or a pasted error in another script — `"Build a डैशबोर्ड app"` is an English prompt
 * with one Hindi word, and flipping the whole platform to Hindi on it would be wrong.
 */
export const SCRIPT_SHARE_THRESHOLD = 0.2;

/** Code, urls, file paths and identifiers are Latin by necessity and say nothing about the user. */
function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code
    .replace(/`[^`]*`/g, ' ')                  // inline code
    .replace(/https?:\/\/\S+/g, ' ')           // urls
    .replace(/[\w./-]+\.[a-z]{2,4}\b/gi, ' '); // file paths / hostnames
}

/**
 * The dominant script of a prompt. Pure and allocation-light; returns 'unknown' for a prompt with no
 * letters at all (an emoji, a number, an empty string) so the caller can keep its own default rather
 * than being handed a guess.
 */
export function detectScript(text: string | null | undefined): DetectedScript {
  const prose = stripNonProse(String(text ?? ''));
  let total = 0;
  const counts = new Map<DetectedScript, number>();
  for (const { script, re } of SCRIPT_RANGES) {
    const n = (prose.match(re) || []).length;
    if (n > 0) { counts.set(script, n); total += n; }
  }
  if (total === 0) return 'unknown';
  let best: DetectedScript = 'latin';
  let bestN = -1;
  for (const [script, n] of counts) {
    if (script === 'latin') continue;
    if (n > bestN) { best = script; bestN = n; }
  }
  if (bestN <= 0) return 'latin';
  return bestN / total >= SCRIPT_SHARE_THRESHOLD ? best : 'latin';
}

/**
 * Which script maps to which language WE CAN ACTUALLY WRITE. Devanagari → Hindi. Every other Indian
 * script is recognised but has no catalogue yet, so it resolves to English rather than being served
 * Hindi it did not ask for — an honest fallback beats a confident wrong language.
 *
 * Adding Tamil later is a data change (one complete catalogue) plus one line here; nothing else moves.
 */
const SCRIPT_TO_LANGUAGE: Partial<Record<DetectedScript, NarrationLanguage>> = {
  devanagari: 'hi',
};

/**
 * The language the SERVER's own narration should use for this build. Falls back to English for any
 * prompt whose language we cannot write, which is the only honest answer available.
 */
export function resolveNarrationLanguage(prompt: string | null | undefined): NarrationLanguage {
  return SCRIPT_TO_LANGUAGE[detectScript(prompt)] ?? 'en';
}
