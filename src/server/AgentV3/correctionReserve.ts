/**
 * THE PROTECTED CORRECTION RESERVE — a slice of the build's wall clock that generation cannot spend.
 *
 * 🔴 THE GAP THIS CLOSES, traced rather than assumed (audit 2026-09-16).
 *
 * `routes/agentv3.ts` hands the generation runner `maxBuildMs: effectiveBuildSeconds * 1000` — the
 * WHOLE budget. `AgentRunner.buildTimedOut` stops it only at 100%. Meanwhile every post-build check
 * asks the same question in its own words:
 *
 *     effectiveBuildSeconds === 0 || Date.now() - buildStartedAt < effectiveBuildSeconds * 1000 - X
 *
 * with X = 30 s (render rescue), 45 s (page check, last-chance proof), 60 s (heal floor), 90 s
 * (preview verify + heal, journeys, the review) and 120 s (red-team). There are about twenty-five of
 * them and **not one of them reserves anything** — each merely asks whether generation happened to
 * leave room. So a build whose generation ran to the wall reaches the correction phase with a
 * NEGATIVE answer to all of them at once, and the whole verify → repair → re-verify stage is skipped
 * in silence. That is the mechanism behind the UNKNOWN release gate #2976 made visible and #2978
 * gave one last look: **there was never a budget for correction, only leftovers.**
 *
 * 🔑 WHY 10%, AND WHY IT IS NOT A NEW POLICY. `buildBudgetSteer.ts` already tells the model, in the
 * engine's own words, that at `BUDGET_STAGE_AT.final` (**0.9**) it must *"stop all work now except
 * saving what you have and writing an honest summary"*. That policy has existed since the f04421ef
 * autopsy and has always been ADVISORY — a sentence appended to a turn, which a model may ignore and
 * which nothing enforces. The reserve is that same line, enforced. It takes no time the engine had
 * not already declared spent, which is why it needed no new number to be invented.
 *
 * ⚠️ THE BAND IS WHAT MAKES ONE FRACTION SAFE AT EVERY CAP. `AGENTV3_MAX_BUILD_SECONDS` is tunable
 * and pipeline depth doubles it, so 10% is 180 s at the 1800 s default and 360 s on a deep build.
 * - **Floor `MIN_MS` (120 s)** — the preview verify gate needs `> 90 s` of headroom to be entered at
 *   all, so a reserve of 90 s or less buys literally nothing: it would cost generation time and still
 *   leave every check skipping. 120 s clears that bar with room for the 35 s browse that follows it.
 * - **Ceiling `MAX_MS` (300 s)** — a deep build's 10% is six minutes, and correction is a bounded
 *   verify-repair-verify, not an open-ended second build. Beyond five minutes the reserve would be
 *   idle time taken from work that has somewhere to put it.
 * - **Share `MAX_SHARE` (0.25)** — on a deliberately short cap the floor would otherwise dominate
 *   (120 s of a 300 s build is 40%). The share wins there, and the honest consequence is stated
 *   rather than hidden: a five-minute total budget cannot afford a repair round, so it does not
 *   pretend to reserve one.
 *
 * 🔒 WHAT IT DELIBERATELY DOES NOT DO. It does not extend the build's wall clock — `deadlineMs` and
 * `finalizeOnDeadline` are untouched, so the hard wall is exactly where it was. It does not bound the
 * HEAL runners: they are the ones spending the reserve, and they keep the full per-runner ceiling they
 * have today. It creates no delay — an unused reserve is simply never spent, because a build that
 * finishes early still finishes early. And with the watchdog disabled (`maxBuildSeconds() === 0`) it
 * returns 0 and every caller behaves byte-identically to before.
 *
 * Kill switch: `AGENTV3_CORRECTION_RESERVE=off` restores today's behaviour with no deploy.
 */

import { BUDGET_STAGE_AT } from './buildBudgetSteer';

/**
 * The share of the build's wall clock held back for verify → repair → re-verify.
 *
 * DERIVED, not chosen: it is exactly the tail `buildBudgetSteer` already declares off-limits to new
 * work at its `final` stage. If that threshold ever moves, this moves with it — which is the point.
 * Two numbers meaning one policy is how the two drift apart.
 */
export const CORRECTION_RESERVE_FRACTION = 1 - BUDGET_STAGE_AT.final;

/** Below this a reserve cannot even enter the preview verify gate (`> 90 s`), so it would be theatre. */
export const MIN_CORRECTION_RESERVE_MS = 120_000;
/** Correction is a bounded repair round, not a second build — past this it is idle time. */
export const MAX_CORRECTION_RESERVE_MS = 300_000;
/** Never take more than a quarter of the clock: on a short cap the floor would otherwise dominate. */
export const MAX_CORRECTION_RESERVE_SHARE = 0.25;

/**
 * Generation is never squeezed below this, whatever the reserve arithmetic says.
 *
 * ⚠️ IT ALSO EXISTS TO STOP A CAP OF ZERO, WHICH WOULD BE THE OPPOSITE OF A CAP. `buildTimedOut`
 * treats `maxBuildMs <= 0` as "no watchdog configured" and never stops the runner — so a reserve
 * computation that reached 0 or went negative would silently REMOVE the wall-clock guard from the
 * very build it was meant to bound. A positive floor makes that arithmetically impossible.
 */
export const MIN_GENERATION_MS = 60_000;

/** `off` restores today's behaviour exactly: no reserve, generation keeps the whole budget. */
function reserveEnabled(): boolean {
  return String(process.env.AGENTV3_CORRECTION_RESERVE ?? '').trim().toLowerCase() !== 'off';
}

/**
 * How much of `totalMs` is held back for the correction phase. `0` means "no reserve" and every
 * caller must then behave exactly as it did before this module existed.
 *
 * Pure apart from the kill switch, which is read at call time so flipping it in Cloud Run bites
 * without a deploy.
 */
export function correctionReserveMs(totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0; // watchdog disabled ⇒ nothing to divide
  if (!reserveEnabled()) return 0;
  const nominal = totalMs * CORRECTION_RESERVE_FRACTION;
  const banded = Math.min(Math.max(nominal, MIN_CORRECTION_RESERVE_MS), MAX_CORRECTION_RESERVE_MS);
  // The share is applied LAST so it can veto the floor, never the other way round.
  return Math.round(Math.min(banded, totalMs * MAX_CORRECTION_RESERVE_SHARE));
}

/**
 * The wall-clock cap to hand a GENERATION-shaped runner starting now — i.e. what is left of the
 * build's clock once the correction reserve is set aside and `elapsedMs` has already been spent.
 *
 * `AgentRunner` measures its own clock from the moment `run()` is called (`buildStartMs = Date.now()`
 * inside `run`), so a runner's cap is a REMAINING WINDOW, not a share of the total — which is why
 * `elapsedMs` is a parameter and not an afterthought. An escalation runner constructed twenty minutes
 * into a build must not be handed a fresh half-hour.
 *
 * With no reserve (watchdog off, or the kill switch) this returns `totalMs` unchanged.
 */
export function generationBudgetMs(totalMs: number, elapsedMs: number): number {
  const reserve = correctionReserveMs(totalMs);
  if (reserve <= 0) return totalMs;
  const spent = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return Math.max(MIN_GENERATION_MS, Math.round(totalMs - reserve - spent));
}
