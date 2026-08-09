/**
 * WHICH LANGUAGE THE PLATFORM SPEAKS IN (ROADMAP item 6, half 1).
 *
 * THE PROBLEM THIS EXISTS FOR: `LANGUAGE_RULE` already makes the MODEL mirror the user's language —
 * a user who writes in Hindi gets Hindi replies and Hindi narration from the AI. But roughly 157
 * narration lines during a build are emitted by OUR SERVER (`ToolDispatcher`, `routes/agentv3.ts`)
 * and never pass through a model at all: "🗄️ Provisioning a local PostgreSQL…", "🔐 Loaded 3 of your
 * saved keys…". No prompt rule can reach those. The result is one feed where the AI speaks Hindi and
 * the platform answers in English — the most jarring thing about using NavBharatAI in an Indian
 * language.
 *
 * 🔒 ONE DETECTOR, NOT A SECOND ONE. This module deliberately owns NO detection logic. The language a
 * build is in is already decided by `AgentV3/LanguageDetect.detectLanguageHint` — the same function
 * that drives the app's generated-text language and the weak-tier notice. A private script counter
 * here would be a SECOND source of truth with its own threshold, and the day the two disagreed the
 * AI would speak Hindi while the platform answered in English: precisely the defect this module was
 * built to remove. So the decision is delegated, and this file only MAPS that one verdict onto the
 * languages the platform itself can write.
 *
 * ⚠️ ROMANISED HINDI ("Hinglish") RESOLVES TO ENGLISH — deliberately, and it is not a gap.
 * `detectLanguageHint` reports romanised Indic with `evidence: 'romanized'`, and that hint is used to
 * pick the language of the APP's generated text. The platform's narration has to match something
 * different: the AI's own REPLIES, which `LANGUAGE_RULE` mirrors from the user's words — so a user
 * typing `mujhe ek todo app banao` is answered in romanised Hinglish, in Latin script. Emitting
 * Devanagari status lines beside those Latin replies would create the very mismatch this module
 * exists to kill. Only `evidence: 'script'` — the user actually wrote in Devanagari — takes Hindi.
 */

import { detectLanguageHint } from '../AgentV3/LanguageDetect';

/** A language the platform itself can speak. Adding one is a catalogue entry, never a code change. */
export type NarrationLanguage = 'en' | 'hi';

/** Every language with a COMPLETE catalogue. `en` is the source language and is always present. */
export const SUPPORTED_NARRATION_LANGUAGES: readonly NarrationLanguage[] = ['en', 'hi'];

export function isSupportedNarrationLanguage(v: unknown): v is NarrationLanguage {
  return typeof v === 'string' && (SUPPORTED_NARRATION_LANGUAGES as readonly string[]).includes(v);
}

/**
 * Which detected language code maps to words WE CAN ACTUALLY WRITE. `hi` covers Devanagari (Hindi and
 * Marathi share the script — `LanguageDetect` documents that simplification, and this inherits it
 * rather than inventing a second opinion).
 *
 * Every other language the shared detector can name — Tamil, Bengali, Telugu, Kannada, Malayalam,
 * Punjabi, Odia, Urdu, and the non-Indian scripts — is recognised but has no catalogue yet, so it
 * resolves to English rather than being served Hindi it did not ask for. An honest fallback beats a
 * confident wrong language. Adding Tamil later is one complete catalogue plus one line here.
 */
const CODE_TO_LANGUAGE: Record<string, NarrationLanguage> = {
  hi: 'hi',
  // ⚠️ Marathi ('mr') is deliberately ABSENT. It shares the Devanagari block, and `devanagariLanguage`
  // already separates the two by marker words — so a Marathi prompt is KNOWN to be Marathi here, and
  // answering it in Hindi would be the confident-wrong-language failure this file exists to avoid.
  // It falls through to English until a Marathi catalogue exists.
};

/**
 * How much of the prompt must actually BE that script before the platform switches. Deliberately far
 * stricter than the shared detector's own `DOMINANCE_THRESHOLD`, and measured against the SAME count
 * (`scriptShare`) rather than a second script table — that is what keeps one source of truth.
 *
 * Why stricter: the two consumers answer different questions. "Which language should the APP's text
 * be in?" is generous on purpose — `Build a dashboard and label it डैशबोर्ड` plausibly wants a Hindi
 * app. "Which language is the model REPLYING in?" is not: `LANGUAGE_RULE` mirrors the user's own
 * words, so that same mostly-English prompt gets an English reply, and Hindi status lines beside an
 * English reply would be a NEW mismatch. Requiring a majority means the platform only switches when
 * the user is genuinely writing in that script.
 */
export const NARRATION_SCRIPT_SHARE = 0.5;

/**
 * The language the SERVER's own narration should use for this build. Never throws: a detector failure
 * degrades to English, because a language decision must not be able to break a build.
 */
export function resolveNarrationLanguage(prompt: string | null | undefined): NarrationLanguage {
  try {
    const hint = detectLanguageHint(String(prompt ?? ''));
    if (!hint) return 'en';
    // A romanised guess is a guess about the APP's language, not about how the AI is replying — see
    // the header. Only a prompt genuinely written in the script takes that script's narration.
    if (hint.evidence === 'romanized') return 'en';
    if (typeof hint.scriptShare !== 'number' || hint.scriptShare < NARRATION_SCRIPT_SHARE) return 'en';
    return CODE_TO_LANGUAGE[hint.code] ?? 'en';
  } catch {
    return 'en';
  }
}
