// P-ARCH+.1 — complexity-adaptive pipeline depth.
//
// The admin's guiding principle (2026-07-02): simple apps must stay FAST (fast generation is the
// feature), while genuinely complex apps get more room so a large full-stack build isn't cut off
// mid-work. This module turns a prompt-derived complexity signal into a `depth`, and scales the build
// wall-clock cap by it.
//
// SAFETY BY DESIGN: the scale ONLY ADDS headroom for `deep` builds — `fast` and `standard` are never
// reduced. The wall-clock cap is a MAX (a build stops the moment it is DONE), so lowering it could only
// ever cut a build short; raising it only helps a build that genuinely needs the time. A hard ceiling
// bounds a runaway. `0` (watchdog disabled) is always preserved. All pure + unit-tested.

export type PipelineDepth = 'fast' | 'standard' | 'deep';

/** Absolute ceiling for the scaled wall-clock cap (seconds) — a hung deep build can't hold a slot forever. */
export const MAX_SCALED_BUILD_SECONDS = 3600;

/** How much extra wall-clock a `deep` build earns over the base cap. */
export const DEEP_TIME_FACTOR = 1.5;

/**
 * Resolve the pipeline depth from a prompt-derived complexity MAGNITUDE (e.g. moduleCount + featureCount
 * from complexityFromPrompt) and whether power/Only-Opus mode is on. Power mode always earns `deep`
 * (the user explicitly asked for the strongest build). Pure.
 *
 * Thresholds are deliberately conservative so only genuinely complex prompts reach `deep`:
 *   magnitude ≤ 4  → fast      (a small single-purpose app)
 *   magnitude ≥ 12 → deep      (many modules/features — auth + db + several pages, etc.)
 *   otherwise      → standard
 */
export function resolvePipelineDepth(magnitude: number, powerMode = false): PipelineDepth {
  if (powerMode) return 'deep';
  const m = Number.isFinite(magnitude) ? magnitude : 6; // unknown → middle (standard)
  if (m <= 4) return 'fast';
  if (m >= 12) return 'deep';
  return 'standard';
}

/**
 * Scale the base wall-clock cap by depth. ONLY `deep` gets more time; `fast`/`standard` are unchanged
 * (never reduced — see the safety note above). `0`/negative (disabled) is returned as-is. Bounded by
 * MAX_SCALED_BUILD_SECONDS. Pure.
 */
export function scaleBuildSeconds(baseSeconds: number, depth: PipelineDepth): number {
  if (!(baseSeconds > 0)) return baseSeconds; // 0 = disabled (or invalid) → preserve exactly
  const factor = depth === 'deep' ? DEEP_TIME_FACTOR : 1;
  return Math.min(Math.round(baseSeconds * factor), MAX_SCALED_BUILD_SECONDS);
}
