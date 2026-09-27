// AgentV3 — negation-aware feature-request detection (shared, pure).
//
// ROOT CAUSE it fixes (admin deep-test App #1, 2026-07-13 — the "digital clock" report): the prompt
// ended with "No settings, no other features — just the live clock". The requirement-coverage detector
// keyword-matched `\bsettings\b` and reported a false warning "Requested feature not found: settings" —
// it flagged a feature the user EXPLICITLY declined. A plain keyword test cannot tell "add settings"
// from "no settings". This shared helper checks that at least ONE mention of the feature is affirmative
// (not immediately preceded by a negation cue), so an explicitly-declined feature is never treated as
// requested. Pure (its one import is a pure string contract); used by both RequirementCoverage and FeaturePresence so the two
// keyword detectors can never drift on this (rule 2 — one shared implementation).

import { isPlatformFixRequest } from '../../lib/platformFixRequest';

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
 * 🔴 MACHINE TEXT IS NOT A REQUEST (autopsy "Lekhan Sahyak", 2026-09-27).
 *
 * The preview's "Fix with AI" request quoted a stack trace, and one of its frames was
 * `eval at requireModule (about:srcdoc:739:12)`. `\babout\b` matched it, and four builds were told —
 * and then graded on — "Requested feature not found: about page". The requirement contract hands
 * these labels to the builder as ORDERS, so a word inside a URL can make the engine build a page
 * nobody asked for.
 *
 * So a URL, a `scheme:` token and a stack-frame line are blanked before any feature is read. A person
 * asking for an About page writes the word in a sentence; nobody asks for one inside `about:blank`.
 * PURE.
 */
export function withoutMachineText(text: string): string {
  return String(text ?? '')
    // Stack frames: "    at App (eval at requireModule (about:srcdoc:739:12), <anonymous>:22:46)".
    .replace(/^[ \t]*at [^\n]*$/gm, (m) => ' '.repeat(m.length))
    // URLs and scheme tokens: https://…, about:srcdoc, blob:…, data:…, file:…, chrome-extension://…
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|(?:about|blob|data|file|javascript|webpack|node):(?=[^\s]))[^\s)'"]*/gi, (m) => ' '.repeat(m.length));
}

/**
 * True when `feature` (a RegExp matching the feature keyword) is requested AFFIRMATIVELY at least once
 * in `prompt` — i.e. there is a mention that is NOT immediately preceded by a negation cue. Returns
 * false when the feature is absent, or when EVERY mention is negated ("No settings, no other features").
 * Pure; never throws. The passed RegExp does not need the global flag — a fresh global copy is used.
 */
export function isAffirmativelyRequested(rawPrompt: string, feature: RegExp): boolean {
  if (typeof rawPrompt !== 'string' || !rawPrompt) return false;
  // A request NavBharatAI composed around a captured error asks for no feature at all (see below).
  if (isPlatformFixRequest(rawPrompt)) return false;
  const prompt = withoutMachineText(rawPrompt);
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
