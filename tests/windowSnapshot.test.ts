/**
 * The analysers analyse the WINDOW the charts draw (admin Monitor capture, 2026-09-14).
 *
 * Captured 49 s after a deploy: charts showed 3 builds / ₹231.36 for the last 6 hours; Insights said
 * "No builds or model calls have been recorded in this window"; Health said "No data yet for: success"
 * and scored Reliability 100 beside three failed builds. They were reading the since-boot registry.
 */
import { describe, it, expect } from 'vitest';
import { windowSnapshot, sinceBootScope, windowLabel } from '../src/server/lib/windowSnapshot';
import { generateInsights, hasNoTelemetry } from '../src/server/lib/AiInsights';
import type { TimelineSeries } from '../src/server/lib/metricsTimeline';

const series = (o: Partial<TimelineSeries['summary']> = {}, providers: TimelineSeries['providers'] = {}): TimelineSeries => ({
  available: true, hasData: true, bucketMs: 300_000, from: Date.UTC(2026, 8, 14, 1, 20), to: Date.UTC(2026, 8, 14, 7, 20),
  points: [],
  summary: {
    builds: 3, buildsOk: 0, buildsFailed: 3, buildMs: 3 * 380_000, previewOk: 2,
    aiRequests: 16, inputTokens: 3_900_000, outputTokens: 100_000, costMicroUsd: 2_720_000, sandboxSeconds: 1142,
    successRate: 0, previewRate: 2 / 3, avgBuildMs: 380_000, costUsd: 2.72,
    sandboxUsd: null, sandboxRateConfigured: false, sandboxRateNote: '',
    ...o,
  },
  providers: { kimi: { requests: 16, inputTokens: 3_600_000, outputTokens: 100_000, costMicroUsd: 2_600_000 }, ...providers },
});

describe('windowSnapshot — the exact capture, as the analysers now see it', () => {
  it('carries the window’s 3 builds, 0 ok, 2 rendered — so "no telemetry" is impossible here', () => {
    const { snapshot } = windowSnapshot(series(), 6);
    expect(snapshot.builds.total).toBe(3);
    expect(snapshot.builds.succeeded).toBe(0);
    expect(snapshot.builds.failed).toBe(3);
    expect(snapshot.builds.previewAllowed).toBe(2);
    expect(snapshot.builds.successRate).toBe(0);
    expect(snapshot.builds.previewRate).toBeCloseTo(2 / 3);
    expect(snapshot.builds.avgMs).toBe(380_000);
    expect(hasNoTelemetry(snapshot)).toBe(false);
  });

  it('prices providers from micro-dollars and totals the window’s cost', () => {
    const { snapshot } = windowSnapshot(series(), 6);
    expect(snapshot.tokens.kimi.costUsd).toBeCloseTo(2.6);
    expect(snapshot.tokens.kimi.requests).toBe(16);
    expect(snapshot.totalCostUsd).toBeCloseTo(2.72);
  });

  it('says it cannot vouch for repairs — and the repairs insight is skipped rather than printing "0 attempts"', () => {
    const { snapshot, scope } = windowSnapshot(series({ builds: 12, buildsOk: 12, buildsFailed: 0, previewOk: 12, successRate: 1, previewRate: 1 }), 6);
    expect(scope.repairsTracked).toBe(false);
    const ins = generateInsights(snapshot, undefined, { repairsTracked: scope.repairsTracked, label: scope.label });
    expect(ins.find((i) => i.id === 'repair-load' || /repair/i.test(i.headline))).toBeUndefined();
    expect(ins.find((i) => i.id === 'success-rate')).toBeDefined();
  });

  it('the no-data sentence names the scope instead of a fixed "in this window"', () => {
    const empty = series({ builds: 0, buildsOk: 0, buildsFailed: 0, previewOk: 0, buildMs: 0, aiRequests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, costUsd: 0 }, {});
    const { snapshot } = windowSnapshot({ ...empty, providers: {} }, 6);
    const [ins] = generateInsights(snapshot, undefined, { label: 'the last 6 hours' });
    expect(ins.id).toBe('no-data');
    expect(ins.detail).toContain('the last 6 hours');
    const [boot] = generateInsights(snapshot, undefined, { label: 'since this server started (49s ago)' });
    expect(boot.detail).toContain('since this server started');
  });

  it('since is the window start, and the scope labels read like the panel', () => {
    const { snapshot, scope } = windowSnapshot(series(), 6);
    expect(snapshot.since).toBe(new Date(Date.UTC(2026, 8, 14, 1, 20)).toISOString());
    expect(scope.source).toBe('window');
    expect(scope.hours).toBe(6);
    expect(windowLabel(1)).toBe('the last 1 hour');
    expect(windowLabel(6)).toBe('the last 6 hours');
    expect(windowLabel(24)).toBe('the last 1 day');
    expect(windowLabel(168)).toBe('the last 7 days');
  });

  it('degrades a malformed series to zeros rather than NaN', () => {
    const bad = { ...series(), summary: { builds: 'x', costUsd: undefined } as unknown as TimelineSeries['summary'], providers: { v: { requests: 'q' } as never } };
    const { snapshot } = windowSnapshot(bad, 6);
    expect(snapshot.builds.total).toBe(0);
    expect(snapshot.totalCostUsd).toBe(0);
    expect(snapshot.tokens.v.requests).toBe(0);
  });

  it('sinceBootScope describes the registry the same way', () => {
    const scope = sinceBootScope({ tokens: {}, totalCostUsd: 0, builds: { total: 0, succeeded: 0, failed: 0, previewAllowed: 0, edits: 0, freshBuilds: 0, totalMs: 0, totalRepairAttempts: 0, successRate: 0, previewRate: 0, avgMs: 0 }, since: '2026-09-14T07:52:00.000Z' }, 49.4);
    expect(scope.source).toBe('since-boot');
    expect(scope.repairsTracked).toBe(true);
    expect(scope.label).toBe('since this server started (49s ago)');
  });
});
