// P-TQA.6 — Quality Gate (configurable threshold + honest reporting).
//
// DeploymentValidator already blocks a generated-app deploy when its quality score is too low, but the
// threshold was hardcoded (0.8) and there was no standalone gate for CI. These PURE helpers make the
// threshold configurable via `QUALITY_GATE_THRESHOLD` and produce an honest, human-readable gate line —
// reused by both DeploymentValidator and the `scripts/quality-gate.ts` CLI. Pure → unit-tested.

/** Default gate: a build must score ≥ 0.8 (80/100) to pass. */
export const DEFAULT_QUALITY_THRESHOLD = 0.8;

/**
 * Parse a threshold from an env value into a 0..1 fraction. Accepts BOTH a fraction ("0.7") and a
 * percentage ("70"): any value > 1 is treated as a percent and divided by 100. Out-of-range / junk →
 * the default. Pure.
 */
export function parseQualityThreshold(raw: string | undefined | null, def: number = DEFAULT_QUALITY_THRESHOLD): number {
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  const frac = n > 1 ? n / 100 : n;
  if (frac < 0 || frac > 1) return def;
  return frac;
}

/** The active threshold from the environment (0..1). */
export function qualityThreshold(env: NodeJS.ProcessEnv = process.env): number {
  return parseQualityThreshold(env.QUALITY_GATE_THRESHOLD);
}

/** Does this 0..1 score pass the gate? Pure. */
export function passesQualityGate(score: number, threshold: number): boolean {
  return typeof score === 'number' && Number.isFinite(score) && score >= threshold;
}

/** Honest one-line gate result for a PR check / CLI, e.g. "Quality Gate: 74/100 ✅ (threshold 70)". Pure. */
export function formatGateLine(score: number, threshold: number): string {
  const pct = Math.round((Number.isFinite(score) ? score : 0) * 100);
  const thr = Math.round(threshold * 100);
  return `Quality Gate: ${pct}/100 ${passesQualityGate(score, threshold) ? '✅' : '❌'} (threshold ${thr})`;
}
