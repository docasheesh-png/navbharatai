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

import { formatEta } from '../lib/BuildTimeEstimator';
import type { BuildEstimate } from '../lib/BuildTimeEstimator';

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
 * Format a low–high band, collapsing to a single figure when the two round to the same thing (a
 * "2–2 min" range is noise, not precision). Falls back to the point estimate if the band is unusable.
 */
export function formatEtaRange(lowMs: number, highMs: number, fallbackMs: number): string {
  const lo = Number(lowMs);
  const hi = Number(highMs);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) return formatEta(Number(fallbackMs) || 0);
  const loTxt = formatEta(lo);
  const hiTxt = formatEta(hi);
  if (loTxt === hiTxt) return loTxt;
  // "~2–4 min" rather than "~2 min–~4 min": one tilde covers the whole band, and the unit is shared
  // whenever both sides carry the same one.
  const loBare = loTxt.replace('~', '');
  const hiBare = hiTxt.replace('~', '');
  const unit = /min$/.test(loBare) && /min$/.test(hiBare) ? 'min' : null;
  if (unit) return `~${loBare.replace(/\s*min$/, '')}–${hiBare}`;
  return `~${loBare}–${hiBare}`;
}
