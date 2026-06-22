import { describe, it, expect } from 'vitest';
import {
  evaluateAlerts,
  ERROR_RATE_THRESHOLD,
  PREVIEW_RATE_THRESHOLD,
  SLOW_BUILD_MS,
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
