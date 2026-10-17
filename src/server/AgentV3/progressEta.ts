// AgentV3 — THE ETA STOPS GUESSING AND STARTS MEASURING.
//
// THE DEFECT (admin, from a real user's report 2026-08-23): the build said "~3 min" and ran 18m 42s —
// more than 6× out. The user sent the report *because of the broken promise*, not because of the build.
//
// THE ROOT CAUSE IS NOT A BADLY TUNED CONSTANT. It is that the number came from counting WORDS IN THE
// PROMPT. `complexityFromPrompt` looks for page-words and feature-words; the prompt was "Make an VPN
// App", which contains neither, so it scored the floor of every formula — moduleCount 1, featureCount 1
// — and `heuristicEstimateMs` returned 120s + 45s + 8s = 173s ≈ "~3 min". **The shorter and more
// ambitious the request, the smaller the estimate.** That is exactly backwards, and the bare one-line
// app request is the single most common prompt shape there is.
//
// Tuning the keyword list is the surface patch, and this repo has already been bitten by one: two
// detectors kept private keyword lists, drifted, and routed the same prompt two different ways
// (see appComplexitySignals.ts). Adding "vpn" would buy a day, until "make a music app" arrives.
//
// So this module removes the guess instead of improving it. **Once a build is running it does not need
// to predict how long a file takes — it can watch.** The route already knows how many files the plan
// asked for and how many have actually been written; the time between them is a measurement of THIS
// build, on THIS provider chain, at THIS tier, under whatever rate limiting is happening right now. No
// constant here can be wrong about a model we have not benchmarked, because nothing here is calibrated
// against a model at all.
//
// WHAT IT DELIBERATELY DOES NOT DO: predict a repair loop. When a build has written every planned file
// and is still going, it is verifying or repairing, and how long that takes is genuinely unknown —
// `measuredRemainingMs` returns null and the caller falls back to `liveEtaTick`, which after two broken
// promises stops naming numbers and says plainly that it is taking longer. An honest "I don't know" is
// worth more than a sixth guess.
//
// PURE — no clock, no I/O. Every input is passed in.

import { formatEta, formatEtaRange, liveEtaTick } from '../lib/BuildTimeEstimator';
import type { BuildEstimate } from '../lib/BuildTimeEstimator';
import { unevidencedEtaTickLine, ROUGH_ESTIMATE_LABEL } from './etaEvidence';

// Moved to BuildTimeEstimator.ts (autopsy 9c612cdb — see its note there); re-exported so every caller
// that imports it from here keeps working.
export { formatEtaRange };

/**
 * How many files must be finished before extrapolating.
 *
 * Three, because the first file is not a sample of anything: it carries whatever setup happened to
 * land inside it, and one file gives zero intervals to average. From the FIRST file's completion, three
 * files give two real intervals — enough to smooth a single slow call without waiting so long that the
 * estimate arrives after it would have been useful.
 */
export const MIN_FILES_FOR_MEASUREMENT = 3;

/**
 * Time to allow for everything after the last file: typecheck, dev server, first paint, the readiness
 * probe. Measured builds in this repo put the tail at roughly a minute (the estimator's own notes
 * record npm install ~1s, dev server ~9–55s, first preview ~16s), so this is that band's upper half —
 * an ETA that runs slightly long is a pleasant surprise; one that runs short is the complaint we are
 * fixing.
 */
export const FINISH_ALLOWANCE_MS = 60_000;

export interface FileProgress {
  /** How many source files the plan asked for. 0/unknown disables measurement. */
  plannedFiles: number;
  /** How many have genuinely been written so far. */
  filesDone: number;
  /** Epoch ms the FIRST file landed — the start of the only interval we can honestly measure. */
  firstFileAt: number;
  /** Epoch ms now (passed in — this module never reads the clock). */
  now: number;
}

/** Average wall time per file so far, or null when there are not yet two intervals to average. */
export function observedPerFileMs(p: FileProgress): number | null {
  const done = Math.floor(Number(p?.filesDone));
  const first = Number(p?.firstFileAt);
  const now = Number(p?.now);
  if (!Number.isFinite(done) || done < MIN_FILES_FOR_MEASUREMENT) return null;
  if (!Number.isFinite(first) || first <= 0) return null;
  if (!Number.isFinite(now) || now <= first) return null;
  // `done - 1` intervals have elapsed since the first file completed. Dividing by `done` instead would
  // credit the build with an interval that never happened and quietly under-estimate every remaining
  // file — the same optimistic direction as the bug this module exists to fix.
  return (now - first) / (done - 1);
}

/**
 * Remaining build time extrapolated from real progress, or null when measurement does not apply.
 *
 * Null — never a number — in every case where we would be guessing: no plan, too few files to average,
 * or the file phase already finished (a build past its last planned file is verifying or repairing, and
 * this module has no evidence about that). The caller must treat null as "keep the honest fallback",
 * not as zero.
 */
export function measuredRemainingMs(p: FileProgress): number | null {
  const planned = Math.floor(Number(p?.plannedFiles));
  const done = Math.floor(Number(p?.filesDone));
  if (!Number.isFinite(planned) || planned <= 0) return null;
  if (!Number.isFinite(done) || done >= planned) return null; // file phase over — see the header
  const perFile = observedPerFileMs(p);
  if (perFile === null || !(perFile > 0)) return null;
  return Math.round((planned - done) * perFile + FINISH_ALLOWANCE_MS);
}

/**
 * 🔴 THE MEASUREMENT ABOVE COULD NOT RUN ON THE PATH THAT NEEDED IT (autopsy d11ad529, 2026-09-14).
 *
 * `measuredRemainingMs` needs `plannedFiles`, and in the whole route that number had exactly TWO
 * producers: the simple lane's `onPlanned`, and the blueprint step. Both are lanes, not the build —
 * and neither runs on the ordinary path:
 *
 *   - **The simple lane only reports a plan when its plan call SUCCEEDS.** In the reported build that
 *     call hit its 90 s cap and the lane handed off, so nothing was ever reported. Note the shape of
 *     this: a lane that finishes quickly does not need a long-build ETA at all, so the measurement was
 *     wired to the one case where it is least useful and absent from the case where the user is
 *     actually sitting and watching.
 *   - **The blueprint is gated** on `deep` depth, on NOT being simple-lane-eligible, and on
 *     `AGENTV3_BLUEPRINT`. An ordinary one-shot app misses it by the first two conditions alone.
 *
 * So that build ran 12 minutes with `plannedFiles` stuck at 0, `measuredRemainingMs` returning null on
 * every tick, and the user reading the prompt-word heuristic this module's own header calls "exactly
 * backwards". The first line had promised them *"I'll replace it with a real figure as soon as I know
 * how big it is"* — a promise that path could not keep, by construction. Three consecutive autopsies
 * (#2929, #2931 and this one) recorded the ETA lying while the fix for it sat in this file, unreachable.
 *
 * THE SIGNAL THAT WAS ALREADY THERE. The full builder does not know a file count up front — asking it
 * to guess one would be the very thing this module refuses. But it does keep the architect's OWN plan:
 * the todo list, whose done-count `PlanProgress.computePlanProgress` already derives from REAL file
 * writes, and already paints as ticks on the user's screen. So "5 of 8 steps done" is not a new claim
 * invented for the ETA — it is the state the user can already see, given a clock.
 *
 * Same discipline as the file measurement, deliberately: null in every case where it would be
 * guessing, and the caller keeps the honest fallback.
 */

/**
 * How many plan steps must be finished before extrapolating. Three for the same reason as files: the
 * first completion starts the clock and gives no interval, so three give two intervals to average.
 */
export const MIN_STEPS_FOR_MEASUREMENT = 3;

export interface PlanStepProgress {
  /** How many items the architect's own plan has. Fewer than 2 disables measurement. */
  plannedSteps: number;
  /** How many have been completed — the same counter that advances the ticks the user sees. */
  stepsDone: number;
  /** Epoch ms the FIRST step completed. */
  firstStepAt: number;
  /** Epoch ms now (passed in — this module never reads the clock). */
  now: number;
}

/** Average wall time per completed plan step, or null without two intervals to average. */
export function observedPerStepMs(p: PlanStepProgress): number | null {
  const done = Math.floor(Number(p?.stepsDone));
  const first = Number(p?.firstStepAt);
  const now = Number(p?.now);
  if (!Number.isFinite(done) || done < MIN_STEPS_FOR_MEASUREMENT) return null;
  if (!Number.isFinite(first) || first <= 0) return null;
  if (!Number.isFinite(now) || now <= first) return null;
  // `done - 1` intervals since the first step landed — dividing by `done` would credit an interval
  // that never happened and under-estimate what is left, the same optimistic direction as the bug.
  return (now - first) / (done - 1);
}

/**
 * Remaining build time extrapolated from the architect's own plan, or null when it would be a guess.
 *
 * ⚠️ `stepsDone` counts real completions and is NOT clamped to the plan's length by its producer, so
 * it can run PAST `plannedSteps` when the plan under-counted the work. That is precisely the case
 * where the plan has stopped describing the build, so it returns null rather than a negative or a
 * zero — "the plan was too small" is not the same fact as "there is no time left".
 */
export function measuredRemainingFromSteps(p: PlanStepProgress): number | null {
  const planned = Math.floor(Number(p?.plannedSteps));
  const done = Math.floor(Number(p?.stepsDone));
  // A one-item plan has nothing to extrapolate across: its only interval is the whole build.
  if (!Number.isFinite(planned) || planned < 2) return null;
  if (!Number.isFinite(done) || done >= planned) return null;
  const perStep = observedPerStepMs(p);
  if (perStep === null || !(perStep > 0)) return null;
  return Math.round((planned - done) * perStep + FINISH_ALLOWANCE_MS);
}

/**
 * The live line for a plan-measured estimate. Names what it counted, for the same reason the file
 * line does — and the count matches the ticks already on the user's screen, so it is checkable rather
 * than merely asserted.
 */
export function stepEtaText(elapsedMs: number, remainingMs: number, stepsDone: number, plannedSteps: number): string {
  const inTxt = formatEta(Math.max(0, elapsedMs)).replace('~', '');
  const leftTxt = formatEta(Math.max(0, remainingMs)).replace('~', '');
  return `⏱️ Building… ${inTxt} in · ${stepsDone} of ${plannedSteps} steps done · ~${leftTxt} to go`;
}

/**
 * The live line for a MEASURED estimate. Says what it is counting so the number is checkable by the
 * person reading it — "12 of 19 files" is a claim the user can watch come true, where "~4 min to go"
 * on its own is only ever a promise.
 */
/**
 * The line once the build loop is over and only the platform's checks remain. No number: those checks are
 * a few minutes at most, and a countdown there has promised "about 7 min more" 34 seconds before the end
 * (autopsy de3bb2bb). PURE.
 */
export function finalChecksEtaLine(elapsedMs: number, appExists = false): string {
  const inTxt = formatEta(Math.max(0, elapsedMs)).replace('~', '');
  // 🔴 "YOUR APP IS BUILT" IS A CLAIM, AND IT IS MADE ONLY WHEN SOMETHING WAS BUILT (Q-1024).
  //
  // `finalChecks` is a PHASE flag — the builder's loop is over — which is true of a stopped build and
  // of one that wrote nothing at all. The route's immediate announcement already knew this and guarded
  // it (`emitEtaPhaseNow({ unlessStopped, wrote: builderWroteCount })`), and the comment beside that
  // guard states the rule outright: *"a stopped or empty build is never told 'your app is built'"*.
  // The two-minute HEARTBEAT tick had no such guard, so it said it anyway. A rule enforced at one of
  // two call sites is not enforced — so the rule now lives here, where the sentence is written, and
  // every caller answers for it.
  //
  // Without the fact, the line still reports the phase and claims nothing: `appRunningEtaLine` demands
  // a real `appRenderedAt` for the WEAKER claim "running in the preview", so this stronger one must not
  // need less.
  return appExists
    ? `⏱️ Almost done… ${inTxt} in · your app is built — running the final checks.`
    : `⏱️ Almost done… ${inTxt} in · running the final checks.`;
}

/**
 * The line once the app has been PROVEN running in a real browser (the in-build green), while the build
 * is still going. No number: the app is on the user's screen, so the one thing a countdown could add is
 * a guess about how long the finishing takes (autopsy 9c612cdb — "about 3 min more to go" 11 s after the
 * app had rendered and been protected). True whether the green fires at the end or mid-build. PURE.
 */
export function appRunningEtaLine(elapsedMs: number): string {
  const inTxt = formatEta(Math.max(0, elapsedMs)).replace('~', '');
  return `⏱️ ${inTxt} in · your app is already running in the preview — I'm finishing it`;
}

/**
 * The phase line a build is in RIGHT NOW, or null when no phase outranks the budget arithmetic. The
 * route also calls this at the moment a phase begins, so the line changes at the transition rather than
 * at the next even minute. PURE.
 */
export function etaPhaseLine(p: {
  elapsedMs: number;
  finalChecks: boolean;
  appRenderedAt: number;
  /** Did this build produce an app? Omitted ⇒ unknown, and the final-checks line claims nothing (Q-1024). */
  appExists?: boolean;
}): string | null {
  if (p.finalChecks) return finalChecksEtaLine(p.elapsedMs, p.appExists === true || Number(p.appRenderedAt) > 0);
  if (Number(p.appRenderedAt) > 0) return appRunningEtaLine(p.elapsedMs);
  return null;
}

/**
 * 🔴 THE LIVE ETA LINE IS DECIDED HERE, AND ONLY HERE (autopsy 9c612cdb, 2026-10-12).
 *
 * The decision used to live inline in a 27,000-line route, guarded only by source-position tests, and
 * it decided from TIME BUDGETS ALONE: a prompt-word guess, a write-cadence pace and a fixed tail. It
 * consulted one phase flag, set when the integrity pass started. So the minute-6 tick of that build fell
 * 11 s AFTER the app had rendered and been protected, and told the user "about 3 min more to go" — the
 * build ended 96 s later — and its minute-4 tick counted down to the top of a rough GUESS with no label
 * ("~2 min to go"). Four earlier autopsies each patched one branch of this decision (d382b398's wording,
 * Q-030's promised band, de3bb2bb's final-checks line, d11ad529's plan measurement); none could see the
 * whole order, because the order was scattered through a closure no test could execute.
 *
 * THE ORDER IS THE RULE, and every branch is a fact before it is a number:
 *   1. final checks — the builder's loop is over; only the platform's checks remain. No number.
 *   2. app rendered — the app is visibly running in the preview. No number. Outranks the measurements:
 *      a measured countdown after the app is on screen would be counting down to something the user
 *      already has.
 *   3. measured from files, then from plan steps — the build's own observed pace.
 *   4. unevidenced — nothing measured yet: elapsed time, the build's own limit, the labelled rough band.
 *   5. the budget countdown (`liveEtaTick`) — and when its target is the top of a ROUGH band, the line
 *      says it is a guess; past that top, it says the guess was too low (etaEvidence.ts's sentence),
 *      never the overrun floor.
 *
 * Returns the line and the state the caller carries to the next tick. PURE — every input passed in.
 */
export interface EtaTickState {
  /** Build time already spent (the caller's clock, wait-adjusted). Shown as "N min in". */
  elapsedMs: number;
  /** Epoch ms now — the measurements extrapolate from it. */
  now: number;
  /** The builder's loop is over and only the platform's final checks remain. */
  finalChecks: boolean;
  /** Epoch ms the app was first PROVEN rendered in a real browser this build; 0 = not yet. */
  appRenderedAt: number;
  /**
   * Did this build produce an app? The final-checks line claims "your app is built" ONLY on this
   * (Q-1024) — `finalChecks` alone is also true of a stopped build and of one that wrote nothing.
   * Omitted ⇒ unknown, and the line reports the phase without the claim.
   */
  appExists?: boolean;
  plannedFiles: number;
  filesDone: number;
  firstFileAt: number;
  plannedSteps: number;
  /** DISTINCT paths written against the plan — a rewrite of one file is repair, not a new step. */
  stepsDone: number;
  firstStepAt: number;
  /** Is there evidence behind a number (real history up front, or a measurement since)? */
  evidenced: boolean;
  /** The build's own configured time limit, ms; 0 = no cap. */
  budgetMs: number;
  /** The labelled rough band the user was first shown (`~4–6 min`), or null when the first figure was evidenced. */
  roughBand: string | null;
  roughHighMs: number | null;
  /** The budget carried between ticks, the original estimate, broken promises so far, and the band's top. */
  totalMs: number;
  baseMs: number;
  revisions: number;
  promisedHighMs: number;
}

export interface EtaTickDecision {
  text: string;
  kind: 'final-checks' | 'app-running' | 'measured-files' | 'measured-steps' | 'no-work-yet' | 'unevidenced' | 'rough-countdown' | 'rough-outrun' | 'budget';
  /** State to carry into the next tick. */
  totalMs: number;
  revisions: number;
  evidenced: boolean;
}

/** How long a build may run with nothing written before its history-based countdown is withdrawn. */
export const NO_WORK_MIN_GRACE_MS = 3 * 60_000;
export const NO_WORK_GRACE_SHARE_OF_PROMISE = 0.35;
export function noWorkGraceMs(promisedHighMs: number): number {
  const promised = Number(promisedHighMs);
  return Math.max(NO_WORK_MIN_GRACE_MS, Number.isFinite(promised) && promised > 0 ? promised * NO_WORK_GRACE_SHARE_OF_PROMISE : 0);
}

/** The line that replaces a countdown nothing in this build supports. Elapsed time is the one number that is never a promise. PURE. */
export function noWorkYetLine(elapsedMs: number, budgetMs?: number): string {
  const inTxt = formatEta(Math.max(0, Number(elapsedMs) || 0)).replace('~', '');
  const budget = Number(budgetMs);
  const left = Number.isFinite(budget) && budget > Number(elapsedMs) ? ` I will keep going for up to ${formatEta(budget - Number(elapsedMs)).replace('~', '')} more.` : '';
  return `⏱️ Still building… ${inTxt} in · nothing has been written yet, so I can't give you a finish time.${left} If it still produces nothing, I will stop and tell you honestly.`;
}

export function etaTickLine(s: EtaTickState): EtaTickDecision {
  const elapsedMs = Math.max(0, Number(s.elapsedMs) || 0);
  const keep = { totalMs: s.totalMs, revisions: s.revisions, evidenced: s.evidenced };
  const phase = etaPhaseLine({ elapsedMs, finalChecks: s.finalChecks, appRenderedAt: s.appRenderedAt, ...(s.appExists === undefined ? {} : { appExists: s.appExists }) });
  if (phase !== null) return { text: phase, kind: s.finalChecks ? 'final-checks' : 'app-running', ...keep };

  const measured = measuredRemainingMs({ plannedFiles: s.plannedFiles, filesDone: s.filesDone, firstFileAt: s.firstFileAt, now: s.now });
  if (measured !== null) {
    // A MEASUREMENT IS EVIDENCE, and it re-anchors the budget: if measurement later stops applying (the
    // build enters repair) the countdown continues from this build's own pace, not from the prompt guess.
    return { text: measuredEtaText(elapsedMs, measured, s.filesDone, s.plannedFiles), kind: 'measured-files', totalMs: elapsedMs + measured, revisions: s.revisions, evidenced: true };
  }
  // The plan second: a file manifest is an exact count of what will be written, a plan step is a unit
  // of the architect's own choosing — where both exist the file count is the better evidence.
  const byStep = measuredRemainingFromSteps({ plannedSteps: s.plannedSteps, stepsDone: s.stepsDone, firstStepAt: s.firstStepAt, now: s.now });
  if (byStep !== null) {
    return { text: stepEtaText(elapsedMs, byStep, s.stepsDone, s.plannedSteps), kind: 'measured-steps', totalMs: elapsedMs + byStep, revisions: s.revisions, evidenced: true };
  }
  // A FORECAST THIS BUILD HAS ALREADY CONTRADICTED IS NOT COUNTED DOWN (autopsy 67a2b0a2, 2026-10-15).
  // The opening figure was evidenced — "23 recent builds of this kind averaged 10 min" — and that evidence is
  // about OTHER builds. This one had written no file and finished no step, and its line still read "~6 min to
  // go" at minute 4, "~4 min" at 6 and "~2 min" at 8, until the futility breaker stopped it at 10 with nothing
  // produced: a countdown to a finish nothing observed in THIS build supported. History earns the forecast; the
  // build's own silence withdraws it. After a grace (a plan and a first file legitimately take minutes) the line
  // says what is measured — time spent, nothing written — and names no finish.
  if (s.evidenced && (Number(s.filesDone) || 0) === 0 && (Number(s.stepsDone) || 0) === 0
      && elapsedMs >= noWorkGraceMs(s.promisedHighMs)) {
    return { text: noWorkYetLine(elapsedMs, s.budgetMs), kind: 'no-work-yet', ...keep };
  }
  // NO EVIDENCE ⇒ NO COUNTDOWN (autopsy d11ad529): elapsed time, the build's own limit and the labelled band.
  if (!s.evidenced) {
    return { text: unevidencedEtaTickLine(elapsedMs, s.budgetMs, s.roughBand, s.roughHighMs), kind: 'unevidenced', ...keep };
  }
  // A COUNTDOWN WHOSE TARGET IS THE TOP OF A GUESS IS STILL A GUESS. The budget's target is the rough
  // band's top whenever no broken promise has re-baselined it and no measurement has pushed it past
  // that top — `liveEtaTick` counts to max(total, promise).
  const promised = Number(s.promisedHighMs) || 0;
  const roughTarget = !!s.roughBand && (Number(s.revisions) || 0) === 0 && promised > 0 && (Number(s.totalMs) || 0) <= promised;
  if (roughTarget && elapsedMs > promised) {
    // Past it: the guess was too low — said in the words the unevidenced line already uses, with no new
    // number (the overrun floor is a constant, not a measurement). Nothing is re-baselined, so every
    // later tick says the same true thing until a real measurement takes the line back.
    return { text: unevidencedEtaTickLine(elapsedMs, s.budgetMs, s.roughBand, s.roughHighMs ?? promised), kind: 'rough-outrun', ...keep };
  }
  const tick = liveEtaTick(elapsedMs, s.totalMs, s.baseMs || s.totalMs, s.revisions, s.promisedHighMs);
  const next = { totalMs: tick.totalMs, revisions: tick.revisions, evidenced: true };
  if (roughTarget && tick.kind === 'countdown') {
    const inTxt = formatEta(elapsedMs).replace('~', '');
    const leftTxt = formatEta(Math.max(0, tick.totalMs - elapsedMs)).replace('~', '');
    return { text: `⏱️ Still building… ${inTxt} in · ~${leftTxt} to go on my rough estimate of ${s.roughBand} (${ROUGH_ESTIMATE_LABEL})`, kind: 'rough-countdown', ...next };
  }
  if (roughTarget && tick.kind === 'near-end') {
    const inTxt = formatEta(elapsedMs).replace('~', '');
    return { text: `⏱️ Still building… ${inTxt} in · nearly at the top of my rough estimate of ${s.roughBand} (${ROUGH_ESTIMATE_LABEL}) — I'll tell you the moment it's done.`, kind: 'rough-countdown', ...next };
  }
  return { text: tick.text, kind: 'budget', ...next };
}

export function measuredEtaText(elapsedMs: number, remainingMs: number, filesDone: number, plannedFiles: number): string {
  const inTxt = formatEta(Math.max(0, elapsedMs)).replace('~', '');
  const leftTxt = formatEta(Math.max(0, remainingMs)).replace('~', '');
  return `⏱️ Building… ${inTxt} in · ${filesDone} of ${plannedFiles} files written · ~${leftTxt} to go`;
}

/**
 * The FIRST line, shown before anything has been measured.
 *
 * It used to print `est.etaText` — the single point estimate — and throw away the `lowMs`/`highMs`
 * range and the `confidence` that the very same call had just computed. At confidence 0.4 the estimator
 * is saying "±60%" while the UI says "~3 min", so the code was more honest internally than it was to
 * the user. Now the band is shown, and a first build says outright that the number will be replaced —
 * which is what makes the later measured update read as information rather than as a broken promise.
 */
export function firstEtaLine(est: Pick<BuildEstimate, 'estimateMs' | 'lowMs' | 'highMs' | 'confidence'>, historyCount: number): string {
  const range = formatEtaRange(est.lowMs, est.highMs, est.estimateMs);
  if (historyCount > 0) {
    return `⏱️ Estimated build time: ${range} — based on your last ${historyCount} build${historyCount === 1 ? '' : 's'}. I'll keep you posted as I go.`;
  }
  return `⏱️ Estimated build time: ${range} — this is a first guess before I've planned your app. I'll replace it with a real figure as soon as I know how big it is.`;
}

/**
 * The first line when the figure comes from NavBharatAI's recent builds of this kind rather than this
 * app's own (autopsy a5b661c8). Says whose builds it is from, so it is never read as a promise about this
 * one. PURE.
 */
export function fleetEtaLine(est: Pick<BuildEstimate, 'estimateMs' | 'lowMs' | 'highMs'>, builds: number): string {
  const range = formatEtaRange(est.lowMs, est.highMs, est.estimateMs);
  return `⏱️ Estimated build time: ${range} — how long ${builds} recent build${builds === 1 ? '' : 's'} of this kind of app took on NavBharatAI. I'll replace it with your app's own figure as soon as I can measure how big it is.`;
}
