// A RUNG THAT ANSWERS IS NOT A RUNG THAT IS WORKING — bounding a provider by THROUGHPUT.
//
// 🔴 THE DEFECT (autopsy dd1f5f60, 2026-09-16). A free-tier edit ran for 30 minutes, wrote two
// files, never produced a preview, and told the user their app was not ready. The user had already
// filed a support ticket saying "cannot launch app it is not responding tried thrice". The report's
// own numbers say why, and they are arithmetic rather than opinion:
//
//     11 model calls · 29.5 min inside a provider call · 7.9 SECONDS of our own engine's work
//     15,330 output tokens across 1,771 s  ⇒  8.65 tokens/second
//
// `floorBudget.ts` already states the rate this engine is willing to wait behind — 30 ms per output
// token, i.e. ~33 tokens/second — and calls anything slower "one we would rather fall past than sit
// behind". We sat behind one at 26% of that for half an hour, on the tier NavBharatAI pays for
// itself, and charged the user nothing for the failure.
//
// 🔑 WHY NOTHING CAUGHT IT, and this is the part worth remembering: EVERY escalation path in
// `MultiProviderTurnRunner` lives inside a `catch`. The timeout bench, the 429 bench, the shared
// cooldown, the dead-rung memory, the rung advance — all of them need a call to THROW. All eleven of
// those calls returned ok. The ladder (GLM-flash → KIMI → GLM-5.3 → HAIKU) never left rung 1, and
// Kimi sat one step away for twenty-nine minutes. A merely SLOW provider was, by construction,
// invisible to the entire resilience stack.
//
// ⚠️ AND STREAMING WIDENED THE HOLE — said plainly because streaming is the right change and was
// switched on the same day this build ran. `AGENTV3_STREAM_BUILD_CALLS` bounds a call by SILENCE
// (60 s) and raises the ceiling from 150 s to 300 s. It reasoned about two kinds of provider:
// healthy ones, and stalled ones. This build was a THIRD kind — steadily slow. It never went quiet,
// so the idle bound never fired; it always had an answer, so reaching the 300 s ceiling produced a
// TRUNCATED SUCCESS rather than a failure. Four calls landed at 302 s, 298 s, 278 s and 248 s, every
// one of them recorded as a success. The one thing that could hold a rung longer got twice as long
// to do it, and nothing downstream could tell.
//
// 🔒 WHAT THIS MODULE DOES, AND THE LINE IT WILL NOT CROSS. It judges a SUCCESSFUL turn against the
// time our own budget arithmetic already said that turn would need, accumulates that per rung, and
// lets the runner retire a rung that is persistently far slower. It can only ever move the build to
// the NEXT rung — it can never fail a build, never shorten a call, and never bench the last
// remaining engine (see `canBenchAnother`: a slow answer beats no answer, always).
//
// PURE. No clock, no I/O; every env read goes through a named getter below.

import { FLOOR_CALL_OVERHEAD_MS, floorMsPerOutputToken } from './floorBudget';

/**
 * What our OWN budget arithmetic says a turn producing `outputTokens` should have taken.
 *
 * ⚠️ Deliberately NOT `floorTimeoutForTokens()`, even though the arithmetic is the same. That
 * function CLAMPS its answer to [20 s, 150 s] because it is sizing a REQUEST — a bound we are about
 * to impose. Judging is the opposite direction: clamping the expectation at 150 s would declare a
 * large healthy turn "slow" the moment it legitimately needed longer than the cap, and would flatten
 * every small turn up to 20 s into "free". Same two measured constants, no clamp.
 */
export function expectedMsForOutput(outputTokens: number, env: NodeJS.ProcessEnv = process.env): number {
  const tokens = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0;
  return FLOOR_CALL_OVERHEAD_MS + tokens * floorMsPerOutputToken(env);
}

/** One rung's running throughput record for this build. Immutable; `recordSlowSample` returns a new one. */
export interface SlowRungState {
  /** Judgeable calls counted so far — an unmeasured or empty turn is never one of them. */
  readonly calls: number;
  /** Wall-clock actually spent inside those calls. */
  readonly observedMs: number;
  /** What our budget arithmetic says those same calls should have cost. */
  readonly expectedMs: number;
  /**
   * 🔴 THE VERDICT IS LATCHED, AND A TEST IS WHY THIS FIELD EXISTS.
   *
   * The obvious design recomputes "is it slow?" from the running totals each time. On the reference
   * build that verdict FLICKERS: the cumulative ratio is 3.43× at call 3, dips to **2.46×** at call
   * 4 — just under the 2.5 line, on one better-than-usual response — and climbs back to 3.5× and
   * stays there. A rung we had already proven was costing the user their build would have
   * un-retired itself on a single lucky call.
   *
   * It did not matter in the runner, because the runner adds the key to a set and never looks again.
   * That is precisely the problem: the invariant was being held by ONE call site instead of by the
   * thing that owns it, which is how this repo's drifted-copy bugs start. So the latch lives here,
   * in the state, and is true for every caller that will ever exist.
   *
   * A slow rung is retired for the rest of ONE build (a runner instance is a build), never longer —
   * so a provider having a bad hour is never remembered against it tomorrow.
   */
  readonly tooSlow: boolean;
  /**
   * Did the latch fire on a single STALLED turn rather than on a trend? Optional, so every existing
   * caller and test that builds a state literal keeps working.
   *
   * It exists only so the report can say which of the two happened. "Answered 9.6× slower than
   * budgeted over 1 calls" is arithmetically true of a stall and reads like a statistics error;
   * "burned 56s and returned 27 tokens" is the same fact in the form that lets a reader act on it.
   */
  readonly stalled?: boolean;
}

export const EMPTY_SLOW_RUNG_STATE: SlowRungState = { calls: 0, observedMs: 0, expectedMs: 0, tooSlow: false };

/** One completed, SUCCESSFUL turn, as the runner observed it. */
export interface SlowRungSample {
  outputTokens: number;
  observedMs: number;
  /**
   * `false` ⇒ the provider reported no usage at all (see `TurnUsage.measured`). The sample is then
   * NOT judgeable and is discarded — see `recordSlowSample`.
   */
  measured?: boolean;
}

/**
 * Fold one successful turn into a rung's record. Pure.
 *
 * 🔴 AN UNMEASURED TURN IS DISCARDED, NOT COUNTED AS FAST OR SLOW. A streamed call carries token
 * counts only when the provider honours `stream_options.include_usage`; without them `outputTokens`
 * is ZERO, and a 300-second call against a 5-second expectation would score 60× — the engine would
 * retire a perfectly healthy vendor on a number nobody measured. This is the same law the wallet
 * obeys (`TurnUsage.measured`): we do not act on figures we do not have.
 *
 * The cost of that honesty, stated rather than discovered later: if a provider stops reporting usage
 * this governor goes SILENT for it and the old behaviour returns. That is the safe direction — no
 * data means no action — and it is visible, because `USAGE_NOT_REPORTED` already names it.
 */
export function recordSlowSample(
  prev: SlowRungState,
  sample: SlowRungSample,
  env: NodeJS.ProcessEnv = process.env,
): SlowRungState {
  if (sample.measured === false) return prev;
  const tokens = Number.isFinite(sample.outputTokens) ? sample.outputTokens : 0;
  if (tokens <= 0) return prev;
  const observed = Number.isFinite(sample.observedMs) ? sample.observedMs : 0;
  if (observed <= 0) return prev;
  const next = {
    calls: prev.calls + 1,
    observedMs: prev.observedMs + observed,
    expectedMs: prev.expectedMs + expectedMsForOutput(tokens, env),
    tooSlow: prev.tooSlow,
  };
  // Latched, never cleared — see `SlowRungState.tooSlow` for the call-4 dip that proved it necessary.
  // A STALL latches on its own single sample (see `SLOW_RUNG_STALL_MS`); the trend test is unchanged
  // and still needs its three calls, so this adds a second way in rather than weakening the first.
  if (next.tooSlow) return next;
  const stalled = isStalledTurn(sample, env);
  return { ...next, tooSlow: stalled || crossesSlowThresholds(next, env), ...(stalled ? { stalled: true } : {}) };
}

/**
 * The instantaneous test: has this rung, on the evidence so far, earned retirement? Pure.
 *
 * Deliberately NOT exported — the latch in `recordSlowSample` is the only correct way to read this,
 * and an exported instantaneous predicate is an invitation to reintroduce the flicker.
 */
function crossesSlowThresholds(state: SlowRungState, env: NodeJS.ProcessEnv): boolean {
  if (state.calls < slowRungMinCalls(env)) return false;
  if (state.observedMs < SLOW_RUNG_MIN_OBSERVED_MS) return false;
  if (state.expectedMs <= 0) return false;
  return slownessRatio(state) >= slowRungRatio(env);
}

/** How many times slower than budgeted this rung has been, cumulatively. 0 when nothing is judgeable. */
export function slownessRatio(state: SlowRungState): number {
  return state.expectedMs > 0 ? state.observedMs / state.expectedMs : 0;
}

/**
 * The cumulative ratio at which a rung stops being worth waiting for.
 *
 * 2.5 is wide on purpose. The rate it is measured against was itself taken on a night that provider
 * was visibly degraded (`floorBudget.ts`), so a HEALTHY rung scores at or below 1.0 — the build that
 * produced this module opened with a 1.01× call and a 0.90× call before it fell apart. 2.5×
 * therefore means "two and a half times slower than the slowest rate we ever called acceptable",
 * which no working provider reaches by accident.
 *
 * ⚠️ A value of 1 or below is REFUSED and falls back to the default. At 1.0 this would retire every
 * provider on earth, including the Claude backstop, on its third call — a build with no engine at
 * all. The malformed-value rule in this repo is always "fall back, never to the dangerous
 * direction", and here the dangerous direction is a SMALLER number, not a larger one.
 */
export const SLOW_RUNG_RATIO_DEFAULT = 2.5;

/**
 * Judgeable calls required before a verdict. One slow call is noise — a cold start, a large prompt
 * upload, a single unlucky request. Three is the smallest number that can show a TREND, and it is
 * what the evidence supports: the reference build's rung was at 3.43× cumulative by its third call.
 */
export const SLOW_RUNG_MIN_CALLS = 3;

/**
 * Real wall-clock the rung must have consumed before it can be retired.
 *
 * Without this, three genuinely tiny turns (a few hundred tokens each, dominated by fixed overhead)
 * could cross the ratio while costing the build almost nothing — retiring a rung over four wasted
 * seconds. 90 s is the point at which the slowness is unambiguously the thing costing the user
 * their build rather than a rounding artefact.
 */
export const SLOW_RUNG_MIN_OBSERVED_MS = 90_000;

/**
 * 🔴 THE FIRST CALL HAD NO WATCHDOG AT ALL, AND IT IS THE ONE THE USER SITS THROUGH (autopsy
 * 2b0a3ed5, 2026-09-17).
 *
 * A calculator build spent **55.7 seconds on its first model call and got back 27 output tokens** —
 * 0.48 tokens/second, against the ~33/s this engine's own budget arithmetic assumes. The model said
 * *"I'll quickly check the existing calculator template and finish it up"*, read one file, and that
 * was the whole visible build. The user pressed Stop at 66 seconds. They were right to.
 *
 * ⚠️ EVERY ESCALATION PATH MISSED IT, EACH FOR A DIFFERENT STRUCTURAL REASON — which is what makes
 * this a class rather than a gap:
 *   • the timeout bench needs a THROW; the call succeeded
 *   • the 429 bench needs a 429
 *   • the stream idle bound needs 60 s of TOTAL silence; tokens trickled, and the call ended at 55.7 s
 *   • the stream hard cap is 300 s, nowhere near
 *   • and THIS bench needs 3 calls and 90 s of wall clock — it had 1 and 55.7
 *
 * So a build abandoned during its first call could not reach any of them, by construction. The
 * ordinary bench is about a TREND and rightly refuses to judge one call. A STALL is not a trend: a
 * turn that burned most of a minute and produced almost nothing is unambiguous on its own evidence,
 * and waiting for two more of them costs the user two more minutes to learn what the first already
 * showed.
 *
 * 🔒 WHY THIS CANNOT MISFIRE. The two conditions together imply a ratio of at least 45 s / 11 s ≈ 4×,
 * far past the 2.5 a trend must clear — so no third knob is needed and none is added. A productive
 * turn is never caught: 200 tokens is a sentence, not a file, and any real generation blows through
 * it long before the clock. And what it DOES is identical to the ordinary bench — move to the next
 * rung — so it can never fail a build, never shorten a call, and never bench the last engine.
 */
export const SLOW_RUNG_STALL_MS = 45_000;

/** Output tokens at or below which a turn has produced nothing worth a 45-second wait. */
export const SLOW_RUNG_STALL_TOKENS = 200;

/**
 * ⚠️ A BLANK VALUE MEANS UNSET, NOT ZERO — and this file was written with that bug and caught by its
 * own test the same hour.
 *
 * `Number('')` is **0**, not NaN. So a key present-but-empty in Cloud Run (a cleared field, a dropped
 * paste) reads as a deliberate zero — which on the token ceiling below means "disable this guard for
 * ever", with the console showing the key as configured and nothing failing anywhere. It is the exact
 * trap the referral tunables already record, and the first draft here fell into it: with the env
 * absent, `AGENTV3_SLOW_RUNG_STALL_TOKENS ?? ''` produced 0 and stall detection never ran at all.
 *
 * An explicit `0` is still honoured — nobody types a zero by accident.
 */
function rawNumber(value: string | undefined): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The configured stall clock. Junk, blank, or anything below 20 s falls back — see `SLOW_RUNG_STALL_MS`. */
export function slowRungStallMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = rawNumber(env.AGENTV3_SLOW_RUNG_STALL_MS);
  return n !== null && n >= 20_000 ? n : SLOW_RUNG_STALL_MS;
}

/**
 * The configured stall token ceiling. Junk or blank falls back; an explicit `0` DISABLES stall
 * detection while leaving the trend bench running, because zero tokens is already handled as an empty
 * turn elsewhere and can never satisfy this test.
 */
export function slowRungStallTokens(env: NodeJS.ProcessEnv = process.env): number {
  const n = rawNumber(env.AGENTV3_SLOW_RUNG_STALL_TOKENS);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : SLOW_RUNG_STALL_TOKENS;
}

/**
 * Is this ONE turn a stall — a long wall clock for essentially no output? Pure.
 *
 * Judged on a single sample on purpose; see `SLOW_RUNG_STALL_MS`. An UNMEASURED turn is never a
 * stall, by the same law the trend bench obeys: a stream without `include_usage` reports zero tokens,
 * and scoring that as "produced nothing" would retire a healthy vendor on a number nobody measured.
 */
export function isStalledTurn(sample: SlowRungSample, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!sample || sample.measured === false) return false;
  const ceiling = slowRungStallTokens(env);
  if (ceiling <= 0) return false;
  const tokens = Number.isFinite(sample.outputTokens) ? sample.outputTokens : -1;
  const observed = Number.isFinite(sample.observedMs) ? sample.observedMs : 0;
  return tokens >= 0 && tokens <= ceiling && observed >= slowRungStallMs(env);
}

/** Kill switch. Default ON; `AGENTV3_SLOW_RUNG_BENCH=off` restores the pre-2026-09-16 behaviour exactly. */
export function slowRungBenchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SLOW_RUNG_BENCH ?? '').trim().toLowerCase() !== 'off';
}

/** The configured ratio. Junk, or anything ≤ 1, falls back to the default — see `SLOW_RUNG_RATIO_DEFAULT`. */
export function slowRungRatio(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.AGENTV3_SLOW_RUNG_RATIO ?? '').trim());
  return Number.isFinite(n) && n > 1 ? n : SLOW_RUNG_RATIO_DEFAULT;
}

/** The configured minimum sample. Junk, or anything below 2, falls back — one call can never be a trend. */
export function slowRungMinCalls(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.AGENTV3_SLOW_RUNG_MIN_CALLS ?? '').trim());
  return Number.isInteger(n) && n >= 2 ? n : SLOW_RUNG_MIN_CALLS;
}

/**
 * Is this rung costing the build more than it is worth? Pure.
 *
 * Reads the LATCH rather than re-deriving a verdict (see `SlowRungState.tooSlow`), and the kill
 * switch is checked here rather than at record time so `off` silences the feature instantly and
 * completely — including for state that was already latched earlier in the same build.
 */
export function isRungTooSlow(state: SlowRungState, env: NodeJS.ProcessEnv = process.env): boolean {
  return slowRungBenchEnabled(env) && state.tooSlow;
}

/**
 * 🔒 THE GUARD THAT MAKES THIS SAFE TO SHIP ON BY DEFAULT: slowness may never empty the ladder.
 *
 * Every other bench in the runner retires a rung that CANNOT answer, so retiring all of them and
 * failing honestly is the correct end. This one retires a rung that CAN — just slowly — and a slow
 * app beats no app every single time. So at least one rung is always kept, whatever its throughput,
 * and the build finishes on it rather than being failed by an optimisation.
 *
 * `benchedCount` is how many distinct rungs are already retired for slowness; `distinctRungs` is how
 * many the chain has. Benching one more is allowed only while a survivor remains.
 */
export function canBenchAnother(benchedCount: number, distinctRungs: number): boolean {
  return benchedCount + 1 < distinctRungs;
}

/**
 * Admin-facing reason line for the build report. Names providers, so it is diagnostics only.
 *
 * ⚠️ The outcome is a PARAMETER, not something the caller edits back out of the returned string. The
 * first version returned the "skipped" wording always and the keep-the-last-engine path stripped it
 * with a regex — so changing one word here would have silently produced a line that said both
 * "skipped" and "KEPT anyway". Two callers, one sentence, no string surgery between them.
 */
export function describeSlowRung(
  state: SlowRungState,
  model: string | undefined,
  outcome: 'skipped' | 'kept',
): string {
  const s = (ms: number) => `${Math.round(ms / 1000)}s`;
  const what = model ? `${model} ` : '';
  const tail = outcome === 'skipped'
    ? '— skipped for the rest of this build so the ladder can reach the next engine'
    : '— KEPT anyway: it is the last engine left on this ladder, and a slow app beats no app';
  // A stall gets its own sentence. The trend wording is arithmetically true of it and useless to a
  // reader — "9.6× slower than budgeted over 1 calls" invites an argument about the sample size,
  // when the fact that matters is that a user watched a spinner for most of a minute for nothing.
  if (state.stalled === true) {
    return `${what}STALLED — ${s(state.observedMs)} of wall clock for almost no output `
      + `(our own clock sizes that work at ${s(state.expectedMs)}) `
      + tail;
  }
  return `${what}answered ${slownessRatio(state).toFixed(1)}× slower than budgeted `
    + `(${s(state.observedMs)} spent on work our own clock sizes at ${s(state.expectedMs)}, over ${state.calls} calls) `
    + tail;
}
