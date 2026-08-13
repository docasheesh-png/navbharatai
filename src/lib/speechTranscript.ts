/**
 * VOICE TYPING — one correct way to turn speech events into text.
 *
 * ADMIN REPORT 2026-08-13 (a real user, on Android): dictating into the free chat produced
 *
 *   "voicevoice typingvoice typing Meinvoice typing Mein Kuchhvoice typing Mein Kuchh Bhi…"
 *
 * — every intermediate state of the sentence, concatenated. The admin's own guess was a network
 * problem. It was not: the screenshot IS the diagnosis. Each fragment is the FULL transcript as it
 * stood at one instant, and they are all glued together, which no network fault produces.
 *
 * THE ROOT CAUSE. Two of the four voice implementations in this app read the event like this:
 *
 *   Array.from(e.results).map(r => r[0].transcript).join('')
 *
 * That assumes `e.results` holds each phrase once. On **Android Chrome** it does not: an interim
 * result arrives as a NEW entry whose transcript is CUMULATIVE, so the list grows
 * ["voice", "voice typing", "voice typing Mein", …] and joining it reproduces the bug exactly. On
 * desktop Chrome the same code looks fine, which is why this survived — the two implementations that
 * used the standard-compliant reading (`resultIndex` + `isFinal`) never showed the fault, and v5 is
 * one of them, so no report ever came from there.
 *
 * THE FIX IS THE CLASS, NOT THE INSTANCE. There were FOUR hand-written copies of this logic and they
 * had already drifted into two behaviours — two correct, two wrong, plus a second silent defect: the
 * two wrong ones also pinned `lang` to `'en-IN'`, so a Hindi speaker was transcribed by an English
 * recogniser in the free chat and Doctor AI while v5 followed the device language. One module now owns
 * both decisions, and every surface reads from it.
 *
 * 🔒 THE INVARIANT THAT MATTERS: a final result is COMMITTED once and never re-derived from the list;
 * interim text is a tail that is REPLACED wholesale on every event. Anything that re-reads the whole
 * list to rebuild the sentence is how the bug comes back.
 */

/** The minimal shape of a speech result we depend on — so this is testable without a browser. */
export interface SpeechResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}

export interface SpeechEventLike {
  /** Index of the first result that CHANGED in this event. Absent/negative is treated as 0. */
  resultIndex?: number;
  results: ArrayLike<SpeechResultLike>;
}

export interface SpeechAccumulator {
  /** Text committed by final results. Only ever grows, and never by re-reading the results list. */
  final: string;
  /** The live tail. Replaced entirely on every event — never appended to. */
  interim: string;
}

export function emptyAccumulator(): SpeechAccumulator {
  return { final: '', interim: '' };
}

/** Compare ignoring case and runs of whitespace — recognisers re-punctuate as they revise. */
function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Join two speech fragments, recognising the CUMULATIVE case rather than blindly concatenating.
 *
 * When `b` already contains `a` as its opening (Android's revised-and-extended transcript), `b`
 * REPLACES `a` — concatenating there is precisely the reported bug. Otherwise the two are genuinely
 * different phrases and are joined with a space.
 *
 * ⚠️ The prefix test is deliberately whole-string, not word-by-word. A speaker who really says "hello"
 * and then "hello world" as two separate final phrases is rare; a recogniser that revises "voice" into
 * "voice typing" happens on every single Android utterance. Optimising for the common case is right,
 * and the rare one loses a duplicated word rather than producing the wall of text in the report.
 */
export function joinFragments(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!right) return left;
  if (!left) return right;
  const nl = norm(left);
  const nr = norm(right);
  if (nr === nl) return right;                 // repeated verbatim — one copy is the truth
  if (nr.startsWith(nl)) return right;         // a revision that extends: replace, never append
  if (nl.startsWith(nr)) return left;          // a shorter re-send of what we already have
  return `${left} ${right}`;
}

/**
 * Fold one speech event into the running transcript.
 *
 * Reads ONLY from `resultIndex` forward, because everything before it was already committed on an
 * earlier event — re-reading it is what duplicates text. Final and interim pieces are separated
 * because they have opposite lifetimes: final accumulates, interim is thrown away and rewritten.
 */
export function accumulateSpeech(prev: SpeechAccumulator, event: SpeechEventLike): SpeechAccumulator {
  const results = event?.results;
  if (!results || typeof results.length !== 'number') return prev;

  const start = Math.max(0, Math.min(Number(event.resultIndex) || 0, results.length));
  let addedFinal = '';
  let interim = '';

  for (let i = start; i < results.length; i += 1) {
    const r = results[i];
    if (!r) continue;
    const text = String(r[0]?.transcript ?? '');
    if (!text.trim()) continue;
    // Fold with the cumulative-aware join, so several revised entries inside ONE event collapse to
    // their latest form instead of stacking up.
    if (r.isFinal) addedFinal = joinFragments(addedFinal, text);
    else interim = joinFragments(interim, text);
  }

  return {
    final: addedFinal ? joinFragments(prev.final, addedFinal) : prev.final,
    interim,   // ALWAYS replaced — an interim that accumulated would be the same bug in slow motion
  };
}

/**
 * What the input box should show: whatever the user had already typed, then the dictation.
 *
 * `base` is preserved so speaking into a half-written message adds to it rather than wiping it — the
 * behaviour v5 already had and the other surfaces did not.
 */
export function transcriptText(base: string, acc: SpeechAccumulator): string {
  const spoken = joinFragments(acc.final, acc.interim);
  const prefix = base ? base.replace(/\s+$/, '') : '';
  if (!spoken) return prefix;
  return prefix ? `${prefix} ${spoken}` : spoken;
}

/**
 * The language to recognise in.
 *
 * ⚠️ NOT `'en-IN'`. Two surfaces hardcoded English, so a Hindi speaker's words were forced through an
 * English recogniser — in an India-first product, on the two screens most likely to be used in Hindi.
 * The device language is the honest default, and it is what v5 already used.
 */
export function speechLang(navigatorLanguage?: string | null): string {
  const l = String(navigatorLanguage ?? '').trim();
  return l || 'en-IN';
}
