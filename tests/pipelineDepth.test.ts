import { describe, it, expect } from 'vitest';
import {
  resolvePipelineDepth,
  scaleBuildSeconds,
  reviewerBudgetMs,
  MAX_SCALED_BUILD_SECONDS,
  DEEP_TIME_FACTOR,
} from '../src/server/AgentV3/PipelineDepth';

/** P-ARCH+.1 — complexity-adaptive pipeline depth (pure). */

describe('resolvePipelineDepth', () => {
  it('simple prompts (low magnitude) → fast', () => {
    expect(resolvePipelineDepth(1)).toBe('fast');
    expect(resolvePipelineDepth(4)).toBe('fast');
  });
  it('mid magnitude → standard', () => {
    expect(resolvePipelineDepth(5)).toBe('standard');
    expect(resolvePipelineDepth(11)).toBe('standard');
  });
  it('high magnitude → deep', () => {
    expect(resolvePipelineDepth(12)).toBe('deep');
    expect(resolvePipelineDepth(40)).toBe('deep');
  });
  it('power/Only-Opus mode always earns deep, regardless of magnitude', () => {
    expect(resolvePipelineDepth(1, true)).toBe('deep');
    expect(resolvePipelineDepth(40, true)).toBe('deep');
  });
  it('RC-2: a large existing project earns deep even on a tiny edit prompt (magnitude ≤ 4)', () => {
    // The admin case: "retry"/"fix X" on a ~1650-file import → short prompt, but it must get deep time.
    expect(resolvePipelineDepth(1, false, true)).toBe('deep');
    expect(resolvePipelineDepth(0, false, true)).toBe('deep');
    // A small edit on a small project is unchanged (not large → prompt-magnitude decides).
    expect(resolvePipelineDepth(1, false, false)).toBe('fast');
  });
  it('a non-finite magnitude falls back to standard (middle)', () => {
    expect(resolvePipelineDepth(NaN)).toBe('standard');
    expect(resolvePipelineDepth(Infinity)).toBe('standard');
  });
});

describe('scaleBuildSeconds', () => {
  it('only DEEP earns more time; fast/standard are unchanged (never reduced)', () => {
    expect(scaleBuildSeconds(1800, 'fast')).toBe(1800);
    expect(scaleBuildSeconds(1800, 'standard')).toBe(1800);
    expect(scaleBuildSeconds(1800, 'deep')).toBe(Math.round(1800 * DEEP_TIME_FACTOR)); // 2700
  });
  it('preserves 0 (watchdog disabled) exactly for every depth', () => {
    expect(scaleBuildSeconds(0, 'deep')).toBe(0);
    expect(scaleBuildSeconds(0, 'fast')).toBe(0);
  });
  it('bounds a deep build to the absolute ceiling', () => {
    expect(scaleBuildSeconds(3000, 'deep')).toBe(MAX_SCALED_BUILD_SECONDS); // 3000*1.5=4500 → capped 3600
    expect(scaleBuildSeconds(MAX_SCALED_BUILD_SECONDS, 'standard')).toBe(MAX_SCALED_BUILD_SECONDS);
  });
  it('treats negative/invalid base as disabled (returns as-is)', () => {
    expect(scaleBuildSeconds(-5, 'deep')).toBe(-5);
  });
});

describe('reviewerBudgetMs — the completeness reviewer scales with app size, clamped to wall-clock headroom', () => {
  it('a small app keeps the ~90s base (no wall-clock cap)', () => {
    expect(reviewerBudgetMs(8, Infinity)).toBe(90_000);
    expect(reviewerBudgetMs(20, Infinity)).toBe(90_000);
  });

  it('a large app gets MORE time (the 40-file Hospital OPD case that was killed at 90s)', () => {
    // 40 files → 90s + (40-20)*4s = 170s. The fixed 90s cap lost this app's completeness verdict.
    expect(reviewerBudgetMs(40, Infinity)).toBe(170_000);
  });

  it('never exceeds the hard MAX even for a huge app', () => {
    expect(reviewerBudgetMs(500, Infinity)).toBe(210_000);
  });

  it('never eats the wall-clock safety margin — clamps to headroom minus 60s', () => {
    // 40 files wants 170s, but only 120s of headroom is left → 120s - 60s safety = 60s.
    expect(reviewerBudgetMs(40, 120_000)).toBe(60_000);
  });

  it('honours a hard floor so the reviewer is never given an unusably tiny budget', () => {
    expect(reviewerBudgetMs(40, 70_000)).toBe(45_000); // 70s-60s=10s → floored to 45s
    expect(reviewerBudgetMs(40, 0)).toBe(45_000);
  });

  it('tolerates junk file counts', () => {
    expect(reviewerBudgetMs(0, Infinity)).toBe(90_000);
    expect(reviewerBudgetMs(-3, Infinity)).toBe(90_000);
    expect(reviewerBudgetMs(NaN, Infinity)).toBe(90_000);
  });
});

// MITRIFY AUTOPSY 2026-08-04: "Post-build review timed out after 90000ms on 9 files" — on an app with
// 608 files. The budget scaled with the files HANDED to the reviewer; the work scales with the app it
// has to UNDERSTAND. On an edit to a large existing project those diverge (9 vs 608), so the review
// was killed and the user was told to re-run it by hand — the completeness safety net vanishing on
// exactly the apps that need it most.
describe('reviewerBudgetMs — the budget follows the APP being understood, not just the files handed over', () => {
  it('the reported case: 9 files inside a 608-file app gets far more than the old 90s', () => {
    const before = 90_000;
    const now = reviewerBudgetMs(9, Infinity, 608);
    expect(now).toBeGreaterThan(before);
    expect(now).toBeGreaterThanOrEqual(180_000);
  });

  it('a small app is unchanged — 9 files in a 9-file project still gets the base budget', () => {
    expect(reviewerBudgetMs(9, Infinity, 9)).toBe(90_000);
  });

  it('back-compatible: omitting the project size behaves exactly as before', () => {
    expect(reviewerBudgetMs(8, Infinity)).toBe(reviewerBudgetMs(8, Infinity, 0));
    expect(reviewerBudgetMs(40, Infinity)).toBe(reviewerBudgetMs(40, Infinity, 0));
  });

  it('still clamped to the ceiling — a giant app cannot run the reviewer forever', () => {
    expect(reviewerBudgetMs(9, Infinity, 100_000)).toBeLessThanOrEqual(210_000);
  });

  it('still clamped to wall-clock headroom — a big project cannot spend the safety margin', () => {
    // The contract is max(MIN, min(scaled, headroom - SAFETY)): the headroom clamp bites, and the
    // 45s floor deliberately wins when headroom is already tighter than the floor (a reviewer that
    // gets less than 45s is worthless, and the wall-clock cap has its own separate guard).
    // 608 project files → scaled = 90s base + (608-50)×200ms = 201.6s (under the 210s ceiling).
    expect(reviewerBudgetMs(9, Infinity, 608)).toBe(201_600);
    // Ample headroom (300s − 60s safety = 240s) → the scaled budget still wins.
    expect(reviewerBudgetMs(9, 300_000, 608)).toBe(201_600);
    // Tight headroom (150s − 60s = 90s) → the headroom clamp bites.
    expect(reviewerBudgetMs(9, 150_000, 608)).toBe(90_000);
    expect(reviewerBudgetMs(9, 30_000, 608)).toBe(45_000);     // never below the floor
  });

  it('junk project counts never throw or produce NaN', () => {
    for (const n of [NaN, -5, Infinity]) {
      const v = reviewerBudgetMs(9, Infinity, n as number);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});
