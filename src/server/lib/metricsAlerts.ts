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
/**
 * Average build time above this (ms) triggers a slow-build WARNING.
 *
 * IT WAS 30 SECONDS, AND THAT MADE IT AN ALARM THAT COULD NEVER TURN OFF (admin screenshot,
 * 2026-08-24). A real v5 build takes minutes: this repo's own measurements put a 15-file todo app at
 * ~3.7 min and a 20-file notes app at ~4.0 min, and the report that started this week's work ran
 * 18m 42s. Thirty seconds does not even cover setup — one of our own reports records "111s of
 * preparation before the build's first model call".
 *
 * So every build cleared it, every hour fired, and the admin's three notifications read:
 * 56.3s, 397.3s, 777.2s — all "over 30s", all the same yellow, all the same words. The 56-second hour
 * was an hour when everything was going WELL.
 *
 * That is worse than useless. An alert that always fires teaches its reader to ignore alerts, and the
 * one that finally matters arrives in the same shape as a thousand that did not. The threshold now
 * sits ABOVE the normal range rather than below it, so firing means something.
 */
export const SLOW_BUILD_MS = 10 * 60_000;

/**
 * Average build time above this is a CRITICAL, not a warning.
 *
 * The old rule had one severity for everything, so a 13x difference (56s vs 777s) produced identical
 * notifications. A number you cannot act differently on is not a measurement, it is noise with a
 * decimal point.
 */
export const VERY_SLOW_BUILD_MS = 20 * 60_000;

/**
 * Builds needed in the window before the slow-build alert may fire.
 *
 * The old code skipped the sample check deliberately — "a single very slow avg matters". But ONE BUILD
 * HAS NO AVERAGE, and a single unlucky import (a big npm install, a cold sandbox) would page the admin
 * about a problem that does not exist.
 *
 * 🔴 RAISED 3 → 10 (2026-09-12), and this is the OTHER HALF of the admin's alert-noise report. Three
 * builds is not a sample, it is an anecdote: with a 30-minute build ceiling, ONE slow build among
 * three drags the hour's mean over the 10-minute line on its own, and the next hour drops it back
 * under. That is not a system getting slower and then better — it is the same handful of builds being
 * averaged differently, and it is what made the metric cross its threshold every hour, all day.
 *
 * Ten is not a new invention: it is ALERT_MIN_SAMPLE, this file's own existing answer to "how many
 * data points before an average is worth waking someone for". The earlier reasoning ("latency is
 * visible in a handful of builds") is true of a HUMAN watching builds and false of a MEAN, which is
 * exactly the kind of average one outlier owns.
 *
 * ⚠️ The 10-minute threshold itself is NOT changed here, and that is deliberate rather than an
 * oversight: whether 10 minutes is actually abnormal for this engine needs the real distribution of
 * build durations, which nobody has measured. Guessing a new threshold would replace a noisy alert
 * with a quiet one that might be wrong — so the sample is fixed now and the threshold is named as an
 * open question for the admin, with the data to settle it.
 */
export const SLOW_BUILD_MIN_SAMPLE = ALERT_MIN_SAMPLE;

/**
 * How many FAILED builds nevertheless produced an app that opened in a browser and rendered.
 *
 * 🔴 WHY THIS EXISTS (admin screenshot, 2026-09-14). Two alerts fired in the same minute, off the same
 * ten builds, and they contradicted each other:
 *
 *     🔴 "Build failure rate is 60.0% (over 10%). Investigate the engine/providers."
 *     🟡 "Only 50.0% of builds reached a preview (target 80%). Many apps generated but not runnable."
 *
 * Ten builds: six counted failed, four counted succeeded — and FIVE reached a preview. Both numbers
 * come from the same snapshot, and `previewAllowed` is set from `buildObs.previewRendered`, which
 * means the platform watched that app render in a real browser. So at least one of the six "failures"
 * was an app the platform had itself seen working, and the alert's advice — go and look at the
 * providers — points at the one component the evidence exonerates: the providers produced a running
 * app.
 *
 * This is the same class this repo has now autopsied four times (`697b38ee`, `fd021c64`, `1ef27cd7`,
 * `d11ad529`): a working app carrying a failing verdict. The fixes for the verdict live in the build
 * route (#2913 merged; #2929 / #2931 open). THIS is the other end of it — the number the admin reads,
 * which had no idea the fact contradicting it was sitting in the same object.
 *
 * ⚠️ DELIBERATELY NOT CALLED "false failures". A build can render AND still have a genuine blocker,
 * so this is not proof the verdict was wrong. What it IS proof of is narrower and enough: those
 * builds produced an app that runs, so provider latency is not where to start looking.
 *
 * PURE. Clamped at zero because the two counters are recorded on different code paths and a snapshot
 * mid-flush can legitimately show preview ahead of success without anything being wrong.
 */
export function rendersCountedAsFailures(b: { succeeded: number; previewAllowed: number }): number {
  const ok = Number(b?.succeeded);
  const rendered = Number(b?.previewAllowed);
  if (!Number.isFinite(ok) || !Number.isFinite(rendered)) return 0;
  return Math.max(0, Math.floor(rendered) - Math.floor(ok));
}

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
    const rendersAsFailures = rendersCountedAsFailures(b);
    if (errorRate > ERROR_RATE_THRESHOLD) {
      alerts.push({
        id: 'high-error-rate',
        severity: 'critical',
        // The advice is chosen from the evidence in this same snapshot rather than fixed in advance:
        // when builds that RENDERED are sitting in the failed column, sending the admin to the
        // providers costs them the one hour the alert bought. Severity stays critical either way —
        // telling a user their working app is broken is not the smaller problem.
        message: rendersAsFailures > 0
          ? `Build failure rate is ${(errorRate * 100).toFixed(1)}% (over ${ERROR_RATE_THRESHOLD * 100}%). But at least ${rendersAsFailures} of those build(s) produced an app that opened in a browser and RENDERED — so the engine is making working apps. Start at the release gate and the build verdict, not provider latency.`
          : `Build failure rate is ${(errorRate * 100).toFixed(1)}% (over ${ERROR_RATE_THRESHOLD * 100}%). Investigate the engine/providers.`,
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

  // Latency needs a real sample and a threshold above the normal range — see the constants above for
  // why both were wrong, and what an always-on alarm costs.
  if (b.avgMs > SLOW_BUILD_MS && b.total >= SLOW_BUILD_MIN_SAMPLE) {
    const critical = b.avgMs > VERY_SLOW_BUILD_MS;
    const mins = (b.avgMs / 60_000).toFixed(1);
    alerts.push({
      id: 'slow-builds',
      severity: critical ? 'critical' : 'warning',
      // Minutes, because that is the unit a person waits in — "397.3s" makes the reader do arithmetic
      // before they can tell whether to care. The sample size is named so a spike from four builds is
      // not read as a trend.
      message: critical
        ? `Builds are averaging ${mins} min across ${b.total} build(s) — far past the ${VERY_SLOW_BUILD_MS / 60_000}-minute mark. Something is stuck: check provider latency and repair loops.`
        : `Builds are averaging ${mins} min across ${b.total} build(s), over the ${SLOW_BUILD_MS / 60_000}-minute mark. Check provider latency and repair loops.`,
      metric: 'builds.avgMs',
      value: b.avgMs,
      threshold: critical ? VERY_SLOW_BUILD_MS : SLOW_BUILD_MS,
    });
  }

  return alerts;
}
