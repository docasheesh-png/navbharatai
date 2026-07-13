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
    if (!NEGATION_CUES.test(before)) return true; // an affirmative mention → requested
    if (m.index === g.lastIndex) g.lastIndex++;    // avoid an infinite loop on a zero-width match
  }
  // Either no mention at all, or every mention was negated → not affirmatively requested.
  return sawMention ? false : false;
}
