// P-PME.4 — Build Time Estimator / Deadline Predictor.
//
// A pure, dependency-free engine that predicts how long a build will take, so the UI can show
// a real ETA instead of an open-ended spinner. It estimates two ways and blends them:
//   • heuristic   — from blueprint complexity (modules × features × avg tokens/module)
//   • historical  — weighted average of past builds with similar complexity
//
// HONESTY: with no history it falls back to the heuristic and says so (`basis: 'heuristic'`,
// lower confidence). It never reads the clock — `predictDeadline` takes the start time as input.

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

// Heuristic constants (milliseconds). Tuned to the roadmap's stated 15s–5min range.
const BASE_MS = 12_000;
const PER_MODULE_MS = 9_000;
const PER_FEATURE_MS = 4_000;
const PER_1K_TOKENS_MS = 1_500;

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
