import { describe, it, expect } from 'vitest';
import { evaluateAlerts, rendersCountedAsFailures, ALERT_MIN_SAMPLE } from '../src/server/lib/metricsAlerts';
import type { MetricsSnapshot } from '../src/server/lib/metrics';

/**
 * THE ADMIN'S OWN SCREENSHOT, 2026-09-14, 2:22 PM. Two alerts, same minute, same ten builds:
 *
 *   🔴 "Build failure rate is 60.0% (over 10%). Investigate the engine/providers."
 *   🟡 "Only 50.0% of builds reached a preview (target 80%). Many apps generated but not runnable."
 *
 * 10 builds → 6 failed, 4 succeeded, 5 rendered. At least ONE build that the platform watched render
 * in a real browser was sitting in the failed column — and the advice sent the admin to the providers,
 * the one component that evidence exonerates.
 */
const snapshot = (b: Partial<MetricsSnapshot['builds']>): MetricsSnapshot => ({
  tokens: {} as never,
  totalCostUsd: 0,
  since: new Date(0).toISOString(),
  builds: {
    total: 10, succeeded: 4, failed: 6, previewAllowed: 5,
    edits: 0, freshBuilds: 0, totalRepairAttempts: 0, totalMs: 0,
    successRate: 0.4, previewRate: 0.5, avgMs: 0,
    ...b,
  },
} as MetricsSnapshot);

const failureAlert = (s: MetricsSnapshot) => evaluateAlerts(s).find((a) => a.id === 'high-error-rate');

describe('rendersCountedAsFailures — the fact that was already in the same object', () => {
  it('reads the admin\'s screenshot exactly', () => {
    expect(rendersCountedAsFailures({ succeeded: 4, previewAllowed: 5 })).toBe(1);
  });

  it('is zero when nothing contradicts the failure count', () => {
    expect(rendersCountedAsFailures({ succeeded: 6, previewAllowed: 3 })).toBe(0);
    expect(rendersCountedAsFailures({ succeeded: 4, previewAllowed: 4 })).toBe(0);
  });

  it('never goes negative — the two counters are written on different paths', () => {
    // A snapshot read mid-flush can legitimately show one ahead of the other with nothing wrong.
    expect(rendersCountedAsFailures({ succeeded: 9, previewAllowed: 0 })).toBe(0);
    expect(rendersCountedAsFailures({} as never)).toBe(0);
    expect(rendersCountedAsFailures({ succeeded: NaN, previewAllowed: 5 })).toBe(0);
  });
});

describe('the failure-rate alert must not send the admin to the wrong component', () => {
  it('🔴 THE BUG: with rendered apps in the failed column it no longer blames the providers', () => {
    const a = failureAlert(snapshot({}))!;
    expect(a).toBeTruthy();
    expect(a.message).toContain('60.0%');
    expect(a.message).toContain('RENDERED');
    expect(a.message).toContain('release gate');
    // The old advice is the thing being corrected — it must not survive alongside the new one.
    expect(a.message).not.toContain('Investigate the engine/providers');
  });

  it('names how many, so the admin can tell one stray build from a systemic verdict bug', () => {
    expect(failureAlert(snapshot({ succeeded: 1, failed: 9, previewAllowed: 8 }))!.message).toContain('at least 7');
  });

  it('keeps the old advice when the evidence does NOT contradict it', () => {
    // Genuinely broken builds: nothing rendered. Providers are exactly where to look.
    const a = failureAlert(snapshot({ succeeded: 4, failed: 6, previewAllowed: 2 }))!;
    expect(a.message).toContain('Investigate the engine/providers');
    expect(a.message).not.toContain('RENDERED');
  });

  it('stays CRITICAL either way — telling a user their working app is broken is not the smaller bug', () => {
    expect(failureAlert(snapshot({}))!.severity).toBe('critical');
    expect(failureAlert(snapshot({ previewAllowed: 2 }))!.severity).toBe('critical');
  });

  it('does not fire at all below the minimum sample, contradiction or not', () => {
    const small = snapshot({ total: ALERT_MIN_SAMPLE - 1, succeeded: 1, failed: 8, previewAllowed: 7 });
    expect(failureAlert(small)).toBeUndefined();
  });

  it('says nothing about renders when the failure rate is healthy', () => {
    // A rendered-but-failed build below the threshold is not worth an alarm of its own here; this
    // function reports conditions, and "the failure rate is fine" is one of them.
    expect(failureAlert(snapshot({ succeeded: 9, failed: 1, previewAllowed: 10 }))).toBeUndefined();
  });
});
