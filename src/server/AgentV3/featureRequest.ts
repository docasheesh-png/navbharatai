// AgentV3 — negation-aware feature-request detection (shared, pure).
//
// ROOT CAUSE it fixes (admin deep-test App #1, 2026-07-13 — the "digital clock" report): the prompt
// ended with "No settings, no other features — just the live clock". The requirement-coverage detector
// keyword-matched `\bsettings\b` and reported a false warning "Requested feature not found: settings" —
// it flagged a feature the user EXPLICITLY declined. A plain keyword test cannot tell "add settings"
// from "no settings". This shared helper checks that at least ONE mention of the feature is affirmative
// (not immediately preceded by a negation cue), so an explicitly-declined feature is never treated as
// requested. Pure + dependency-free; used by both RequirementCoverage and FeaturePresence so the two
// keyword detectors can never drift on this (rule 2 — one shared implementation).

// Negation cues that, appearing just before a feature keyword, mean the user is DECLINING it.
const NEGATION_CUES = /\b(no|not|without|never|except|exclude|excluding|omit|omitting|skip|skipping|remove|removing|don'?t|doesn'?t|avoid|avoiding|disable|disabled|disabling|minus)\b/i;

// How many characters before a match to inspect for a negation cue ("no other features" style phrasing
// can put the cue a few words back, so a small window covers "no ... settings" too).
const LOOKBEHIND = 24;

/**
 * Cues that mark a mention as LATER WORK rather than a request for THIS build.
 *
 * ROOT CAUSE (BENCHMARK 0 report, 2026-08-12): the admin's prompt opened by describing the plan — build
 * a deliberately tiny 3D game first, then take the SAME game from 0 to 100 through successive edits.
 * Those later stages mentioned login and payments. The engine read the whole message as one list of
 * requirements and reported "Requested feature not found: login / authentication" and "…: payment"
 * against a coin-collector game that was never supposed to have either.
 *
 * A plain keyword test cannot tell "add login" from "we'll add login in stage 3" any more than it could
 * tell it from "no login" — which is the bug this file already exists to fix, in a different tense.
 * Deliberately conservative: a cue must sit close to the mention, on EITHER side, because a roadmap
 * writes both "later we add payments" and "payments come later".
 */
const DEFERRED_CUES = /\b(later|afterwards?|eventually|subsequent(?:ly)?|future|next\s+(?:step|stage|phase|round|build|version|prompt)|phase\s*\d|stage\s*\d|step\s*\d|benchmark\s*\d|roadmap|milestone|for\s+now\s+(?:skip|no)|baad\s*me[ni]?|aage|agli?\s+(?:baar|step|stage))\b/i;
/** How far either side of a mention to look for a deferral cue. */
const DEFER_WINDOW = 40;

/**
 * True when `feature` (a RegExp matching the feature keyword) is requested AFFIRMATIVELY at least once
 * in `prompt` — i.e. there is a mention that is NOT immediately preceded by a negation cue. Returns
 * false when the feature is absent, or when EVERY mention is negated ("No settings, no other features").
 * Pure; never throws. The passed RegExp does not need the global flag — a fresh global copy is used.
 */
export function isAffirmativelyRequested(prompt: string, feature: RegExp): boolean {
  if (typeof prompt !== 'string' || !prompt) return false;
  let g: RegExp;
  try {
    g = new RegExp(feature.source, feature.flags.includes('g') ? feature.flags : feature.flags + 'g');
  } catch {
    return feature.test(prompt); // pathological flags — fall back to the plain test
  }
  let m: RegExpExecArray | null;
  let sawMention = false;
  let guard = 0;
  while ((m = g.exec(prompt)) !== null && guard++ < 1000) {
    sawMention = true;
    const start = Math.max(0, m.index - LOOKBEHIND);
    const before = prompt.slice(start, m.index);
    // A mention framed as later work is not a request for THIS build — checked on both sides, because
    // a roadmap writes "later we add payments" and "payments come later" with equal ease.
    const deferStart = Math.max(0, m.index - DEFER_WINDOW);
    const around = prompt.slice(deferStart, Math.min(prompt.length, m.index + m[0].length + DEFER_WINDOW));
    const deferred = DEFERRED_CUES.test(around);
    if (!NEGATION_CUES.test(before) && !deferred) return true; // an affirmative, present-tense mention
    if (m.index === g.lastIndex) g.lastIndex++;    // avoid an infinite loop on a zero-width match
  }
  // Either no mention at all, or every mention was negated or deferred → not requested for this build.
  return sawMention ? false : false;
}
