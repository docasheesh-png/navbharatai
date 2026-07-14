import { describe, it, expect } from 'vitest';
import { summarizeBuildFailures } from './buildFailureAnalytics';

const day = (date: string, totalBuilds: number, okBuilds: number) => ({ date, totalBuilds, okBuilds });

describe('summarizeBuildFailures', () => {
  it('computes per-day and overall failure rates', () => {
    const r = summarizeBuildFailures([day('2026-07-10', 10, 8), day('2026-07-11', 5, 5)]);
    expect(r.daily).toHaveLength(2);
    expect(r.daily[0]).toMatchObject({ date: '2026-07-10', totalBuilds: 10, failedBuilds: 2 });
    expect(r.daily[0].failureRate).toBeCloseTo(0.2, 6);
    expect(r.daily[1].failureRate).toBe(0);
    expect(r.overall).toMatchObject({ totalBuilds: 15, failedBuilds: 2 });
    expect(r.overall.failureRate).toBeCloseTo(2 / 15, 6);
  });

  it('sorts days chronologically and clamps okBuilds to totalBuilds', () => {
    const r = summarizeBuildFailures([day('2026-07-11', 4, 9), day('2026-07-09', 2, 1)]);
    expect(r.daily.map((d) => d.date)).toEqual(['2026-07-09', '2026-07-11']);
    expect(r.daily[1].failedBuilds).toBe(0); // ok clamped to total → no negative failures
  });

  it('flags an upward failure-rate SPIKE (bad day), not a good day', () => {
    // Steady ~10% failure, then one day at 90% → the bad day is the spike.
    const days = [
      day('2026-07-01', 20, 18), day('2026-07-02', 20, 18), day('2026-07-03', 20, 18),
      day('2026-07-04', 20, 18), day('2026-07-05', 20, 2), // 90% failure — the spike
      day('2026-07-06', 20, 18),
    ];
    const r = summarizeBuildFailures(days);
    expect(r.spikeDates).toContain('2026-07-05');
    expect(r.spikeDates).not.toContain('2026-07-01');
  });

  it('does not flag spikes without enough history, and never throws on empty/garbage', () => {
    expect(summarizeBuildFailures([day('2026-07-01', 10, 1)]).spikeDates).toEqual([]);
    expect(summarizeBuildFailures([]).overall.totalBuilds).toBe(0);
    expect(summarizeBuildFailures(null).daily).toEqual([]);
    // @ts-expect-error garbage input tolerated
    expect(summarizeBuildFailures([null, { date: 5 }]).daily).toEqual([]);
  });
});
