import { describe, it, expect } from 'vitest';
import {
  complexityScore, heuristicEstimateMs, formatEta, estimateBuildTime, predictDeadline,
  complexityFromPrompt, liveEtaTick,
  type HistoricalBuild,
} from './BuildTimeEstimator';
import { resolvePipelineDepth, scaleBuildSeconds, DEEP_TIME_FACTOR } from '../AgentV3/PipelineDepth';

describe('scaleBuildSeconds — a deep full-stack app gets a 60-min window (admin "2 window banao")', () => {
  it('deep window is 60 min so TWO windows (120 min) finish a complex app', () => {
    expect(DEEP_TIME_FACTOR).toBe(2.0);
    expect(scaleBuildSeconds(1800, 'deep')).toBe(3600); // 60 min (== MAX_SCALED_BUILD_SECONDS)
  });
  it('fast/standard windows are unchanged (simple apps stay fast)', () => {
    expect(scaleBuildSeconds(1800, 'fast')).toBe(1800);
    expect(scaleBuildSeconds(1800, 'standard')).toBe(1800);
  });
});

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

describe('liveEtaTick — the overrun line must keep MOVING (autopsy 2026-08-02: "wrapping up" x12 over 22 min)', () => {
  const MIN = 60_000;

  it('inside the estimate it counts down normally and never re-baselines', () => {
    const t = liveEtaTick(2 * MIN, 8 * MIN, 8 * MIN);
    expect(t.revised).toBe(false);
    expect(t.totalMs).toBe(8 * MIN);
    expect(t.text).toContain('2 min in');
    expect(t.text).toContain('6 min to go');
  });

  it('THE REAL FAILURE: an 8-min estimate running 30 min never repeats one frozen line', () => {
    // Replay the exact reported build: estimate ~8 min, ticks every 2 min out to minute 30.
    const base = 8 * MIN;
    let total = base;
    const lines: string[] = [];
    for (let m = 2; m <= 30; m += 2) {
      const t = liveEtaTick(m * MIN, total, base);
      total = t.totalMs;
      lines.push(t.text);
    }
    // Before the fix EVERY line from minute 8 on was byte-identical ("wrapping up (a little longer…)").
    const overrun = lines.slice(3); // minute 8 onward
    expect(overrun.length).toBeGreaterThan(8);
    expect(new Set(overrun).size).toBe(overrun.length); // every line distinct — the number keeps moving
    expect(lines.join(' ')).not.toContain('wrapping up');
    // And it stays honest about WHY it is longer.
    expect(overrun[0]).toContain('bigger than expected');
  });

  it('on overrun it extends the budget, and the NEXT tick no longer promises a countdown', () => {
    const base = 8 * MIN;
    const first = liveEtaTick(9 * MIN, base, base);      // just past the estimate
    expect(first.revised).toBe(true);
    expect(first.totalMs).toBeGreaterThan(9 * MIN);      // budget re-baselined ahead of now
    expect(first.revisions).toBe(1);
    // Threading the revision count is what changed (mitrify 2026-08-04): once an estimate has been
    // broken, the next tick reports elapsed time and honest status — never a fresh "~N min to go".
    const next = liveEtaTick(10 * MIN, first.totalMs, base, first.revisions);
    expect(next.revised).toBe(false);                    // back inside the (new) budget
    expect(next.text).not.toContain('to go');
    expect(next.text).toContain('still working');
  });

  it('the re-baseline step is proportional to the ORIGINAL estimate, clamped to 3-15 min', () => {
    expect(liveEtaTick(60 * MIN, 1 * MIN, 2 * MIN).totalMs - 60 * MIN).toBe(3 * MIN);   // tiny app -> min step
    expect(liveEtaTick(60 * MIN, 1 * MIN, 12 * MIN).totalMs - 60 * MIN).toBe(6 * MIN);  // half of base
    expect(liveEtaTick(60 * MIN, 1 * MIN, 90 * MIN).totalMs - 60 * MIN).toBe(15 * MIN); // huge app -> max step
  });

  it('tolerates junk input without throwing or emitting NaN', () => {
    for (const t of [liveEtaTick(0, 0, 0), liveEtaTick(NaN, NaN, NaN), liveEtaTick(-5, -5, -5)]) {
      expect(typeof t.text).toBe('string');
      expect(t.text).not.toContain('NaN');
      expect(Number.isFinite(t.totalMs)).toBe(true);
    }
  });
});

// MITRIFY AUTOPSY 2026-08-04 — "~1 min to go" FIVE times across a 27-minute build.
// The 2026-08-02 fix made the overrun line keep moving, but it re-baselined by a FIXED 3-minute step,
// so two minutes later the countdown branch cheerfully printed "~1 min to go" again — then overran,
// extended, and promised "~1 min" again. A 2-minute sawtooth of broken promises. The countdown is only
// honest while we still hold an estimate we have not already broken.
describe('liveEtaTick — a broken estimate must stop making fresh promises (mitrify 2026-08-04)', () => {
  const MIN = 60_000;

  /** Replay the real run: ~4 min estimate, a tick every 2 minutes, out to minute 28. */
  function replay(baseMin: number, untilMin: number): string[] {
    const base = baseMin * MIN;
    let total = base;
    let revisions = 0;
    const lines: string[] = [];
    for (let m = 2; m <= untilMin; m += 2) {
      const t = liveEtaTick(m * MIN, total, base, revisions);
      total = t.totalMs;
      revisions = t.revisions;
      lines.push(t.text);
    }
    return lines;
  }

  it('never promises "1 min to go" more than once in a 28-minute build', () => {
    const lines = replay(4, 28);
    const oneMin = lines.filter((l) => /\b1 min to go\b/.test(l));
    expect(oneMin.length).toBeLessThanOrEqual(1); // was 5 in the reported build
  });

  it('stops counting down entirely once the estimate has been broken', () => {
    const lines = replay(4, 28);
    const firstOverrun = lines.findIndex((l) => l.includes('bigger than expected'));
    expect(firstOverrun).toBeGreaterThanOrEqual(0);
    for (const line of lines.slice(firstOverrun + 1)) {
      expect(line).not.toMatch(/~?\d+ (?:min|s) to go/);
    }
  });

  it('after a couple of broken promises it stops naming a number at all, and says so plainly', () => {
    const lines = replay(4, 28);
    const tail = lines[lines.length - 1];
    expect(tail).toMatch(/taking longer than estimated|still working/i);
    expect(tail).toMatch(/\b\d+ min in\b/); // elapsed time — the one number we can stand behind
  });

  it('each successive overrun extends by MORE — a repeated small step IS the sawtooth', () => {
    const base = 8 * MIN;
    const first = liveEtaTick(9 * MIN, base, base, 0);
    const second = liveEtaTick(20 * MIN, 1 * MIN, base, 1);
    const third = liveEtaTick(40 * MIN, 1 * MIN, base, 2);
    expect(second.totalMs - 20 * MIN).toBeGreaterThan(first.totalMs - 9 * MIN);
    expect(third.totalMs - 40 * MIN).toBeGreaterThan(second.totalMs - 20 * MIN);
  });

  it('a build that finishes INSIDE its estimate is untouched — the normal case still counts down', () => {
    const t = liveEtaTick(2 * MIN, 8 * MIN, 8 * MIN, 0);
    expect(t.text).toContain('6 min to go');
    expect(t.revisions).toBe(0);
    expect(t.revised).toBe(false);
  });

  it('junk input still never throws or emits NaN, with revisions carried', () => {
    for (const t of [liveEtaTick(0, 0, 0, 0), liveEtaTick(NaN, NaN, NaN, NaN), liveEtaTick(-5, -5, -5, -9)]) {
      expect(typeof t.text).toBe('string');
      expect(t.text).not.toContain('NaN');
      expect(Number.isFinite(t.revisions)).toBe(true);
      expect(t.revisions).toBeGreaterThanOrEqual(0);
    }
  });
});
