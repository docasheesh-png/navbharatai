import { describe, it, expect } from 'vitest';
import { analyzeBuildOptimizations, DEFAULT_OPTIMIZER_THRESHOLDS } from './AIBuildOptimizer';
import type { BuildAnalytics } from './jobs/BuildAnalytics';

function analytics(partial: Partial<BuildAnalytics> = {}): BuildAnalytics {
  return {
    totalJobs: 20, terminalJobs: 20, successRate: 1, failureRate: 0,
    avgDurationMs: 60_000, p95DurationMs: 90_000, byStatus: {}, topFailureTypes: [],
    ...partial,
  };
}

describe('analyzeBuildOptimizations', () => {
  it('returns nothing below the minimum sample (honest — no over-fitting)', () => {
    expect(analyzeBuildOptimizations(analytics({ terminalJobs: 5, failureRate: 0.8 }))).toEqual([]);
  });

  it('returns nothing for a healthy, fast pipeline', () => {
    expect(analyzeBuildOptimizations(analytics({ failureRate: 0.05, avgDurationMs: 40_000, p95DurationMs: 60_000 }))).toEqual([]);
  });

  it('flags a high failure rate (critical at >=50%)', () => {
    const o = analyzeBuildOptimizations(analytics({ terminalJobs: 20, failureRate: 0.6, successRate: 0.4, topFailureTypes: [{ type: 'x', count: 12 }] }));
    const f = o.find(x => x.id === 'high-failure-rate')!;
    expect(f.severity).toBe('critical');
    expect(o[0].severity).toBe('critical'); // sorted first
  });

  it('flags a dominant failure signature', () => {
    const o = analyzeBuildOptimizations(analytics({
      terminalJobs: 20, failureRate: 0.5, successRate: 0.5,
      topFailureTypes: [{ type: 'missing import X', count: 8 }, { type: 'other', count: 2 }],
    }));
    const d = o.find(x => x.id === 'dominant-failure')!;
    expect(d.detail).toContain('missing import X');
  });

  it('does not flag a dominant failure when failures are spread out', () => {
    const o = analyzeBuildOptimizations(analytics({
      terminalJobs: 20, failureRate: 0.5, successRate: 0.5,
      topFailureTypes: [{ type: 'a', count: 3 }, { type: 'b', count: 3 }, { type: 'c', count: 4 }],
    }));
    expect(o.find(x => x.id === 'dominant-failure')).toBeUndefined();
  });

  it('flags a slow average build', () => {
    const o = analyzeBuildOptimizations(analytics({ avgDurationMs: 240_000, p95DurationMs: 300_000 }));
    expect(o.find(x => x.id === 'slow-average')).toBeTruthy();
  });

  it('flags a slow tail when p95 is much larger than the average', () => {
    const o = analyzeBuildOptimizations(analytics({ avgDurationMs: 30_000, p95DurationMs: 120_000 }));
    const t = o.find(x => x.id === 'slow-tail')!;
    expect(t.title).toContain('4.0×');
  });

  it('respects custom thresholds', () => {
    const o = analyzeBuildOptimizations(
      analytics({ terminalJobs: 12, failureRate: 0.15, topFailureTypes: [{ type: 'x', count: 2 }] }),
      { ...DEFAULT_OPTIMIZER_THRESHOLDS, highFailureRate: 0.1 },
    );
    expect(o.find(x => x.id === 'high-failure-rate')).toBeTruthy();
  });
});
