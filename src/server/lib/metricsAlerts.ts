/**
 * Phase 4.3 — Alert evaluation (the code-completable half of "metrics + alerts").
 *
 * Pure function: given a live MetricsSnapshot, returns the alert conditions that
 * are currently triggered. No I/O, no notifications — the DETECTION logic that
 * the admin metrics panel renders and that a future notifier (email/Slack) can
 * forward. Notification DELIVERY needs external infra (out of scope, infra-gated);
 * this is the deterministic, unit-testable rules engine behind it.
 *
 * Thresholds are derived from the Phase 7 success criteria:
 *   • preview works first time on >80% of builds  → low-preview-rate alert
 *   • builds should not routinely fail            → high-error-rate alert
 *   • a build should not take "forever"           → slow-build alert
 */
import type { MetricsSnapshot } from './metrics';

export type AlertSeverity = 'critical' | 'warning';

export interface MetricAlert {
  id: string;
  severity: AlertSeverity;
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

/** Minimum builds before rate-based alerts fire (avoids noise on tiny samples). */
export const ALERT_MIN_SAMPLE = 10;
/** Build failure rate above this fraction triggers a critical alert. */
export const ERROR_RATE_THRESHOLD = 0.10;
/** Preview-allowed rate below this fraction triggers a warning (success criterion: >80%). */
export const PREVIEW_RATE_THRESHOLD = 0.80;
/** Average build time above this (ms) triggers a slow-build warning. */
export const SLOW_BUILD_MS = 30_000;

/**
 * Evaluate alert conditions against a metrics snapshot.
 * Returns an empty array when everything is healthy.
 */
export function evaluateAlerts(snapshot: MetricsSnapshot): MetricAlert[] {
  const alerts: MetricAlert[] = [];
  const b = snapshot.builds;
  if (!b) return alerts;

  // Rate-based alerts only once there is a meaningful sample.
  if (b.total >= ALERT_MIN_SAMPLE) {
    const errorRate = b.total ? b.failed / b.total : 0;
    if (errorRate > ERROR_RATE_THRESHOLD) {
      alerts.push({
        id: 'high-error-rate',
        severity: 'critical',
        message: `Build failure rate is ${(errorRate * 100).toFixed(1)}% (over ${ERROR_RATE_THRESHOLD * 100}%). Investigate the engine/providers.`,
        metric: 'builds.failureRate',
        value: Math.round(errorRate * 1000) / 1000,
        threshold: ERROR_RATE_THRESHOLD,
      });
    }

    if (b.previewRate < PREVIEW_RATE_THRESHOLD) {
      alerts.push({
        id: 'low-preview-rate',
        severity: 'warning',
        message: `Only ${(b.previewRate * 100).toFixed(1)}% of builds reached a preview (target ${PREVIEW_RATE_THRESHOLD * 100}%). Many apps generated but not runnable.`,
        metric: 'builds.previewRate',
        value: Math.round(b.previewRate * 1000) / 1000,
        threshold: PREVIEW_RATE_THRESHOLD,
      });
    }
  }

  // Latency alert is independent of sample size (a single very slow avg matters).
  if (b.avgMs > SLOW_BUILD_MS && b.total > 0) {
    alerts.push({
      id: 'slow-builds',
      severity: 'warning',
      message: `Average build time is ${(b.avgMs / 1000).toFixed(1)}s (over ${SLOW_BUILD_MS / 1000}s). Check provider latency and repair loops.`,
      metric: 'builds.avgMs',
      value: b.avgMs,
      threshold: SLOW_BUILD_MS,
    });
  }

  return alerts;
}
