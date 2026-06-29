import { describe, it, expect } from 'vitest';
import {
  complexityScore, heuristicEstimateMs, formatEta, estimateBuildTime, predictDeadline,
  type HistoricalBuild,
} from './BuildTimeEstimator';

describe('BuildTimeEstimator (P-PME.4)', () => {
  describe('complexityScore + heuristic', () => {
    it('grows with modules and features', () => {
      expect(complexityScore({ moduleCount: 5, featureCount: 10 })).toBeGreaterThan(
        complexityScore({ moduleCount: 1, featureCount: 2 }),
      );
    });
    it('a bigger app estimates a longer build', () => {
      const small = heuristicEstimateMs({ moduleCount: 1, featureCount: 2 });
      const big = heuristicEstimateMs({ moduleCount: 8, featureCount: 20 });
      expect(big).toBeGreaterThan(small);
      expect(small).toBeGreaterThan(10_000); // at least the base
    });
  });

  describe('formatEta', () => {
    it('formats seconds and minutes', () => {
      expect(formatEta(45_000)).toBe('~45s');
      expect(formatEta(120_000)).toBe('~2 min');
      expect(formatEta(0)).toBe('~0s');
    });
  });

  describe('estimateBuildTime', () => {
    it('HONESTY: no history → heuristic basis with modest confidence + a real range', () => {
      const e = estimateBuildTime({ moduleCount: 3, featureCount: 6 });
      expect(e.basis).toBe('heuristic');
      expect(e.confidence).toBeLessThan(0.5);
      expect(e.lowMs).toBeLessThan(e.estimateMs);
      expect(e.highMs).toBeGreaterThan(e.estimateMs);
      expect(e.etaText).toMatch(/~\d+/);
    });

    it('leans on history when many close matches exist', () => {
      const target = { moduleCount: 4, featureCount: 8 };
      const history: HistoricalBuild[] = Array.from({ length: 6 }, () => ({ complexity: target, durationMs: 90_000 }));
      const e = estimateBuildTime(target, history);
      expect(['historical', 'blended']).toContain(e.basis);
      expect(e.confidence).toBeGreaterThan(0.5);
      // estimate pulled toward the observed 90s
      expect(e.estimateMs).toBeGreaterThan(60_000);
      expect(e.estimateMs).toBeLessThan(120_000);
    });

    it('weights closer-complexity history more than distant outliers', () => {
      const target = { moduleCount: 2, featureCount: 3 };
      const history: HistoricalBuild[] = [
        { complexity: { moduleCount: 2, featureCount: 3 }, durationMs: 40_000 },   // close
        { complexity: { moduleCount: 20, featureCount: 50 }, durationMs: 600_000 }, // far outlier
      ];
      const e = estimateBuildTime(target, history);
      // The close 40s match should dominate over the distant 10-min outlier.
      expect(e.estimateMs).toBeLessThan(200_000);
    });

    it('ignores invalid historical durations', () => {
      const e = estimateBuildTime({ moduleCount: 2, featureCount: 2 }, [
        { complexity: { moduleCount: 2, featureCount: 2 }, durationMs: 0 },
        { complexity: { moduleCount: 2, featureCount: 2 }, durationMs: -5 },
      ]);
      expect(e.basis).toBe('heuristic'); // no usable history
    });
  });

  describe('predictDeadline', () => {
    it('adds the estimate to the supplied start time (never reads the clock)', () => {
      const { finishMs, etaText } = predictDeadline(120_000, 1_000_000);
      expect(finishMs).toBe(1_120_000);
      expect(etaText).toBe('~2 min');
    });
  });
});
