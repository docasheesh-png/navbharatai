// P-PME.4 — Build Time Estimator / Deadline Predictor.
//
// A pure, dependency-free engine that predicts how long a build will take, so the UI can show
// a real ETA instead of an open-ended spinner. It estimates two ways and blends them:
//   • heuristic   — from blueprint complexity (modules × features × avg tokens/module)
//   • historical  — weighted average of past builds with similar complexity
//
// HONESTY: with no history it falls back to the heuristic and says so (`basis: 'heuristic'`,
// lower confidence). It never reads the clock — `predictDeadline` takes the start time as input.

import { isComplexAppPrompt } from './appComplexitySignals';

export interface Complexity {
  /** Number of modules / pages / screens in the blueprint. */
  moduleCount: number;
  /** Number of distinct features/capabilities. */
  featureCount: number;
  /** Optional average tokens generated per module (refines the heuristic when known). */
  avgTokensPerModule?: number;
}

export interface HistoricalBuild {
  complexity: Complexity;
  durationMs: number;
}

export interface BuildEstimate {
  estimateMs: number;
  /** Lower / upper bound of the estimate (a real range, not a point claim). */
  lowMs: number;
  highMs: number;
  /** 0–1 confidence — higher with more, closer historical matches. */
  confidence: number;
  basis: 'heuristic' | 'historical' | 'blended';
  etaText: string;
  complexityScore: number;
}

// Heuristic constants (milliseconds). RE-CALIBRATED to REAL measured NavBharatAI Pro v5.0 durations
// (autopsy 2026-07-11): a Todo build (15 files) took ~3.7 min end-to-end and a Notes build (20 files)
// ~4.0 min — with the file-by-file SimpleBuilder fast lane the fixed overhead is small (the reports
// show npm install ~1s + npm run dev ~9–55s + first preview ~16s ≈ 90–120s, NOT 7 min). The PREVIOUS
// constants (7 min base + 30s/feature) over-estimated these builds ~7× — every report opened with a
// scary "~28 min" that finished in ~4. (The generation BEFORE that under-estimated 20× — "~25s" — so
// the honest band is minutes, neither seconds nor half an hour.) Complex agentic builds still scale
// up via module/feature counts; history blending refines it further once real durations accrue.
const BASE_MS = 120_000; // ~2 min fixed overhead (sandbox + install + dev server + first preview)
const PER_MODULE_MS = 45_000; // ~45s per page/screen/module
const PER_FEATURE_MS = 8_000; // ~8s per distinct feature (a feature is far cheaper than a whole module)
const PER_1K_TOKENS_MS = 5_000;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** A single scalar capturing build size (used to match against historical builds). */
export function complexityScore(c: Complexity): number {
  const tokenTerm = c.avgTokensPerModule ? (c.avgTokensPerModule / 1000) * c.moduleCount : 0;
  return Math.max(0, c.moduleCount) * 2 + Math.max(0, c.featureCount) + tokenTerm;
}

/** Pure heuristic estimate from complexity alone (ms). */
export function heuristicEstimateMs(c: Complexity): number {
  const tokens = c.avgTokensPerModule ? c.avgTokensPerModule * Math.max(0, c.moduleCount) : 0;
  return Math.round(
    BASE_MS
    + Math.max(0, c.moduleCount) * PER_MODULE_MS
    + Math.max(0, c.featureCount) * PER_FEATURE_MS
    + (tokens / 1000) * PER_1K_TOKENS_MS,
  );
}

/** Format a duration as a short human ETA, e.g. "~45s" or "~2 min". */
export function formatEta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `~${s}s`;
  const m = Math.round(s / 60);
  return `~${m} min`;
}

/** One live-ETA tick: the line to show, plus the (possibly re-baselined) budget for the next tick. */
export interface EtaTick {
  /** The user-facing status line. */
  text: string;
  /** The total budget to carry into the NEXT tick — extended when the build overran. */
  totalMs: number;
  /** True when this tick re-baselined the budget because the build overran its estimate. */
  revised: boolean;
  /** How many times the budget has been re-baselined so far. MUST be carried into the next tick. */
  revisions: number;
}

/** How far past the estimate we let a tick sit before re-baselining (matches the old 45s threshold). */
const ETA_WRAP_THRESHOLD_MS = 45_000;
const ETA_MIN_STEP_MS = 3 * 60_000;
const ETA_MAX_STEP_MS = 15 * 60_000;
/** After this many broken promises we stop promising a time at all and just say we are still working. */
const ETA_MAX_PROMISES = 2;

/**
 * Decide the live "Still building…" line for one heartbeat tick — and RE-BASELINE the budget when the
 * build overruns.
 *
 * ROOT CAUSE it fixes (build-report autopsy 2026-08-02, SaaS dashboard): the caller computed
 * `remaining = totalMs - elapsedMs` against a total that was fixed at build START and never revised.
 * The moment a build passed its estimate, `remaining` went negative and EVERY later tick printed the
 * identical "wrapping up (a little longer than estimated)" line — a real 31-minute build showed it 12
 * times across 22 minutes while nowhere near done. "Wrapping up" at minute 8 is fair; at minute 30 it
 * is simply untrue, and the code's own comment claimed it was "adapting as the build runs" when it was
 * not.
 *
 * Now: inside the estimate the line counts down as before; on overrun the budget is EXTENDED by half
 * the original estimate (clamped to 3–10 min) and the line says plainly that the app is bigger than
 * expected and roughly how much longer — so the number keeps moving and never freezes on a stale claim.
 * Pure: no clock reads, no I/O — every input is passed in.
 */
export function liveEtaTick(elapsedMs: number, totalMs: number, baseMs: number, revisions = 0): EtaTick {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const total = Number.isFinite(totalMs) && totalMs > 0 ? totalMs : 0;
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : total;
  const done = Number.isFinite(revisions) && revisions > 0 ? Math.floor(revisions) : 0;
  const inTxt = formatEta(elapsed).replace('~', '');
  const remaining = total - elapsed;

  if (remaining > ETA_WRAP_THRESHOLD_MS) {
    // ONCE THE ESTIMATE HAS BEEN BROKEN, STOP COUNTING DOWN (mitrify autopsy 2026-08-04).
    // The re-baseline granted a 3-minute extension, so two minutes later this branch cheerfully
    // printed "~1 min to go" — then overran again, extended again, and printed "~1 min to go" again.
    // A real 27-minute build promised "~1 min to go" FIVE times. The countdown is only honest while we
    // still have an estimate we have not already broken; after that, elapsed time is the one number we
    // can actually stand behind, so that is the only number shown.
    if (done > 0) {
      return {
        text: `⏱️ Still building… ${inTxt} in · bigger than estimated, still working — I'll tell you the moment it's done.`,
        totalMs: total,
        revised: false,
        revisions: done,
      };
    }
    return {
      text: `⏱️ Still building… ${inTxt} in · ~${formatEta(remaining).replace('~', '')} to go`,
      totalMs: total,
      revised: false,
      revisions: done,
    };
  }

  // Overran. Each successive overrun is EVIDENCE THE ESTIMATE WAS WRONG BY A LARGER FACTOR, so the
  // extension doubles instead of repeating the same small step — a fixed step is what produced the
  // 2-minute sawtooth of broken promises.
  const step = Math.min(ETA_MAX_STEP_MS, Math.max(ETA_MIN_STEP_MS, Math.round((base / 2) * Math.pow(2, done))));
  const next = done + 1;
  // After a couple of broken promises, naming another number is not information — it is the same lie
  // with a bigger integer. Say plainly that it is taking longer and that we will report when it lands.
  const text = next > ETA_MAX_PROMISES
    ? `⏱️ Still building… ${inTxt} in · this is taking longer than estimated. I'm still working on it and will tell you the moment it's done.`
    : `⏱️ Still building… ${inTxt} in · this app is bigger than expected — about ${formatEta(step).replace('~', '')} more to go`;
  return { text, totalMs: elapsed + step, revised: true, revisions: next };
}

/**
 * Historical estimate: weighted average of past builds, weighting closer complexity scores more
 * heavily (inverse-distance). Returns null when there is no usable history.
 */
function historicalEstimateMs(history: HistoricalBuild[], targetScore: number): { ms: number; weight: number; n: number } | null {
  const valid = history.filter((h) => Number.isFinite(h.durationMs) && h.durationMs > 0);
  if (valid.length === 0) return null;
  let wSum = 0;
  let wMs = 0;
  for (const h of valid) {
    const dist = Math.abs(complexityScore(h.complexity) - targetScore);
    const w = 1 / (1 + dist); // closer score → larger weight
    wSum += w;
    wMs += w * h.durationMs;
  }
  if (wSum === 0) return null;
  return { ms: wMs / wSum, weight: wSum, n: valid.length };
}

/** Estimate build duration from complexity + optional history. Pure. */
export function estimateBuildTime(complexity: Complexity, history: HistoricalBuild[] = []): BuildEstimate {
  const score = complexityScore(complexity);
  const heuristic = heuristicEstimateMs(complexity);
  const hist = historicalEstimateMs(history, score);

  let estimateMs: number;
  let basis: BuildEstimate['basis'];
  let confidence: number;

  if (!hist) {
    estimateMs = heuristic;
    basis = 'heuristic';
    confidence = 0.4; // no history → modest confidence
  } else {
    // More (and closer) history → trust it more; blend with the heuristic otherwise.
    const histTrust = clamp(hist.n / 5, 0, 1) * clamp(hist.weight, 0, 1);
    estimateMs = Math.round(hist.ms * histTrust + heuristic * (1 - histTrust));
    basis = histTrust > 0.85 ? 'historical' : 'blended';
    confidence = clamp(0.5 + histTrust * 0.45, 0, 0.95);
  }

  // Range widens as confidence drops.
  const spread = 1 - confidence; // 0.05 … 0.6
  return {
    estimateMs,
    lowMs: Math.round(estimateMs * (1 - spread * 0.5)),
    highMs: Math.round(estimateMs * (1 + spread * 0.8)),
    confidence: Math.round(confidence * 100) / 100,
    basis,
    etaText: formatEta(estimateMs),
    complexityScore: Math.round(score * 100) / 100,
  };
}

/** Predict an absolute completion time from an estimate + the build's start time (input, not the clock). */
export function predictDeadline(estimateMs: number, startMs: number): { finishMs: number; etaText: string } {
  return { finishMs: startMs + Math.max(0, estimateMs), etaText: formatEta(estimateMs) };
}

/**
 * Rough Complexity inferred from a build prompt — used to show an ETA before the build runs (no
 * blueprint exists yet at that point). Pure + deterministic. Counts page/screen-like nouns for
 * modules and feature-list separators for features, each clamped to a sane range so a giant prompt
 * can't produce an absurd estimate.
 */
export function complexityFromPrompt(prompt: string): Complexity {
  const text = String(prompt || '');
  const moduleMatches = text.match(/\b(page|pages|screen|screens|view|views|dashboard|section|sections|tab|tabs|route|routes)\b/gi);
  // Feature signals: list separators + common feature verbs/nouns.
  const featureMatches = text.match(/(?:,|\band\b|\bwith\b|\bplus\b|\n[-*•]|\b(auth|login|signup|search|filter|chart|payment|upload|export|profile|admin|cart|checkout|notification|comment|like|follow)\w*)/gi);
  let moduleCount = clamp((moduleMatches?.length ?? 0) + 1, 1, 20);
  let featureCount = clamp(featureMatches?.length ?? 0, 1, 30);
  // A NAMED complex-app category (SaaS, CRM, e-commerce, social, full-stack, …) is inherently
  // multi-module/multi-feature, but a SHORT prompt like "build a SaaS CRM" has no page/feature words
  // to count → it scored magnitude 2 (fast lane) and a wildly optimistic ETA, contradicting the
  // request analyser that already calls the same prompt `complex_app`. Floor the counts so the
  // magnitude (moduleCount + featureCount) reaches the DEEP threshold (≥ 12), giving these builds the
  // deep pipeline + realistic ETA. Simple apps (todo/calculator) don't match → unchanged fast lane.
  // Safe: this only ever RAISES the estimate/headroom (a build stops the moment it is done).
  if (isComplexAppPrompt(text)) {
    moduleCount = clamp(Math.max(moduleCount, 6), 1, 20);
    featureCount = clamp(Math.max(featureCount, 6), 1, 30);
  }
  return { moduleCount, featureCount };
}
