import { describe, it, expect } from 'vitest';
import {
  timeLabel, humanDuration, percent, compactNumber, microUsdToInr, formatInr,
  extractSeries, totalsFor, feedState, feedMessage, providerRows, rateTone,
  type MonitorPoint,
} from './monitorFormat';

const pt = (over: Partial<MonitorPoint>): MonitorPoint => ({
  t: 0, observed: true, builds: 0, buildsOk: 0, buildsFailed: 0, buildMs: 0,
  previewOk: 0, aiRequests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, sandboxSeconds: 0, ...over,
});

describe('monitorFormat — unknown is never rendered as zero', () => {
  it('shows a dash for an unknown duration, rate, count and rupee value', () => {
    expect(humanDuration(null)).toBe('—');
    expect(humanDuration(undefined)).toBe('—');
    expect(percent(null)).toBe('—');
    expect(compactNumber(null)).toBe('—');
    expect(formatInr(null)).toBe('—');
  });

  it('distinguishes a real zero from an unknown', () => {
    expect(humanDuration(0)).toBe('0ms');
    expect(percent(0)).toBe('0%');
    expect(compactNumber(0)).toBe('0');
  });
});

describe('monitorFormat — human readable values', () => {
  it('scales a duration to the unit a reader can act on', () => {
    expect(humanDuration(450)).toBe('450ms');
    expect(humanDuration(4200)).toBe('4.2s');
    expect(humanDuration(190_000)).toBe('3m 10s');
    expect(humanDuration(3_840_000)).toBe('1h 4m');
  });

  it('compacts large counts', () => {
    expect(compactNumber(940)).toBe('940');
    expect(compactNumber(12_400)).toBe('12.4K');
    expect(compactNumber(3_200_000)).toBe('3.2M');
  });

  it('includes the date only on windows longer than a day', () => {
    const t = new Date(2026, 7, 23, 14, 5).getTime();
    expect(timeLabel(t, 6)).toBe('14:05');
    expect(timeLabel(t, 168)).toContain('14:05');
    expect(timeLabel(t, 168)).toContain('/');
    expect(timeLabel(0, 6)).toBe('—');
  });
});

describe('monitorFormat — money', () => {
  it('converts micro-dollars at the live rate', () => {
    expect(microUsdToInr(1_000_000, 87)).toBeCloseTo(87);
    expect(formatInr(87)).toBe('₹87.00');
  });

  it('refuses to invent a conversion when the rate is unknown', () => {
    expect(microUsdToInr(1_000_000, null)).toBeNull();
    expect(microUsdToInr(1_000_000, 0)).toBeNull();
    expect(microUsdToInr(null, 87)).toBeNull();
  });
});

describe('monitorFormat — extractSeries', () => {
  const points = [
    pt({ builds: 2, buildMs: 20_000, costMicroUsd: 500_000, inputTokens: 100, outputTokens: 50 }),
    pt({ builds: 0 }),
    pt({ builds: 1, buildMs: 30_000, costMicroUsd: 250_000 }),
  ];

  it('plots builds, cost and tokens straight through', () => {
    expect(extractSeries(points, 'builds')).toEqual([2, 0, 1]);
    expect(extractSeries(points, 'cost')).toEqual([0.5, 0, 0.25]);
    expect(extractSeries(points, 'tokens')).toEqual([150, 0, 0]);
  });

  it('carries latency across an empty bucket instead of dropping it to zero', () => {
    // A quiet five minutes must not make the app look instant.
    expect(extractSeries(points, 'latency')).toEqual([10_000, 10_000, 30_000]);
  });

  it('leaves latency at zero before any build has ever been seen', () => {
    expect(extractSeries([pt({}), pt({ builds: 1, buildMs: 5_000 })], 'latency')).toEqual([0, 5_000]);
  });

  it('survives an empty series', () => {
    expect(extractSeries([], 'builds')).toEqual([]);
    expect(extractSeries(null as any, 'latency')).toEqual([]);
  });
});

describe('monitorFormat — totalsFor', () => {
  it('totals a window and derives real rates', () => {
    const t = totalsFor([
      pt({ builds: 3, buildsOk: 2, buildsFailed: 1, previewOk: 2, buildMs: 60_000, inputTokens: 10, outputTokens: 5, costMicroUsd: 1_000_000 }),
      pt({ builds: 1, buildsOk: 1, previewOk: 1, buildMs: 20_000, costMicroUsd: 500_000 }),
    ]);
    expect(t.builds).toBe(4);
    expect(t.successRate).toBeCloseTo(0.75);
    expect(t.previewRate).toBeCloseTo(0.75);
    expect(t.avgBuildMs).toBe(20_000);
    expect(t.tokens).toBe(15);
    expect(t.costUsd).toBeCloseTo(1.5);
    expect(t.anyActivity).toBe(true);
  });

  it('reports rates as null when nothing ran — not as 0%', () => {
    const t = totalsFor([pt({ observed: false }), pt({ observed: false })]);
    expect(t.successRate).toBeNull();
    expect(t.avgBuildMs).toBeNull();
    expect(t.anyActivity).toBe(false);
  });
});

describe('monitorFormat — feedState is the honesty gate', () => {
  it('never lets a broken feed look like a calm night', () => {
    const broken = feedState({ loading: false, error: null, available: false, hasData: false });
    const calm = feedState({ loading: false, error: null, available: true, hasData: false });
    expect(broken).toBe('unavailable');
    expect(calm).toBe('idle');
    expect(broken).not.toBe(calm);
    expect(feedMessage('unavailable', 'Last 6 hours')).toContain('cannot see');
    expect(feedMessage('idle', 'Last 6 hours')).toContain('real zero');
  });

  it('treats a fetch error as unavailable, whatever the payload claimed', () => {
    expect(feedState({ loading: false, error: 'network down', available: true, hasData: true })).toBe('unavailable');
  });

  it('reports live only when a bucket was really written', () => {
    expect(feedState({ loading: false, error: null, available: true, hasData: true })).toBe('live');
    expect(feedState({ loading: true, error: null, available: true, hasData: true })).toBe('loading');
  });
});

describe('monitorFormat — providerRows', () => {
  it('ranks providers by spend and computes each share', () => {
    const rows = providerRows({
      glm: { requests: 4, inputTokens: 100, outputTokens: 50, costMicroUsd: 250_000 },
      claude: { requests: 1, inputTokens: 200, outputTokens: 100, costMicroUsd: 750_000 },
    });
    expect(rows.map((r) => r.name)).toEqual(['claude', 'glm']);
    expect(rows[0].share).toBeCloseTo(0.75);
    expect(rows[1].share).toBeCloseTo(0.25);
  });

  it('falls back to token share when no cost has been measured', () => {
    const rows = providerRows({
      glm: { inputTokens: 300, outputTokens: 0 },
      kimi: { inputTokens: 100, outputTokens: 0 },
    });
    expect(rows[0].share).toBeCloseTo(0.75);
  });

  it('is empty, not broken, for missing input', () => {
    expect(providerRows(null)).toEqual([]);
    expect(providerRows({})).toEqual([]);
  });
});

describe('monitorFormat — rateTone', () => {
  it('grades a success rate by operational meaning', () => {
    expect(rateTone(0.95)).toBe('good');
    expect(rateTone(0.8)).toBe('warn');
    expect(rateTone(0.4)).toBe('bad');
    expect(rateTone(null)).toBe('unknown');
  });
});


describe('totalsFor — VM seconds', () => {
  it('totals the real VM time across the window', () => {
    const t = totalsFor([pt({ sandboxSeconds: 120 }), pt({ sandboxSeconds: 300 })]);
    expect(t.sandboxSeconds).toBe(420);
  });
});
