import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  bucketStartMs,
  bucketWidthMs,
  emptyCounters,
  fillSeries,
  summarize,
  safeProviderKey,
  metricsTimeline,
} from './metricsTimeline';
import { getMetrics, setMetricsSink } from './metrics';
import { recordPlatformBuild } from './platformBuildMetrics';

describe('metricsTimeline — bucket maths', () => {
  it('rounds a timestamp down to its bucket start', () => {
    const bucket = 5 * 60_000;
    expect(bucketStartMs(bucket * 3 + 1, bucket)).toBe(bucket * 3);
    expect(bucketStartMs(bucket * 3, bucket)).toBe(bucket * 3);
    expect(bucketStartMs(bucket * 4 - 1, bucket)).toBe(bucket * 3);
  });

  it('never returns a nonsense bucket for nonsense input', () => {
    expect(bucketStartMs(NaN, 1000)).toBe(0);
    expect(bucketStartMs(1000, 0)).toBe(0);
  });

  it('clamps the configured bucket width to 1–60 minutes', () => {
    const prev = process.env.MONITOR_BUCKET_MINUTES;
    process.env.MONITOR_BUCKET_MINUTES = '999';
    expect(bucketWidthMs()).toBe(60 * 60_000);
    process.env.MONITOR_BUCKET_MINUTES = '0';
    expect(bucketWidthMs()).toBe(5 * 60_000); // invalid → default, never a zero-width bucket
    process.env.MONITOR_BUCKET_MINUTES = 'abc';
    expect(bucketWidthMs()).toBe(5 * 60_000);
    if (prev === undefined) delete process.env.MONITOR_BUCKET_MINUTES;
    else process.env.MONITOR_BUCKET_MINUTES = prev;
  });
});

describe('metricsTimeline — fillSeries', () => {
  const bucket = 5 * 60_000;

  it('fills the gaps between real buckets with explicit zero points', () => {
    const t0 = bucket * 100;
    const docs = [
      { bucketStart: t0, builds: 2, buildsOk: 2 },
      { bucketStart: t0 + bucket * 3, builds: 1, buildsFailed: 1 },
    ];
    const points = fillSeries(docs, t0, t0 + bucket * 3, bucket);
    expect(points.map((p) => p.t)).toEqual([t0, t0 + bucket, t0 + bucket * 2, t0 + bucket * 3]);
    expect(points.map((p) => p.observed)).toEqual([true, false, false, true]);
    expect(points[1].builds).toBe(0);
    expect(points[3].buildsFailed).toBe(1);
  });

  it('marks a filled gap as NOT observed, so the client can tell a real zero from a hole', () => {
    const t0 = bucket * 50;
    const points = fillSeries([], t0, t0 + bucket, bucket);
    expect(points.every((p) => p.observed === false)).toBe(true);
    expect(points.every((p) => p.builds === 0)).toBe(true);
  });

  it('ignores a negative or non-numeric counter instead of propagating it into a chart', () => {
    const t0 = bucket * 10;
    const points = fillSeries([{ bucketStart: t0, builds: -5, outputTokens: 'x' as any }], t0, t0, bucket);
    expect(points[0].builds).toBe(0);
    expect(points[0].outputTokens).toBe(0);
  });

  it('returns nothing for an inverted or zero-width window rather than looping', () => {
    expect(fillSeries([], 1000, 500, bucket)).toEqual([]);
    expect(fillSeries([], 0, 1000, 0)).toEqual([]);
  });

  it('caps an absurd window so it cannot produce millions of points', () => {
    const points = fillSeries([], 0, 60_000 * 60 * 24 * 365, 60_000);
    expect(points.length).toBeLessThanOrEqual(2000);
  });
});

describe('metricsTimeline — summarize', () => {
  const bucket = 5 * 60_000;

  it('reports rates as null (not 0%) when no build ran — "no data" is not "everything failed"', () => {
    const s = summarize(fillSeries([], 0, bucket, bucket));
    expect(s.builds).toBe(0);
    expect(s.successRate).toBeNull();
    expect(s.previewRate).toBeNull();
    expect(s.avgBuildMs).toBeNull();
  });

  it('totals counters and derives real rates', () => {
    const t0 = bucket * 7;
    const points = fillSeries([
      { bucketStart: t0, builds: 3, buildsOk: 2, buildsFailed: 1, previewOk: 2, buildMs: 30_000, costMicroUsd: 1_500_000 },
      { bucketStart: t0 + bucket, builds: 1, buildsOk: 1, previewOk: 1, buildMs: 10_000, costMicroUsd: 500_000 },
    ], t0, t0 + bucket, bucket);
    const s = summarize(points);
    expect(s.builds).toBe(4);
    expect(s.successRate).toBeCloseTo(0.75);
    expect(s.previewRate).toBeCloseTo(0.75);
    expect(s.avgBuildMs).toBe(10_000);
    expect(s.costUsd).toBeCloseTo(2);
  });
});

describe('metricsTimeline — provider keys', () => {
  it('makes any provider name safe as a Firestore field path', () => {
    expect(safeProviderKey('GLM')).toBe('glm');
    expect(safeProviderKey('claude.sonnet/4')).toBe('claude_sonnet_4');
    expect(safeProviderKey('')).toBe('unknown');
    expect(safeProviderKey('x'.repeat(200)).length).toBeLessThanOrEqual(40);
  });
});

describe('metrics sink — the single recording funnel', () => {
  afterEach(() => setMetricsSink(null));

  it('fires the sink for every build and model call recorded anywhere', () => {
    const builds: any[] = [];
    const calls: any[] = [];
    setMetricsSink({
      onBuild: (o) => builds.push(o),
      onModelCall: (p, i, o, c) => calls.push({ p, i, o, c }),
    });
    getMetrics().recordBuild({ ok: true, previewAllowed: true, ms: 1234 });
    getMetrics().recordModelCall('glm', 100, 50);
    expect(builds).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].p).toBe('glm');
    expect(calls[0].c).toBeGreaterThan(0);
  });

  it('uses the caller’s REAL cost when one is given, instead of the approximate table', () => {
    const calls: any[] = [];
    setMetricsSink({ onModelCall: (p, i, o, c) => calls.push(c) });
    getMetrics().recordModelCall('glm', 1_000_000, 1_000_000, 0.42);
    expect(calls[0]).toBe(0.42);
  });

  it('a throwing sink can never break the recording that just happened', () => {
    setMetricsSink({
      onBuild: () => { throw new Error('sink exploded'); },
      onModelCall: () => { throw new Error('sink exploded'); },
    });
    expect(() => getMetrics().recordBuild({ ok: true, previewAllowed: false, ms: 1 })).not.toThrow();
    expect(() => getMetrics().recordModelCall('glm', 1, 1)).not.toThrow();
  });
});

describe('recordPlatformBuild — the AgentV3 wiring', () => {
  afterEach(() => setMetricsSink(null));

  it('records the build AND one priced entry per provider', () => {
    const builds: any[] = [];
    const calls: any[] = [];
    setMetricsSink({ onBuild: (o) => builds.push(o), onModelCall: (p, i, o, c) => calls.push({ p, i, o, c }) });
    recordPlatformBuild({
      ok: true,
      previewAllowed: true,
      isEdit: false,
      ms: 90_000,
      providerUsage: { glm: { inputTokens: 10_000, outputTokens: 2_000 }, claude: { inputTokens: 5_000, outputTokens: 1_000 } },
    });
    expect(builds).toHaveLength(1);
    expect(builds[0].ok).toBe(true);
    expect(calls.map((c) => c.p).sort()).toEqual(['claude', 'glm']);
    // Priced from the live rate card, so the graph and the bill cannot disagree.
    expect(calls.every((c) => c.c > 0)).toBe(true);
  });

  it('skips a provider that used no tokens rather than recording an empty call', () => {
    const calls: any[] = [];
    setMetricsSink({ onModelCall: (p) => calls.push(p) });
    recordPlatformBuild({
      ok: false, previewAllowed: false, isEdit: true, ms: 10,
      providerUsage: { glm: { inputTokens: 0, outputTokens: 0 } },
    });
    expect(calls).toHaveLength(0);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => recordPlatformBuild({ ok: true, previewAllowed: true, isEdit: false, ms: NaN, providerUsage: null as any })).not.toThrow();
  });
});

describe('metricsTimeline — storage safety', () => {
  beforeEach(() => { /* under vitest the store never reaches Firestore by design */ });

  it('reports the series as UNAVAILABLE rather than drawing zeros when storage cannot be read', async () => {
    const series = await metricsTimeline.series(6);
    expect(series.available).toBe(false);
    expect(series.hasData).toBe(false);
    // Critically: NO points at all, so a client cannot render a flat green line over a dead feed.
    expect(series.points).toEqual([]);
  });

  it('recording never throws even with no storage behind it', () => {
    expect(() => metricsTimeline.recordBuild({ ok: true, previewAllowed: true, ms: 100 })).not.toThrow();
    expect(() => metricsTimeline.recordModelCall('glm', 10, 5, 0.001)).not.toThrow();
  });

  it('starts from a clean zeroed counter set', () => {
    const c = emptyCounters();
    expect(Object.values(c).every((v) => v === 0)).toBe(true);
  });
});

describe('AgentV3 telemetry wiring (locked)', () => {
  // A wiring test, in the spirit of cachePrefixWiring.test.ts: if either settle path silently loses
  // its recordPlatformBuild call, NOTHING fails at runtime — the admin's Monitor just quietly goes
  // blind to real builds again, which is the exact bug this work fixed.
  const route = readFileSync(resolve(__dirname, '../routes/agentv3.ts'), 'utf8');

  it('records platform telemetry from BOTH the normal settle and the watchdog finalizer', () => {
    const occurrences = route.split('recordPlatformBuild(').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('imports the shared recorder rather than re-implementing it at a call site', () => {
    expect(route).toContain("from '../lib/platformBuildMetrics'");
  });
});
