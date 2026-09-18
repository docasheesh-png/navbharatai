// BIG APPS DO NOT OPEN ON THE CHEAPEST RUNG — and when the code cannot tell how big, it asks.
//
// Admin, 2026-09-17, verbatim: *"kimi ko bade aur complex task dedo, kabhi bhi — starting me bhi de
// sakte ho, beech me bhi! task chota/bada/mild/complex hai code se pata na lage to gptnano se puchwa
// lo!!"* Two instructions in one sentence, and this module is both halves:
//
//   1. A COMPLEX build starts at the tier's SECOND rung — which on Weak and Normal is KIMI — instead
//      of the cheap flash opener. "Starting me bhi" is literal: Kimi is not only a fallback.
//   2. When the deterministic scorer genuinely cannot tell, a cheap model settles it. GPT Nano is
//      exactly the tool its own vendor brief names for this ("classification/extraction", recorded in
//      CLAUDE.md) — and this repo already pays for it on the free chat ladder.
//
// 🔑 THE HOOK WAS ALREADY HERE, UNUSED, AND THAT IS WHY THIS IS SMALL. `RequestAnalyser.analyzeRequest`
// has scored every request deterministically since the cost-ladder work, and its own docblock says it
// "marks the genuinely ambiguous ones (`ambiguous: true`) so a caller MAY refine them with a cheap LLM
// analyser". Nothing ever read that flag — the refinement half was designed and never built. This is
// that half, so no new scoring concept is invented and none competes with the existing one.
//
// 💸 WHAT IT COSTS, STATED PLAINLY. On Weak — the tier NavBharatAI pays for itself — starting a complex
// build on KIMI kimi-k2.7-code ($0.95/$4.00) instead of glm-4.7-flashx ($0.07/$0.40) is roughly 13×
// the input price for THOSE builds. The bet is the admin's own, and it is the same one the 2026-09-14
// ladder note makes in the other direction: a cheap rung that fails costs more than a dearer one that
// succeeds, because the failure is paid twice — once in the wasted call, once in the heal. The bet is
// only worth taking where it is likely to pay, which is why `simple` is the default on every doubt.

import { isCheapFlashRung, withoutCheapFlashLead, type LadderRung } from './tierLadder';
import { signalsCouldNotRead, signalsMatchedNothing } from './RequestAnalyser';

/**
 * 🔒 ONE IMPLEMENTATION, OWNED BY THE MODULE THE FACT IS ABOUT (2026-09-17, later the same day).
 *
 * This module introduced the readability test as `scorerCouldNotRead`, and keeping it HERE was a
 * workaround wearing a fix's clothes: the module that could not read — `RequestAnalyser`, whose every
 * signal is an ASCII pattern — went on returning `ambiguous: false` for exactly those requests, so
 * this file's question was answered and the other five readers of `analyzeRequest` were still told
 * the confident version. The test now lives beside the signals it describes, together with the
 * deterministic script-neutral floor that makes the FALLBACK honest (when no second opinion is
 * available, the score that "stands" is no longer a 5). Re-exported under the original name so every
 * caller and test keeps working.
 */
export { signalsCouldNotRead as scorerCouldNotRead, UNREADABLE_LETTER_SHARE, MIN_LETTERS_TO_JUDGE_SCRIPT } from './RequestAnalyser';

/**
 * THE THIRD WAY THE CODE CANNOT TELL, re-exported from the module that owns it for the same reason as
 * the test above: `RequestAnalyser` knows what its own signals matched, and a copy here would drift.
 */
export { signalsMatchedNothing } from './RequestAnalyser';

export type ComplexityVerdict = 'simple' | 'complex';
/** Where a verdict came from — recorded in the build report so a routing choice is never a mystery. */
export type ComplexitySource = 'deterministic' | 'model' | 'model-unavailable' | 'disabled';

export interface ComplexityDecision {
  verdict: ComplexityVerdict;
  source: ComplexitySource;
  /** The deterministic score the decision started from, for the report line. */
  score: number;
  /** One admin-readable sentence. Never carries a vendor name (White-Label Law). */
  reason: string;
}

/**
 * The line between "a cheap rung can have this" and "start it higher".
 *
 * 🔒 NOT A NEW NUMBER. 40 is `RequestAnalyser`'s own top tier boundary — the point at which its
 * `scoreToTier` stops recommending a cheap model and asks for the strongest normal one. Inventing a
 * second threshold would have meant two modules disagreeing about the same word; this one reads the
 * existing line and routes on it. For scale, that module scores `simple_app` at ≤20 (capped),
 * `coding` 30, `debugging` 45, `complex_app` 58, `architecture` 80.
 */
export const COMPLEX_SCORE_LINE = 40;

/**
 * How close to the line counts as "the code cannot tell" — the same ±3 margin `isNearBoundary` uses,
 * for the same reason, so the two notions of "borderline" cannot drift.
 */
export const BORDERLINE_MARGIN = 3;

// 🔴 THE SECOND WAY THE CODE CANNOT TELL: IT COULD NOT READ THE REQUEST AT ALL.
//
// Admin, 2026-09-17: *"jo language hamara code nahi samajh paye…"* — the language OUR CODE does not
// understand. That is not the model's problem: seven real build reports show the BUILDER handles Hindi
// and Hinglish fine (report 58f110de asked in Hinglish, produced an app whose files contain no Hindi at
// all, and landed mid-pack on every quality measure — the two WORST builds in that set were in plain
// English). So nothing here translates the user's words; translating would spend a call on every such
// build, add latency, and risk losing intent before the builder ever sees it.
//
// What genuinely cannot read Hindi is `RequestAnalyser`'s scorer, and `signalsCouldNotRead` — its own
// test, re-exported above as `scorerCouldNotRead` — is how it says so. A Devanagari request for a
// hospital app with doctor logins, patient records, appointments and billing matches none of its ASCII
// signals and falls through to `taskType: 'chat'`.
//
// ⚠️ AND THE SCORE-BASED ASK BELOW CANNOT CATCH IT ON ITS OWN, WHICH IS WHY `needsSecondOpinion`
// consults the script too. Such a request used to score 5, nowhere near the 40 line, so the ask would
// have answered "not borderline" with total confidence and sent the biggest app on the cheapest rung.
// A confident wrong answer is worse than an admitted unknown. (Since the same day `analyzeRequest`
// also FLOORS such a request on script-neutral evidence — see `scriptNeutralFloor` — so the
// deterministic fallback here is no longer a 5. Both halves matter: this one buys a better ANSWER,
// that one makes the answer we already had HONEST.)

/** Kill switch. `off` restores the pre-2026-09-17 behaviour exactly: every build opens on rung 1. */
export function complexityRoutingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_COMPLEX_TO_KIMI ?? '').trim().toLowerCase() !== 'off';
}

/** PURE. What the deterministic score alone says. */
export function complexityFromScore(score: number): ComplexityVerdict {
  return Number.isFinite(score) && score > COMPLEX_SCORE_LINE ? 'complex' : 'simple';
}

/**
 * PURE. Is a second opinion worth PAYING for?
 *
 * ⚠️ Deliberately NARROWER than `RequestAnalyser`'s own `ambiguous` flag, and the difference is money.
 * That flag marks a score near EITHER boundary (20 or 40), because it was written for a three-tier
 * ladder. This decision is binary, so only the 40 line can change it: asking a model about a score of
 * 18 would spend a call to move a verdict from `simple` to `simple`. "Kharcha kam se kam" applies to
 * the classifier too — a question whose answer cannot change the outcome is not worth asking.
 */
export function needsSecondOpinion(score: number, prompt?: string): boolean {
  if (prompt !== undefined && signalsCouldNotRead(prompt)) return true;
  // 🔴 THE SIBLING OF THE LINE ABOVE, AND IT WAS NEVER HUNTED (autopsy c6e4c6ff, 2026-09-18).
  // "I could not read the script" and "I read it and recognised nothing" are the SAME fact about this
  // scorer — it has no opinion — and the argument three paragraphs up applies word for word to both:
  // such a request scores 5, nowhere near the 40 line, so the score-based ask answers "not borderline"
  // with total confidence and sends the biggest app on the cheapest rung. A confident wrong answer is
  // worse than an admitted unknown. `'E commerce website'` is exactly that request: one space away
  // from a pattern that would have scored it 58, and it opened a 26.7-minute build on the flash rung.
  if (prompt !== undefined && signalsMatchedNothing(prompt)) return true;
  return Number.isFinite(score) && Math.abs(score - COMPLEX_SCORE_LINE) <= BORDERLINE_MARGIN;
}

/**
 * PURE. Read a one-word answer from the classifier.
 *
 * Returns null on anything unrecognised, which the caller treats as "no answer" and falls back to the
 * deterministic verdict — never to a guess. A model that replies with a paragraph, an empty string, or
 * a word we did not ask for has not answered the question.
 */
export function parseComplexityAnswer(raw: string | null | undefined): ComplexityVerdict | null {
  const first = String(raw ?? '').trim().toLowerCase().split(/[\s.,!:;"'`\n]+/).filter(Boolean)[0];
  if (!first) return null;
  if (first === 'complex' || first === 'big' || first === 'large') return 'complex';
  if (first === 'simple' || first === 'small') return 'simple';
  return null;
}

/** The classifier prompt. Short on purpose — this is a label, not an essay, and it is billed per token. */
export function complexityPrompt(userPrompt: string): string {
  return [
    'Decide how big the app this person is asking for really is.',
    'The request may be in any language or script. Answer with ONE word: "simple" or "complex".',
    '',
    '"simple"  — one screen or a few, no accounts, no server, no database.',
    '            calculator, todo list, clock, landing page, portfolio, quiz.',
    '"complex" — many screens, user accounts, a database, payments, dashboards,',
    '            real-time updates, or several features that depend on each other.',
    '',
    `Request: "${String(userPrompt ?? '').slice(0, 600)}"`,
    '',
    'One word only:',
  ].join('\n');
}

/**
 * Decide, spending a model call ONLY on a genuinely borderline request.
 *
 * 🔒 IT CANNOT BREAK OR DELAY A BUILD. The call is raced against `timeoutMs`, every failure path is
 * caught, and each one falls back to the deterministic verdict that was already computed for free. The
 * worst case is the behaviour that existed before this module — never an error, never a hang.
 */
export async function decideComplexity(
  input: { prompt: string; score: number },
  llmCall?: (prompt: string) => Promise<string>,
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ComplexityDecision> {
  const score = Number.isFinite(input?.score) ? input.score : 0;
  const deterministic = complexityFromScore(score);
  const base = { verdict: deterministic, score } as const;

  if (!complexityRoutingEnabled(opts.env ?? process.env)) {
    return { ...base, verdict: 'simple', source: 'disabled', reason: 'complexity routing is switched off' };
  }
  const unread = signalsCouldNotRead(input?.prompt ?? '');
  const unmatched = !unread && signalsMatchedNothing(input?.prompt ?? '');
  /** Why the call is being bought — three different facts, and the admin report should say which. */
  const why = unread
    ? 'the request is not in a script the scorer reads'
    : unmatched
      ? 'the scorer recognised nothing in this request'
      : `score ${score} is borderline`;
  if (!needsSecondOpinion(score, input?.prompt) || !llmCall) {
    return {
      ...base,
      source: 'deterministic',
      reason: unread || unmatched
        ? `${why}, and no second opinion was available, so the ${score} score stands`
        : `score ${score} is ${deterministic === 'complex' ? 'above' : 'at or below'} the ${COMPLEX_SCORE_LINE} line`,
    };
  }

  const timeoutMs = Math.max(500, opts.timeoutMs ?? 6_000);
  try {
    const answer = await Promise.race([
      llmCall(complexityPrompt(input.prompt)),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('complexity-timeout')), timeoutMs)),
    ]);
    const parsed = parseComplexityAnswer(answer);
    if (!parsed) {
      return { ...base, source: 'model-unavailable', reason: `${why}; the second opinion did not answer, so the score stands` };
    }
    return { verdict: parsed, score, source: 'model', reason: `${why}; a second opinion read it as ${parsed}` };
  } catch {
    return { ...base, source: 'model-unavailable', reason: `${why}; the second opinion was unavailable, so the score stands` };
  }
}

/**
 * The ladder a build of this complexity should START on.
 *
 * A COMPLEX build skips the cheap flash opener — which on Weak and Normal makes KIMI the first engine
 * to see it, exactly as asked. Every other tier and every other case is untouched: Strong has no flash
 * rung, so its ladder is returned whole, and a `simple` verdict never reorders anything.
 *
 * ⚠️ It shares `withoutCheapFlashLead` with `healLadder` rather than re-deriving "the cheap opener".
 * Two definitions of the same rung would agree on the day they were written and not afterwards.
 */
export function startLadderForComplexity(
  rungs: readonly LadderRung[],
  verdict: ComplexityVerdict,
): LadderRung[] {
  return verdict === 'complex' ? withoutCheapFlashLead(rungs) : [...rungs];
}

/** True when this tier's ladder would actually be changed by a complex verdict — for the report line. */
export function complexityWouldReroute(rungs: readonly LadderRung[]): boolean {
  return rungs.length > 1 && isCheapFlashRung(rungs[0].model);
}
