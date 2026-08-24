import { describe, it, expect } from 'vitest';
import {
  evaluateAlerts,
  ERROR_RATE_THRESHOLD,
  PREVIEW_RATE_THRESHOLD,
  SLOW_BUILD_MS,
  VERY_SLOW_BUILD_MS,
  SLOW_BUILD_MIN_SAMPLE,
  ALERT_MIN_SAMPLE,
} from '../src/server/lib/metricsAlerts';
import type { MetricsSnapshot } from '../src/server/lib/metrics';

function snap(builds: Partial<MetricsSnapshot['builds']>): MetricsSnapshot {
  return {
    tokens: {},
    totalCostUsd: 0,
    since: new Date().toISOString(),
    builds: {
      total: 0, succeeded: 0, failed: 0, previewAllowed: 0,
      edits: 0, freshBuilds: 0, totalMs: 0, totalRepairAttempts: 0,
      successRate: 1, previewRate: 1, avgMs: 0,
      ...builds,
    },
  };
}

describe('evaluateAlerts', () => {
  it('returns no alerts for a healthy snapshot', () => {
    const alerts = evaluateAlerts(snap({ total: 50, succeeded: 50, previewAllowed: 50, previewRate: 1, successRate: 1, avgMs: 5000 }));
    expect(alerts).toHaveLength(0);
  });

  it('does not fire rate alerts below the minimum sample size', () => {
    // 100% failure but only a few builds → no rate alert (noise guard).
    const alerts = evaluateAlerts(snap({ total: ALERT_MIN_SAMPLE - 1, failed: ALERT_MIN_SAMPLE - 1, previewRate: 0, successRate: 0, avgMs: 1000 }));
    expect(alerts.find(a => a.id === 'high-error-rate')).toBeUndefined();
    expect(alerts.find(a => a.id === 'low-preview-rate')).toBeUndefined();
  });

  it('fires a critical high-error-rate alert above threshold', () => {
    const alerts = evaluateAlerts(snap({ total: 20, failed: 5, succeeded: 15, previewAllowed: 20, previewRate: 1, avgMs: 1000 }));
    const a = alerts.find(x => x.id === 'high-error-rate');
    expect(a).toBeDefined();
    expect(a!.severity).toBe('critical');
    expect(a!.value).toBeGreaterThan(ERROR_RATE_THRESHOLD);
  });

  it('does not fire high-error-rate exactly at/below threshold', () => {
    // 10% failure == threshold (not strictly over) → no alert.
    const alerts = evaluateAlerts(snap({ total: 20, failed: 2, succeeded: 18, previewAllowed: 20, previewRate: 1, avgMs: 1000 }));
    expect(alerts.find(a => a.id === 'high-error-rate')).toBeUndefined();
  });

  it('fires a low-preview-rate warning below threshold', () => {
    const alerts = evaluateAlerts(snap({ total: 20, succeeded: 20, previewAllowed: 10, previewRate: 0.5, avgMs: 1000 }));
    const a = alerts.find(x => x.id === 'low-preview-rate');
    expect(a).toBeDefined();
    expect(a!.severity).toBe('warning');
    expect(a!.value).toBeLessThan(PREVIEW_RATE_THRESHOLD);
  });

  it('fires a slow-build warning when avg exceeds the latency budget', () => {
    const alerts = evaluateAlerts(snap({ total: 3, succeeded: 3, previewAllowed: 3, previewRate: 1, avgMs: SLOW_BUILD_MS + 1 }));
    const a = alerts.find(x => x.id === 'slow-builds');
    expect(a).toBeDefined();
    expect(a!.value).toBeGreaterThan(SLOW_BUILD_MS);
  });

  it('can fire multiple alerts at once', () => {
    const alerts = evaluateAlerts(snap({ total: 30, failed: 9, succeeded: 21, previewAllowed: 15, previewRate: 0.5, avgMs: SLOW_BUILD_MS + 5000 }));
    const ids = alerts.map(a => a.id).sort();
    expect(ids).toContain('high-error-rate');
    expect(ids).toContain('low-preview-rate');
    expect(ids).toContain('slow-builds');
  });
});

describe('the slow-build alert must be able to turn OFF (admin screenshot, 2026-08-24)', () => {
  /**
   * The threshold was 30 SECONDS. A real v5 build takes minutes — this repo's own measurements put a
   * 15-file todo app at ~3.7 min, and one of our own reports records "111s of preparation before the
   * build's first model call". So every build cleared it, every hour fired, and the admin's three
   * notifications read 56.3s, 397.3s and 777.2s — all "over 30s", all the same yellow, all the same
   * words. The 56-second hour was an hour when everything was going well.
   */
  const healthy = (avgMs: number, total = 20) =>
    evaluateAlerts(snap({ total, succeeded: total, previewAllowed: total, previewRate: 1, successRate: 1, avgMs }));

  it('a NORMAL build hour is silent — this is the whole fix', () => {
    // Every one of these fired under the old threshold.
    for (const seconds of [56.3, 180, 240, 397.3]) {
      const alerts = healthy(seconds * 1000);
      expect(alerts.find((a) => a.id === 'slow-builds'), `${seconds}s should be silent`).toBeUndefined();
    }
  });

  it('the threshold sits ABOVE the normal range, not below it', () => {
    // A measured 4-minute build must be comfortably inside; 18m 42s (the report that started this
    // week's work) must be outside.
    expect(SLOW_BUILD_MS).toBeGreaterThan(5 * 60_000);
    expect(SLOW_BUILD_MS).toBeLessThan(18 * 60_000);
  });

  it('still fires when builds are genuinely slow', () => {
    const a = healthy(SLOW_BUILD_MS + 1).find((x) => x.id === 'slow-builds');
    expect(a?.severity).toBe('warning');
  });
});

describe('one build has no average', () => {
  it('does not fire below the sample floor, however slow that one build was', () => {
    // The old code skipped the sample check on purpose. A single unlucky import — a big npm install, a
    // cold sandbox — would page the admin about a problem that does not exist.
    const alerts = evaluateAlerts(snap({
      total: SLOW_BUILD_MIN_SAMPLE - 1, succeeded: 1, previewAllowed: 1, previewRate: 1, successRate: 1,
      avgMs: VERY_SLOW_BUILD_MS * 2,
    }));
    expect(alerts.find((a) => a.id === 'slow-builds')).toBeUndefined();
  });

  it('fires at the floor itself', () => {
    const alerts = evaluateAlerts(snap({
      total: SLOW_BUILD_MIN_SAMPLE, succeeded: SLOW_BUILD_MIN_SAMPLE, previewAllowed: SLOW_BUILD_MIN_SAMPLE,
      previewRate: 1, successRate: 1, avgMs: SLOW_BUILD_MS + 1,
    }));
    expect(alerts.find((a) => a.id === 'slow-builds')).toBeDefined();
  });

  it('is lower than the rate floor, because latency shows up in fewer builds than a failure rate does', () => {
    expect(SLOW_BUILD_MIN_SAMPLE).toBeLessThan(ALERT_MIN_SAMPLE);
    expect(SLOW_BUILD_MIN_SAMPLE).toBeGreaterThan(1);
  });
});

describe('a 13x difference must not read identically', () => {
  const at = (avgMs: number) =>
    evaluateAlerts(snap({ total: 20, succeeded: 20, previewAllowed: 20, previewRate: 1, successRate: 1, avgMs }))
      .find((a) => a.id === 'slow-builds')!;

  it('escalates to critical past the second mark', () => {
    expect(at(SLOW_BUILD_MS + 1).severity).toBe('warning');
    expect(at(VERY_SLOW_BUILD_MS + 1).severity).toBe('critical');
  });

  it('reports MINUTES — the unit a person actually waits in', () => {
    // "397.3s" makes the reader do arithmetic before they can tell whether to care.
    expect(at(VERY_SLOW_BUILD_MS + 60_000).message).toMatch(/\d+\.\d min/);
    expect(at(SLOW_BUILD_MS + 1).message).not.toContain('over 30s');
  });

  it('names the sample, so a spike from four builds is not read as a trend', () => {
    expect(at(SLOW_BUILD_MS + 1).message).toContain('20 build(s)');
  });
});
