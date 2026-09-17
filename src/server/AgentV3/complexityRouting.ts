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

/**
 * 🔴 THE SECOND WAY THE CODE CANNOT TELL: IT COULD NOT READ THE REQUEST AT ALL.
 *
 * Admin, 2026-09-17: *"jo language hamara code nahi samajh paye…"* — the language OUR CODE does not
 * understand. That is not the model's problem: seven real build reports show the BUILDER handles Hindi
 * and Hinglish fine (report 58f110de asked in Hinglish, produced an app whose files contain no Hindi at
 * all, and landed mid-pack on every quality measure — the two WORST builds in that set were in plain
 * English). So nothing here translates the user's words; translating would spend a call on every such
 * build, add latency, and risk losing intent before the builder ever sees it.
 *
 * What genuinely cannot read Hindi is `RequestAnalyser`'s scorer. **Every one of its signals is ASCII** —
 * `simpleApp`, `coding`, `debugging`, `architecture`, `hardSignal`, and `isComplexAppPrompt` alike. A
 * Devanagari request for a hospital app with doctor logins, patient records, appointments and billing
 * matches none of them, falls to `taskType: 'chat'`, and scores **5**.
 *
 * ⚠️ AND THE SCORE-BASED ASK ABOVE CANNOT CATCH IT, WHICH IS WHY THIS EXISTS. 5 is nowhere near the 40
 * line, so `needsSecondOpinion` would have answered "not borderline" with total confidence and sent the
 * biggest app on the cheapest rung — a hole this file's own routing change of the same day made matter
 * more than it did the day before. A confident wrong answer is worse than an admitted unknown.
 */
export const UNREADABLE_LETTER_SHARE = 0.25;

/** Below this many letters there is nothing to classify, and a call would be spent on noise. */
export const MIN_LETTERS_TO_ASK = 12;

/**
 * PURE. Did the deterministic scorer have anything to read?
 *
 * True when a real share of the request's LETTERS are outside the Latin range the signals are written
 * in. Deliberately script-agnostic rather than a Devanagari test — Bengali, Tamil, Telugu, Marathi,
 * Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu and Arabic are all just as unreadable to an ASCII
 * regex, and India is not one script. Romanized Hinglish stays FALSE: the signals really do read
 * "banao ek todo app", and one Hindi word inside an English sentence is not an unread request.
 */
export function scorerCouldNotRead(prompt: string): boolean {
  const letters = String(prompt ?? '').match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_LETTERS_TO_ASK) return false;
  const nonLatin = letters.filter((c) => !/[A-Za-z]/.test(c)).length;
  return nonLatin / letters.length >= UNREADABLE_LETTER_SHARE;
}

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
  if (prompt !== undefined && scorerCouldNotRead(prompt)) return true;
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
  const unread = scorerCouldNotRead(input?.prompt ?? '');
  if (!needsSecondOpinion(score, input?.prompt) || !llmCall) {
    return {
      ...base,
      source: 'deterministic',
      reason: unread
        ? `the request is not in a script the scorer reads, and no second opinion was available, so the ${score} score stands`
        : `score ${score} is ${deterministic === 'complex' ? 'above' : 'at or below'} the ${COMPLEX_SCORE_LINE} line`,
    };
  }
  /** Why the call is being bought — the two are different facts and the admin report should say which. */
  const why = unread
    ? 'the request is not in a script the scorer reads'
    : `score ${score} is borderline`;

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
