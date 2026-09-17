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
  return next.tooSlow ? next : { ...next, tooSlow: crossesSlowThresholds(next, env) };
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
  return `${what}answered ${slownessRatio(state).toFixed(1)}× slower than budgeted `
    + `(${s(state.observedMs)} spent on work our own clock sizes at ${s(state.expectedMs)}, over ${state.calls} calls) `
    + tail;
}
