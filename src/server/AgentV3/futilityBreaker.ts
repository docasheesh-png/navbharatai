// A BUILD THAT IS GOING NOWHERE MUST STOP — the third bound on a build, beside cost and throughput.
//
// 🔴 THE REPORT (build `d6d664e6`, autopsy shipped as #3039, which recorded this as an OPEN item).
// The prompt was one word. The build ran the full **29 minutes** to the `BUILD_TIMEOUT` wall clock,
// wrote **no app**, and minutes 4→29 contain nothing but heartbeats and failed provider calls. Zero
// files, zero completed tool calls, zero plan steps, for twenty-five consecutive minutes.
//
// #3039's own words: *"Cost is bounded, throughput is bounded, **pointlessness** is bounded by
// nothing."* That is exactly right, and it is the gap this closes:
//
//   • MONEY      — `buildCostCeiling.ts` stops a build that has spent past its ceiling.
//   • THROUGHPUT — `slowRungBench.ts` retires a provider delivering too few tokens per second.
//   • FUTILITY   — nothing. A build could produce literally nothing and still hold a sandbox, a
//                  user's attention and an ETA for half an hour, because no rule asked the only
//                  question that matters: *is this build getting anywhere at all?*
//
// It is the admin's own bar applied to the clock: *"minutes, and the minutes must be WORKING
// minutes. Time spent waiting on a stalled call, on an abandoned lane, or on a gate nobody reads is
// time the user is watching a spinner."* Twenty-five minutes of that is the purest form of it.
//
// 🔑 PROGRESS IS WHAT THE BUILD PRODUCED, NOT WHAT IT ATTEMPTED — and that distinction is the whole
// design. A failed provider call records an issue, emits narration and burns a minute; counting any
// of those as activity is what let this build look busy for twenty-five minutes. So progress is
// three things a build can only do by genuinely moving forward:
//
//   1. a FILE was written      (`writtenFiles.size`)
//   2. a COMMAND completed     (the route's own `onCommand` hook — a *completed* command, so a long
//                               `npm install` shows no progress while it runs, which the floor below
//                               is sized for)
//   3. a PLAN STEP was done    (`etaStepsDone`)
//
// Deliberately NOT progress: a provider call (successful or not), a narration line, a heartbeat, an
// issue being recorded, or a token being spent. Every one of those was happening throughout the
// reported build.
//
// 🔒 IT IS A STOP, NOT A KILL — copied from `buildCostCeiling.ts`, and for the same reason.
// `AgentRunner` ends BETWEEN turns, the files written so far are already persisted, and the user is
// told their work is saved and one message resumes it. No work is lost; the build pauses. It can
// therefore only ever make a build END SOONER than the wall clock would have ended it anyway — the
// worst case is strictly better than today's.
//
// ⚠️ THE ONE RISK, AND HOW THE FLOOR IS SIZED AGAINST IT: a single legitimate operation that takes
// longer than the window while completing nothing. Measured, not guessed — the longest BOUNDED single
// operation anywhere in the build path is **5 minutes** (`COMMAND_TIMEOUT_MS` in `E2BActuator`, and
// `AGENTV3_STREAM_HARD_CAP_MS`'s 300 s ceiling on one streamed call). The next longest are
// `import-preview-boot` at 240 s and `vaccine-run-tests` at 180 s. So the floor is **6 minutes** —
// strictly above every one of them — and the default is 10, which is twice the longest. A build
// cannot be broken during an operation that is still allowed to be running.
//
// PURE — no clock, no I/O, never throws. The caller supplies the tick.

/** What a build has actually PRODUCED so far. Monotonic: every field only ever grows. */
export interface ProgressSnapshot {
  filesWritten: number;
  commandsRun: number;
  stepsDone: number;
}

/** The breaker's carried state. Opaque to the caller apart from `quietTicks`, which the report uses. */
export interface FutilityState {
  last: ProgressSnapshot;
  /** Consecutive ticks with no progress at all. */
  quietTicks: number;
}

export interface FutilityVerdict {
  state: FutilityState;
  /** Stop the build between turns. */
  stop: boolean;
  /** How many consecutive quiet minutes have now passed. */
  quietMinutes: number;
}

/** The default window: twice the longest bounded single operation in the build path. */
export const DEFAULT_FUTILITY_MINUTES = 10;
/**
 * The smallest window that can be configured.
 *
 * 6, because every bounded single operation in the build path finishes inside 5 minutes
 * (`COMMAND_TIMEOUT_MS`, the streamed-call hard cap). Below this the breaker could fire while real
 * work was legitimately still running, which is the one way this feature could hurt a build.
 */
export const MIN_FUTILITY_MINUTES = 6;
/** Past the wall clock there is nothing left to bound — the watchdog owns it. */
export const MAX_FUTILITY_MINUTES = 30;

const ZERO: ProgressSnapshot = { filesWritten: 0, commandsRun: 0, stepsDone: 0 };

/**
 * The configured window, in minutes.
 *
 * `AGENTV3_FUTILITY_MINUTES` overrides it. An explicit `0` — and only an explicit `0` — disables the
 * breaker, because an operator who wants the old unbounded behaviour deserves a way to say so that
 * cannot be reached by accident. Anything else unreadable (empty, `abc`, negative) falls back to the
 * default: a value that is PRESENT and unparseable can never have been intended as "off". Same
 * reasoning `buildCostCeilingUsd` and `parseRolloutPercent` already apply.
 */
export function futilityMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.AGENTV3_FUTILITY_MINUTES ?? '').trim();
  if (raw === '0' || raw.toLowerCase() === 'off') return 0; // explicit opt-out
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return DEFAULT_FUTILITY_MINUTES;
  return Math.min(MAX_FUTILITY_MINUTES, Math.max(MIN_FUTILITY_MINUTES, Math.floor(n)));
}

/** A fresh state. Starts from zero, so a build that never produces anything is counted from minute 0. */
export function initialFutilityState(): FutilityState {
  return { last: { ...ZERO }, quietTicks: 0 };
}

/** Did anything at all move? A single field is enough — this is "getting anywhere", not "getting far". */
function madeProgress(a: ProgressSnapshot, b: ProgressSnapshot): boolean {
  return b.filesWritten > a.filesWritten || b.commandsRun > a.commandsRun || b.stepsDone > a.stepsDone;
}

/** Read one counter defensively: a NaN must never be mistaken for movement, in either direction. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Advance the breaker by ONE tick (the caller's heartbeat is one minute).
 *
 * `limitMinutes` of 0 never stops anything, and the state is still advanced so that turning the
 * breaker on mid-build does not inherit a stale count.
 *
 * ⚠️ A snapshot that has GONE BACKWARDS is treated as progress, not as futility. It should be
 * impossible (every counter is monotonic), but an impossible reading must fail toward letting the
 * build live — the same call `checkCostCeiling` makes on a non-finite cost.
 */
export function tickFutility(
  state: FutilityState,
  now: ProgressSnapshot,
  limitMinutes: number,
): FutilityVerdict {
  const seen: ProgressSnapshot = {
    filesWritten: num(now?.filesWritten),
    commandsRun: num(now?.commandsRun),
    stepsDone: num(now?.stepsDone),
  };
  const prev = state?.last ?? { ...ZERO };
  const wentBackwards = seen.filesWritten < prev.filesWritten
    || seen.commandsRun < prev.commandsRun
    || seen.stepsDone < prev.stepsDone;
  if (madeProgress(prev, seen) || wentBackwards) {
    return { state: { last: seen, quietTicks: 0 }, stop: false, quietMinutes: 0 };
  }
  const quietTicks = (Number.isFinite(state?.quietTicks) ? state.quietTicks : 0) + 1;
  const limit = Number.isFinite(limitMinutes) && limitMinutes > 0 ? limitMinutes : 0;
  return {
    state: { last: seen, quietTicks },
    stop: limit > 0 && quietTicks >= limit,
    quietMinutes: quietTicks,
  };
}

/**
 * The ADMIN-facing line for the build report.
 *
 * It names the three counters, because "nothing happened" is a claim a reader must be able to check —
 * and on the reported build all three were zero, which is the fact the 29-minute timeline never said.
 */
export function futilityDetail(v: FutilityVerdict, limitMinutes: number): string {
  const p = v.state.last;
  return `Build stopped as futile: ${v.quietMinutes} consecutive minute(s) with no files written, `
    + `no commands completed and no plan steps done (totals for the whole build so far: `
    + `${p.filesWritten} file(s), ${p.commandsRun} command(s), ${p.stepsDone} step(s)), against a `
    + `window of ${limitMinutes} min. A provider call, a narration line and a heartbeat are `
    + `deliberately NOT counted as progress — all three were happening throughout. Widen or disable `
    + `with AGENTV3_FUTILITY_MINUTES (0 = no futility breaker).`;
}
