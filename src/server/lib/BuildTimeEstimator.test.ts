import { describe, it, expect } from 'vitest';
import {
  complexityScore, heuristicEstimateMs, formatEta, estimateBuildTime, predictDeadline,
  complexityFromPrompt,
  type HistoricalBuild,
} from './BuildTimeEstimator';
import { resolvePipelineDepth } from '../AgentV3/PipelineDepth';

describe('BuildTimeEstimator (P-PME.4)', () => {
  describe('complexityFromPrompt', () => {
    it('scales with described pages + features, clamped to sane bounds', () => {
      const simple = complexityFromPrompt('a todo app');
      const rich = complexityFromPrompt('an app with a dashboard page, a profile screen, auth, search, charts and payment');
      expect(rich.moduleCount).toBeGreaterThan(simple.moduleCount);
      expect(rich.featureCount).toBeGreaterThan(simple.featureCount);
      expect(simple.moduleCount).toBeGreaterThanOrEqual(1);
      expect(simple.featureCount).toBeGreaterThanOrEqual(1);
    });
    it('clamps an absurdly long prompt', () => {
      const c = complexityFromPrompt('page '.repeat(500) + 'and '.repeat(500));
      expect(c.moduleCount).toBeLessThanOrEqual(20);
      expect(c.featureCount).toBeLessThanOrEqual(30);
    });
    it('handles empty input', () => {
      const c = complexityFromPrompt('');
      expect(c.moduleCount).toBe(1);
      expect(c.featureCount).toBe(1);
    });
    it('floors a NAMED complex-app category into the DEEP lane even with no page/feature words', () => {
      // The bug: a short prompt like "build a SaaS CRM" scored magnitude 2 → the `fast` lane and a
      // wildly optimistic ETA, while the request analyser already called it complex_app. Now the
      // magnitude (moduleCount + featureCount) must reach the deep threshold (≥ 12).
      for (const p of ['build a SaaS CRM', 'make an e-commerce store', 'a food delivery app', 'build a social network', 'full-stack booking system']) {
        const c = complexityFromPrompt(p);
        expect(c.moduleCount + c.featureCount).toBeGreaterThanOrEqual(12);
        expect(resolvePipelineDepth(c.moduleCount + c.featureCount)).toBe('deep');
      }
    });
    it('leaves a genuinely simple app in the FAST lane (the admin\'s "simple stays fast" rule)', () => {
      for (const p of ['a todo app', 'a calculator', 'a stopwatch', 'a dice roller']) {
        const c = complexityFromPrompt(p);
        expect(c.moduleCount + c.featureCount).toBeLessThanOrEqual(4);
        expect(resolvePipelineDepth(c.moduleCount + c.featureCount)).toBe('fast');
      }
    });
  });
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
    it('CALIBRATION: a simple build estimates in the HONEST minutes band — neither ~25s nor ~28 min', () => {
      // Regression guard for BOTH failure modes seen on real runs: the oldest constants said "~25s"
      // for a build that took minutes (20× low); the next said "~8–12 min"/"~28 min" for Todo/Notes
      // builds that really took ~3.7–4.0 min (~7× high). The honest band is a few minutes.
      const simple = estimateBuildTime(complexityFromPrompt('a todo app'));
      expect(simple.estimateMs).toBeGreaterThan(90_000);       // > 1.5 min — never the "~25s" lie
      expect(simple.estimateMs).toBeLessThan(10 * 60_000);     // < 10 min — never the "~28 min" over-shoot
      expect(simple.etaText).toMatch(/min/);
      const complex = estimateBuildTime(complexityFromPrompt('a dashboard page with auth, charts, profile screen, search and payment'));
      expect(complex.estimateMs).toBeGreaterThan(simple.estimateMs);
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
      // The close 40s match should dominate over the distant 10-min outlier (the estimate stays well
      // below the 600s outlier rather than being dragged toward it).
      expect(e.estimateMs).toBeLessThan(500_000);
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
