// P-MON.4 — Composite Health / Reliability / Risk scoring.
//
// A pure, dependency-free engine that turns the platform's REAL signals (error rate,
// latency, success rate, uptime) into three 0–100 scores plus an honest grade. It is the
// scoring core behind the admin health endpoint and the App Health Monitor.
//
// HONESTY (a core NavBharatAI law): every input is optional. A signal that is genuinely
// unknown contributes NOTHING (it is not invented, not defaulted to a flattering value) —
// it simply drops out of the weighted average. If NO signal is known, the score is `null`
// (an honest "no data"), never a fabricated number.

export interface HealthInputs {
  /** Request/build error rate, 0–100 (%). Lower is better. */
  errorRatePct?: number | null;
  /** Average (or representative) latency in milliseconds. Lower is better. */
  avgLatencyMs?: number | null;
  /** Success rate, 0–100 (%). Higher is better. */
  successRatePct?: number | null;
  /** Process/service uptime in seconds. More is better (saturates after a day). */
  uptimeSeconds?: number | null;
}

export type HealthGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'critical' | 'unknown';

export interface HealthScoreReport {
  /** Composite health 0–100, or null when no signal is known. */
  health: number | null;
  /** Reliability sub-score 0–100 (success + errors), or null. */
  reliability: number | null;
  /** Risk 0–100 (inverse of health: higher = more risk), or null. */
  risk: number | null;
  grade: HealthGrade;
  /** Per-component 0–100 sub-scores actually used (only the known ones). */
  components: Partial<Record<'errors' | 'latency' | 'success' | 'uptime', number>>;
  /** Which signals were missing — surfaced so the UI can show an honest gap, not a guess. */
  missing: Array<'errors' | 'latency' | 'success' | 'uptime'>;
}

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** errorRate 0% → 100, ≥25% → 0 (linear). */
export function scoreErrors(errorRatePct: number): number {
  return clamp(100 - (errorRatePct / 25) * 100);
}

/** ≤100ms → 100, ≥2000ms → 0 (linear between). */
export function scoreLatency(avgLatencyMs: number): number {
  if (avgLatencyMs <= 100) return 100;
  if (avgLatencyMs >= 2000) return 0;
  return clamp(100 - ((avgLatencyMs - 100) / (2000 - 100)) * 100);
}

/** successRate maps straight through (already 0–100). */
export function scoreSuccess(successRatePct: number): number {
  return clamp(successRatePct);
}

/** Uptime saturates: 0s → 0, ≥1 day → 100 (a freshly-restarted service scores low, honestly). */
export function scoreUptime(uptimeSeconds: number): number {
  const DAY = 86_400;
  if (uptimeSeconds <= 0) return 0;
  if (uptimeSeconds >= DAY) return 100;
  return clamp((uptimeSeconds / DAY) * 100);
}

// Component weights for the composite. Reliability signals (errors/success) dominate.
const WEIGHTS: Record<'errors' | 'latency' | 'success' | 'uptime', number> = {
  errors: 0.30,
  success: 0.30,
  latency: 0.25,
  uptime: 0.15,
};

function gradeFor(health: number | null): HealthGrade {
  if (health == null) return 'unknown';
  if (health >= 90) return 'excellent';
  if (health >= 75) return 'good';
  if (health >= 55) return 'fair';
  if (health >= 35) return 'poor';
  return 'critical';
}

/** Weighted average over only the present components (re-normalised), or null if none. */
function weightedAverage(parts: Array<{ key: keyof typeof WEIGHTS; value: number }>): number | null {
  if (parts.length === 0) return null;
  let sumW = 0;
  let sum = 0;
  for (const p of parts) {
    const w = WEIGHTS[p.key];
    sum += p.value * w;
    sumW += w;
  }
  return sumW === 0 ? null : Math.round((sum / sumW) * 10) / 10;
}

/** Compute the composite health/reliability/risk report from whatever real signals exist. */
export function computeHealthScore(inputs: HealthInputs): HealthScoreReport {
  const components: HealthScoreReport['components'] = {};
  const missing: HealthScoreReport['missing'] = [];

  if (isNum(inputs.errorRatePct)) components.errors = Math.round(scoreErrors(inputs.errorRatePct) * 10) / 10;
  else missing.push('errors');
  if (isNum(inputs.avgLatencyMs)) components.latency = Math.round(scoreLatency(inputs.avgLatencyMs) * 10) / 10;
  else missing.push('latency');
  if (isNum(inputs.successRatePct)) components.success = Math.round(scoreSuccess(inputs.successRatePct) * 10) / 10;
  else missing.push('success');
  if (isNum(inputs.uptimeSeconds)) components.uptime = Math.round(scoreUptime(inputs.uptimeSeconds) * 10) / 10;
  else missing.push('uptime');

  const present: Array<{ key: keyof typeof WEIGHTS; value: number }> = [];
  if (components.errors != null) present.push({ key: 'errors', value: components.errors });
  if (components.latency != null) present.push({ key: 'latency', value: components.latency });
  if (components.success != null) present.push({ key: 'success', value: components.success });
  if (components.uptime != null) present.push({ key: 'uptime', value: components.uptime });

  const health = weightedAverage(present);

  // Reliability = the success/error pair only (the "is it correct" axis), re-normalised.
  const relParts = present.filter((p) => p.key === 'errors' || p.key === 'success');
  const reliability = weightedAverage(relParts);

  return {
    health,
    reliability,
    risk: health == null ? null : Math.round((100 - health) * 10) / 10,
    grade: gradeFor(health),
    components,
    missing,
  };
}

/**
 * The platform's health INPUTS, built in one place for both admin routes that show a health score.
 *
 * 🔴 WHY (admin Monitor capture, 2026-09-27): "Platform health — critical · Health 0 · Reliability 0 ·
 * Risk 100" on a platform whose servers were "keeping up comfortably". Both admin routes built the
 * inputs by hand, identically, from the per-PROVIDER counters — and both halves were the wrong
 * measurement:
 *   • ERRORS counted every ladder rung that failed. The free leader is rate-limited, the next rung
 *     answers, the user gets a reply — one success and one "error". This is the exact mistake the AI
 *     load tile was corrected for on 2026-09-18 (see `recordRouterOutcome`); its sibling here was never
 *     hunted. The honest question is per REQUEST: did the person get an answer?
 *   • LATENCY was the model's GENERATION time (3–4 s for an ordinary answer, longer for a long one)
 *     scored on a web-request scale where 2 s is zero. Every healthy AI platform scores 0 on that. How
 *     long a model takes to write is the vendor's pace and the answer's length — not our platform's
 *     health. Our own latency is how long a request waits on OUR server: the event-loop delay the
 *     "Server load" panel already measures.
 * A rate over too few requests is not a measurement — the same `AI_MIN_SAMPLE` the load board uses.
 * PURE.
 */
export function platformHealthInputs(src: {
  builds: { total: number; successRate: number };
  router: { requests: number; failed: number } | null;
  /** Worst-case event-loop wait on this server, ms (serverLoad's p99), or null when not sampled. */
  serverWaitMs: number | null;
  minRequests: number;
}): Required<HealthInputs> {
  const req = src.router ? Number(src.router.requests) || 0 : 0;
  const failed = src.router ? Number(src.router.failed) || 0 : 0;
  return {
    successRatePct: src.builds.total > 0 ? src.builds.successRate * 100 : null,
    errorRatePct: req >= Math.max(1, src.minRequests) ? (failed / req) * 100 : null,
    avgLatencyMs: isNum(src.serverWaitMs) ? src.serverWaitMs : null,
    // Process age is deploy recency, not uptime, on a host that deploys on every merge (2026-09-12).
    uptimeSeconds: null,
  };
}
