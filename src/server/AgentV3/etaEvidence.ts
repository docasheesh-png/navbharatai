// AgentV3 — A NUMBER IS SHOWN ONLY WHEN THERE IS EVIDENCE BEHIND IT.
//
// THE QUESTION THIS MODULE ANSWERS (admin, 2026-09-14): "imaandar phase dikhao ya real number?" —
// should the build show an honest phase, or a time? The answer is that it was never a choice between
// the two. It is one rule applied to both: **show the number wherever it is measured, and the phase
// wherever it is not.** This module is the second half; progressEta.ts is the first.
//
// WHAT WAS ACTUALLY BROKEN. `progressEta.ts` (2026-08-23) already refuses to guess — it returns null
// rather than a number in every case where it would be extrapolating from nothing, and its header
// records exactly why: the prompt-word heuristic is not merely imprecise, it is BACKWARDS. "Make an
// VPN App" contains no page-words and no feature-words, so it scores the floor of every formula and
// receives the smallest estimate in the system. The shorter and more ambitious the request, the
// shorter its promise.
//
// That discipline was applied to the LIVE line and never to the FIRST one. So a build still opened
// with a figure computed by the discredited heuristic, and three consecutive autopsies recorded the
// consequence — "~2–4 min" against real builds of 12, 26.6 and 26.6 minutes, the last two of which
// the admin read in three separate reports (d11ad529, 1ef27cd7, 909d13c6). The user's complaint in
// the report that started all of this was never the wait. It was the broken promise.
//
// 🔒 THE RULE, AND WHY IT IS NOT "REMOVE THE ETA". An estimate blended from this workspace's own past
// builds IS a measurement — of real durations, on the real engine, at the real tier — and it is shown
// exactly as before. What is withheld is the number the heuristic DOMINATES, because a figure derived
// from a formula known to run backwards is not a weak estimate; it is an anchor the build cannot keep.
// An honest "I am planning your app, and I will give you a real figure the moment I can measure one"
// costs the user nothing and is replaced within minutes by a measured line — which is precisely what
// makes that later number read as information instead of as an apology.
//
// ⚠️ THE DISCRIMINATOR IS `historyWeight`, NOT `basis`, AND THAT MATTERS. `basis` reads 'blended' as
// soon as a SINGLE distant past build exists, even where that build contributes under a tenth of the
// figure — so branching on `basis` would have kept showing heuristic numbers under a label that says
// otherwise. `historyWeight` is the blend the estimator already computes and used to discard.
//
// PURE — no clock, no I/O, no formatting of anything it was not given.

import type { BuildEstimate } from '../lib/BuildTimeEstimator';
import { formatEta } from '../lib/BuildTimeEstimator';

/**
 * How much of an estimate must come from real past builds before its number may be shown.
 *
 * A half, because that is the point at which the estimate stops being mostly the backwards heuristic
 * wearing a history label. It is deliberately a share of the BLEND rather than a count of builds: two
 * past builds of nearly identical complexity are better evidence than five unrelated ones, and the
 * estimator's own inverse-distance weighting already knows the difference.
 */
export const MIN_HISTORY_WEIGHT_TO_SHOW_A_NUMBER = 0.5;

/**
 * Is this estimate backed by enough real history to put a number in front of the user?
 *
 * False for the cold case (`historyWeight` 0) and for a thin history the heuristic still dominates.
 * Never throws and never guesses: a malformed estimate is treated as unevidenced, which is the side
 * that withholds a claim rather than the side that makes one.
 */
export function estimateIsEvidenced(est: Pick<BuildEstimate, 'historyWeight'> | null | undefined): boolean {
  const w = Number(est?.historyWeight);
  if (!Number.isFinite(w)) return false;
  return w >= MIN_HISTORY_WEIGHT_TO_SHOW_A_NUMBER;
}

/**
 * The FIRST line when there is no evidence for a number yet.
 *
 * It names the phase, promises a real figure, and says what has to happen before that figure can
 * exist. ⚠️ The promise is keepable on every path by construction: the measured line comes from the
 * file manifest where there is one and from the architect's own plan otherwise, so a build that
 * reaches either produces the number this sentence undertakes to produce. The line it replaced made
 * the same promise from a path where no code existed that could keep it.
 */
export function unevidencedFirstEtaLine(): string {
  return '⏱️ Planning your app… I don\'t have a reliable time for this one yet. '
    + 'I\'ll show you a real figure — and keep it updated — as soon as I can measure how big it is.';
}

/**
 * The LIVE line while a build is still running with nothing measured to report.
 *
 * Shows elapsed time, because that is the one number that is never a promise: it has already
 * happened. Deliberately carries no countdown — an unmeasured build has no remaining time to name,
 * and inventing one is the defect this module exists to end.
 */
export function unevidencedEtaTickLine(elapsedMs: number): string {
  const inTxt = formatEta(Math.max(0, Number(elapsedMs) || 0)).replace('~', '');
  return `⏱️ Still building… ${inTxt} in · still working out how big this one is — I'll show a time as soon as I can measure it, and tell you the moment it's done.`;
}

/**
 * What the admin's build report should record about the estimate's standing.
 *
 * The report is the surface that must never be less honest than the screen (autopsy f04421ef), so it
 * states which of the two the user actually saw and why — a number, or the reason there wasn't one.
 */
export function etaEvidenceNote(est: Pick<BuildEstimate, 'historyWeight' | 'basis'>): string {
  if (estimateIsEvidenced(est)) {
    return `Shown as a number: ${Math.round(Number(est.historyWeight) * 100)}% of it comes from this workspace's own past builds (basis ${est.basis}).`;
  }
  const w = Number(est?.historyWeight);
  if (!Number.isFinite(w) || w <= 0) {
    return 'No number shown: there are no past builds to measure against, and the prompt-word heuristic alone is not evidence (it scores short, ambitious prompts smallest).';
  }
  return `No number shown: only ${Math.round(w * 100)}% of the estimate comes from real past builds, so the prompt-word heuristic still dominates it.`;
}
