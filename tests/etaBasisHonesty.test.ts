/**
 * Autopsy f04421ef, part 5 — the ADMIN's report must not be less honest than the user's screen.
 *
 * The report's ETA_BASIS line read `ETA ~3 min · basis heuristic · confidence 0.4` for a build that ran
 * past twenty minutes, and I read it as "the user was promised three minutes". They were not:
 * `firstEtaLine` already shows the BAND and says outright that the figure is a first guess. The point
 * estimate was an internal number that only the admin's report ever displayed as if it were the promise.
 *
 * My own autopsy claim — "the ETA promises a number it does not have, and no user-facing line consults
 * the confidence" — was WRONG, and these tests pin the thing that is actually true instead.
 */
import { describe, it, expect } from 'vitest';
import { firstEtaLine, formatEtaRange } from '../src/server/AgentV3/progressEta';
import { estimateBuildTime, complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';

describe('the user-facing first line already consults the confidence', () => {
  it('a no-history estimate is shown as a BAND, not as the midpoint', () => {
    const est = estimateBuildTime(complexityFromPrompt('Make an VPN App'), []);
    expect(est.confidence).toBe(0.4);
    const line = firstEtaLine(est, 0);
    // The band the low confidence produces must actually reach the user.
    expect(line).toContain(formatEtaRange(est.lowMs, est.highMs, est.estimateMs));
    // …and a low-confidence band is genuinely wider than a point.
    expect(est.highMs).toBeGreaterThan(est.lowMs);
  });

  it('a first build says outright that the figure will be replaced', () => {
    const est = estimateBuildTime(complexityFromPrompt('Make an VPN App'), []);
    expect(firstEtaLine(est, 0)).toMatch(/first guess/i);
  });

  it('higher confidence narrows what the user is shown', () => {
    const c = complexityFromPrompt('Make a notes app with 3 pages');
    const cold = estimateBuildTime(c, []);
    const warm = estimateBuildTime(c, [
      { complexity: c, durationMs: 6 * 60_000 },
      { complexity: c, durationMs: 7 * 60_000 },
      { complexity: c, durationMs: 6.5 * 60_000 },
    ] as never);
    expect(warm.confidence).toBeGreaterThan(cold.confidence);
    expect(warm.highMs - warm.lowMs).toBeLessThan(cold.highMs - cold.lowMs);
  });
});

describe('formatEtaRange', () => {
  it('collapses a band whose ends round to the same figure — "2–2 min" is noise', () => {
    expect(formatEtaRange(120_000, 125_000, 122_000)).not.toMatch(/–/);
  });

  it('falls back to the point estimate when the band is unusable', () => {
    expect(formatEtaRange(0, 0, 180_000)).toBe(formatEtaRange(0, 0, 180_000));
    expect(formatEtaRange(Number.NaN, 5, 180_000)).toMatch(/min/);
    // A backwards band is not silently rendered as a range.
    expect(formatEtaRange(600_000, 60_000, 180_000)).not.toMatch(/–/);
  });
});
