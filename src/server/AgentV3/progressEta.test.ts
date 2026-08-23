import { describe, it, expect } from 'vitest';
import {
  observedPerFileMs,
  measuredRemainingMs,
  measuredEtaText,
  firstEtaLine,
  formatEtaRange,
  MIN_FILES_FOR_MEASUREMENT,
  FINISH_ALLOWANCE_MS,
} from './progressEta';
import { complexityFromPrompt, estimateBuildTime } from '../lib/BuildTimeEstimator';

/** A plausible wall-clock base. `firstFileAt: 0` means "no file yet" in production, so 0 is not a
 * usable timestamp and the module is right to reject it — the tests must not depend on that. */
const T0 = 1_770_000_000_000;

describe('progressEta — the regression that started this', () => {
  it('reproduces the reported defect: "Make an VPN App" scores the floor and estimates ~3 min', () => {
    // This is the bug, encoded. The prompt has no page-words and no feature-words, so the prompt-based
    // estimator returns its minimum — which is how an 18-minute build promised three.
    const c = complexityFromPrompt('Make an VPN App');
    expect(c.moduleCount).toBe(1);
    expect(c.featureCount).toBe(1);
    const est = estimateBuildTime(c);
    expect(est.etaText).toBe('~3 min');
    expect(est.confidence).toBe(0.4);
  });

  it('measurement reaches the right order of magnitude where the prompt estimate could not', () => {
    // Same build, but now measured: 19 planned files, 5 written, ~50s each. The prompt said 3 minutes;
    // the measurement says roughly a quarter of an hour, without knowing anything about VPNs.
    const remaining = measuredRemainingMs({ plannedFiles: 19, filesDone: 5, firstFileAt: 1_000_000, now: 1_000_000 + 4 * 50_000 });
    expect(remaining).not.toBeNull();
    expect(remaining! / 60_000).toBeGreaterThan(11);
  });
});

describe('observedPerFileMs', () => {
  it('divides by the intervals that actually elapsed, not by the file count', () => {
    // 3 files, first at t=0, now t=20s → TWO intervals of 10s, not three of 6.7s. Dividing by the file
    // count would under-estimate every remaining file — the same optimistic direction as the bug.
    expect(observedPerFileMs({ plannedFiles: 10, filesDone: 3, firstFileAt: T0, now: T0 + 20_000 })).toBe(10_000);
  });

  it('refuses to average fewer than the minimum sample', () => {
    for (let done = 0; done < MIN_FILES_FOR_MEASUREMENT; done++) {
      expect(observedPerFileMs({ plannedFiles: 10, filesDone: done, firstFileAt: T0, now: T0 + 60_000 })).toBeNull();
    }
    expect(observedPerFileMs({ plannedFiles: 10, filesDone: MIN_FILES_FOR_MEASUREMENT, firstFileAt: T0, now: T0 + 60_000 })).not.toBeNull();
  });

  it('returns null rather than a number for unusable inputs', () => {
    expect(observedPerFileMs({ plannedFiles: 10, filesDone: 5, firstFileAt: T0, now: T0 })).toBeNull();
    expect(observedPerFileMs({ plannedFiles: 10, filesDone: 5, firstFileAt: T0 + 5_000, now: T0 + 4_000 })).toBeNull(); // clock went backwards
    expect(observedPerFileMs({ plannedFiles: 10, filesDone: NaN, firstFileAt: T0, now: T0 + 60_000 })).toBeNull();
  });
});

describe('measuredRemainingMs', () => {
  it('extrapolates the remaining files and adds the finishing allowance', () => {
    // 10 planned, 5 done, 10s each → 5 files left = 50s, plus the tail allowance.
    const ms = measuredRemainingMs({ plannedFiles: 10, filesDone: 5, firstFileAt: T0, now: T0 + 40_000 });
    expect(ms).toBe(5 * 10_000 + FINISH_ALLOWANCE_MS);
  });

  it('returns null once every planned file is written — a repair loop is not measurable', () => {
    // THE HONESTY RULE. Past the last planned file the build is verifying or repairing, and this module
    // has no evidence about that. Returning 0 (or any number) here is what would produce a sixth
    // confident wrong promise; null hands the line back to the honest fallback.
    expect(measuredRemainingMs({ plannedFiles: 10, filesDone: 10, firstFileAt: T0, now: T0 + 90_000 })).toBeNull();
    expect(measuredRemainingMs({ plannedFiles: 10, filesDone: 14, firstFileAt: T0, now: T0 + 90_000 })).toBeNull();
  });

  it('returns null when no plan is known', () => {
    expect(measuredRemainingMs({ plannedFiles: 0, filesDone: 5, firstFileAt: T0, now: T0 + 40_000 })).toBeNull();
    expect(measuredRemainingMs({ plannedFiles: NaN, filesDone: 5, firstFileAt: T0, now: T0 + 40_000 })).toBeNull();
  });

  it('tracks a chain that gets SLOWER, which a fixed constant cannot', () => {
    const fast = measuredRemainingMs({ plannedFiles: 20, filesDone: 5, firstFileAt: T0, now: T0 + 4 * 8_000 })!;
    const slow = measuredRemainingMs({ plannedFiles: 20, filesDone: 5, firstFileAt: T0, now: T0 + 4 * 40_000 })!;
    // The EXTRAPOLATED part scales exactly with the observed speed; the finishing allowance is a
    // constant and deliberately does not, so compare the part that is actually a measurement.
    expect(slow - FINISH_ALLOWANCE_MS).toBe((fast - FINISH_ALLOWANCE_MS) * 5);
    expect(slow).toBeGreaterThan(fast * 3);
  });
});

describe('measuredEtaText', () => {
  it('names the countable evidence, not just a promise', () => {
    const text = measuredEtaText(120_000, 240_000, 12, 19);
    expect(text).toContain('12 of 19 files');
    expect(text).toContain('2 min in');
    expect(text).toContain('4 min to go');
  });
});

describe('firstEtaLine', () => {
  const est = { estimateMs: 173_000, lowMs: 121_000, highMs: 256_000, confidence: 0.4 };

  it('shows the band the estimator computed instead of the point it also computed', () => {
    // The specific dishonesty being removed: confidence 0.4 means ±60%, and the UI used to print a
    // single "~3 min" as if it were a fact.
    const line = firstEtaLine(est, 0);
    expect(line).toContain('~2–4 min');
    expect(line).not.toMatch(/Estimated build time: ~3 min\b/);
  });

  it('a first build says the number will be replaced', () => {
    expect(firstEtaLine(est, 0)).toContain('first guess');
  });

  it('with history it says how many builds it learned from and drops the disclaimer', () => {
    const line = firstEtaLine(est, 4);
    expect(line).toContain('last 4 builds');
    expect(line).not.toContain('first guess');
  });

  it('says "build" not "builds" for a single one', () => {
    expect(firstEtaLine(est, 1)).toContain('last 1 build.');
  });
});

describe('formatEtaRange', () => {
  it('collapses a band whose ends render identically', () => {
    expect(formatEtaRange(119_000, 121_000, 120_000)).toBe('~2 min');
  });

  it('shares the unit across the band', () => {
    expect(formatEtaRange(120_000, 300_000, 180_000)).toBe('~2–5 min');
  });

  it('keeps both units when they differ', () => {
    expect(formatEtaRange(30_000, 180_000, 90_000)).toBe('~30s–3 min');
  });

  it('falls back to the point estimate on an unusable band', () => {
    expect(formatEtaRange(0, 0, 173_000)).toBe('~3 min');
    expect(formatEtaRange(200_000, 100_000, 173_000)).toBe('~3 min');
  });
});
