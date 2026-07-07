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
 * from complexityFromPrompt), whether power/Only-Opus mode is on, and whether this is an edit of a LARGE
 * existing project. Power mode always earns `deep` (the user explicitly asked for the strongest build).
 * Pure.
 *
 * RC-2 (admin 2026-07-06) — `largeExistingProject` also forces `deep`: an EDIT prompt ("retry", "fix the
 * navbar") is SHORT, so prompt-magnitude alone undersizes the wall-clock budget for a big imported app —
 * but restoring the project + installing deps + working across a large codebase genuinely needs the
 * time. Without this, a ~1650-file import got the SAME base cap as a 15-file app and paused at the limit.
 *
 * Thresholds are deliberately conservative so only genuinely complex prompts reach `deep`:
 *   magnitude ≤ 4  → fast      (a small single-purpose app)
 *   magnitude ≥ 12 → deep      (many modules/features — auth + db + several pages, etc.)
 *   otherwise      → standard
 */
export function resolvePipelineDepth(magnitude: number, powerMode = false, largeExistingProject = false): PipelineDepth {
  if (powerMode || largeExistingProject) return 'deep';
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

/**
 * How long the post-build REVIEWER (completeness check) may run, SCALED to project size and CLAMPED to
 * the wall-clock headroom left. Pure + unit-tested.
 *
 * ROOT CAUSE (build report 2026-07-07 — 40-file Hospital OPD system): the reviewer had a fixed 90s cap.
 * On a large app it read a dozen files + a dozen searches and was killed mid-review, so its verdict was
 * silently lost (empty `review`, no [CRITICAL] captured) — the completeness safety net vanished on
 * exactly the big apps that need it most. So: give bigger apps more time (they have more to check), but
 * NEVER eat into the wall-clock safety margin — a reviewer must never be the reason a finished app
 * times out. `headroomMs` = ms left before the wall-clock cap (Infinity when no cap is configured).
 */
export function reviewerBudgetMs(fileCount: number, headroomMs: number): number {
  const BASE = 90_000, PER_FILE = 4_000, MIN = 45_000, MAX = 210_000, SAFETY = 60_000;
  const files = Number.isFinite(fileCount) && fileCount > 0 ? Math.floor(fileCount) : 0;
  const scaled = Math.min(BASE + Math.max(0, files - 20) * PER_FILE, MAX);
  if (!Number.isFinite(headroomMs)) return scaled;          // no wall-clock cap → the scaled budget
  return Math.max(MIN, Math.min(scaled, headroomMs - SAFETY)); // else leave a 60s wall-clock safety margin
}
