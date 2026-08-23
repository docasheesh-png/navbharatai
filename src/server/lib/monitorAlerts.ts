/**
 * MONITOR ALERTS — the half of "metrics + alerts" that was never built.
 *
 * `metricsAlerts.ts` has computed real alert conditions since Phase 4.3, and its own header says
 * delivery "needs external infra (out of scope, infra-gated)". That was true when it was written and
 * is no longer: `saveNotification` + the in-app NotificationBell + the shared `ScheduledJobs`
 * scheduler all exist now. So the alerts were being computed and thrown away — the admin only ever
 * saw one by opening the panel at the right moment, which is not monitoring, it is luck.
 *
 * FOUR THINGS THIS GETS RIGHT, and each one is a way alerting usually fails:
 *
 * 1. IT EVALUATES A ROLLING WINDOW, NOT SINCE-BOOT. The live registry resets on every deploy and is
 *    per-instance, so an alert built on it fires on whatever this container happened to see. Alerts
 *    read the shared timeline instead, so every instance reaches the same verdict about the same hour.
 *
 * 2. IT DOES NOT REPEAT ITSELF. A condition notifies once, then stays quiet for a cooldown while it
 *    keeps firing. An alerting system that repeats every sweep trains its reader to ignore it, and an
 *    ignored alert is worse than none because it is trusted to be there.
 *
 * 3. IT SAYS WHEN THINGS RECOVER. Without an all-clear the admin cannot tell "fixed" from "still
 *    broken, and I stopped being told" — so recovery is delivered too.
 *
 * 4. IT NEVER ALERTS ON ABSENCE. When the timeline cannot be read, or the window has too few builds
 *    to judge, the sweep does NOTHING. "We cannot see" is not "everything is on fire", and inventing
 *    an alert out of missing data is the same dishonesty as drawing a zero line over a dead feed.
 *
 * Cross-instance safety: the notified-state doc is updated in a TRANSACTION, so several Cloud Run
 * instances sweeping at once produce ONE notification, not one each.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { evaluateAlerts, type MetricAlert } from './metricsAlerts';
import type { MetricsSnapshot } from './metrics';
import { metricsTimeline, type TimelineSummary } from './metricsTimeline';
import { saveNotification } from './AdminNotificationStore';
import { adminEmailList } from './adminEmails';

export const ALERT_STATE_COLLECTION = 'monitor_alert_state';
export const ALERT_STATE_DOC = 'current';

/** How long an alert that keeps firing stays quiet after being announced once. */
export function alertCooldownMs(): number {
  const raw = Number(process.env.MONITOR_ALERT_COOLDOWN_MINUTES);
  const mins = Number.isFinite(raw) && raw > 0 ? Math.min(24 * 60, Math.max(15, Math.floor(raw))) : 360;
  return mins * 60_000;
}

/** The window alerts judge. Long enough to be stable, short enough to still be news. */
export function alertWindowHours(): number {
  const raw = Number(process.env.MONITOR_ALERT_WINDOW_HOURS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(24, Math.max(1, Math.floor(raw))) : 1;
}

export function alertsEnabled(): boolean {
  return String(process.env.MONITOR_ALERTS ?? '').trim().toLowerCase() !== 'off';
}

/** Per-alert record of what has already been announced. */
export interface AlertStateEntry {
  firstSeenAt: number;
  lastNotifiedAt: number;
}

export type AlertState = Record<string, AlertStateEntry>;

export interface AlertActions {
  /** Alerts to announce now (new, or firing again after the cooldown). */
  notify: MetricAlert[];
  /** Ids that were firing and are not any more — the all-clear. */
  resolved: string[];
  nextState: AlertState;
}

/**
 * Decide what to announce. PURE — the whole judgement of this feature lives here and is unit-tested
 * without Firestore, a clock, or a notification service.
 */
export function decideAlertActions(
  current: MetricAlert[],
  state: AlertState,
  nowMs: number,
  cooldownMs: number,
): AlertActions {
  const firing = new Map((current || []).map((a) => [a.id, a]));
  const prev = state || {};
  const notify: MetricAlert[] = [];
  const nextState: AlertState = {};

  for (const [id, alert] of firing) {
    const seen = prev[id];
    if (!seen) {
      // Brand new — announce it.
      notify.push(alert);
      nextState[id] = { firstSeenAt: nowMs, lastNotifiedAt: nowMs };
      continue;
    }
    if (nowMs - seen.lastNotifiedAt >= cooldownMs) {
      // Still firing well after we last said so — worth repeating, but only this rarely.
      notify.push(alert);
      nextState[id] = { firstSeenAt: seen.firstSeenAt, lastNotifiedAt: nowMs };
      continue;
    }
    // Firing, already announced, still inside the quiet period.
    nextState[id] = seen;
  }

  const resolved = Object.keys(prev).filter((id) => !firing.has(id));
  return { notify, resolved, nextState };
}

/**
 * Shape a timeline window like a MetricsSnapshot so the EXISTING, tested `evaluateAlerts` rules run
 * against it unchanged. Deliberately reuses that rules engine rather than restating its thresholds —
 * two copies of "what counts as too many failures" would eventually disagree, and the admin would
 * have no way to tell which one their alert came from.
 *
 * Returns null when the window cannot support a verdict, which is what stops the sweep alerting on
 * missing data.
 */
export function snapshotFromWindow(summary: TimelineSummary | null | undefined): MetricsSnapshot | null {
  if (!summary || !(summary.builds > 0)) return null;
  return {
    tokens: {},
    totalCostUsd: summary.costUsd || 0,
    builds: {
      total: summary.builds,
      succeeded: summary.buildsOk,
      failed: summary.buildsFailed,
      previewAllowed: summary.previewOk,
      edits: 0,
      freshBuilds: 0,
      totalMs: summary.buildMs,
      totalRepairAttempts: 0,
      successRate: summary.successRate ?? 0,
      previewRate: summary.previewRate ?? 0,
      avgMs: summary.avgBuildMs ?? 0,
    },
    since: new Date(Date.now()).toISOString(),
  };
}

/** The message the admin actually reads. Plain, specific, and it names the window. */
export function alertMessage(alert: MetricAlert, windowHours: number): string {
  const scope = windowHours === 1 ? 'the last hour' : `the last ${windowHours} hours`;
  const mark = alert.severity === 'critical' ? '🔴' : '🟡';
  return `${mark} NavBharatAI Monitor — ${alert.message} (measured over ${scope}). Open Admin → Monitor for the live charts.`;
}

export function resolvedMessage(alertId: string): string {
  const label = alertId
    .split('-')
    .join(' ')
    .replace(/^\w/, (c) => c.toUpperCase());
  return `🟢 NavBharatAI Monitor — resolved: ${label} is back within its normal range.`;
}

export interface AlertSweepDeps {
  /** Read the window under judgement. */
  readSummary: () => Promise<TimelineSummary | null>;
  /** Read + write the notified-state atomically. Returns null when storage is unavailable. */
  readAndWriteState: (mutate: (prev: AlertState, nowMs: number) => AlertActions) => Promise<AlertActions | null>;
  notify: (message: string) => Promise<unknown>;
  now: () => number;
  windowHours: number;
  cooldownMs: number;
}

export interface AlertSweepResult {
  /** Why nothing was sent, when nothing was sent — so a quiet sweep is explainable, not mysterious. */
  skipped?: 'disabled' | 'no-window' | 'no-storage';
  notified: number;
  resolved: number;
}

/** Run one sweep. Never throws — a monitoring job must not be able to take the server down. */
export async function runAlertSweep(deps: AlertSweepDeps): Promise<AlertSweepResult> {
  try {
    const summary = await deps.readSummary();
    const snapshot = snapshotFromWindow(summary);
    // No window, or too few builds to judge: say nothing. Absence of data is not an incident.
    if (!snapshot) return { skipped: 'no-window', notified: 0, resolved: 0 };

    const alerts = evaluateAlerts(snapshot);
    const actions = await deps.readAndWriteState((prev, nowMs) =>
      decideAlertActions(alerts, prev, nowMs, deps.cooldownMs));
    if (!actions) return { skipped: 'no-storage', notified: 0, resolved: 0 };

    for (const a of actions.notify) {
      await deps.notify(alertMessage(a, deps.windowHours)).catch(() => {});
    }
    for (const id of actions.resolved) {
      await deps.notify(resolvedMessage(id)).catch(() => {});
    }
    return { notified: actions.notify.length, resolved: actions.resolved.length };
  } catch {
    return { notified: 0, resolved: 0 };
  }
}

/** Production wiring: the real timeline, a transactional state doc, and the admin's in-app inbox. */
export async function runMonitorAlertSweep(): Promise<AlertSweepResult> {
  if (!alertsEnabled()) return { skipped: 'disabled', notified: 0, resolved: 0 };
  const windowHours = alertWindowHours();

  return runAlertSweep({
    windowHours,
    cooldownMs: alertCooldownMs(),
    now: () => Date.now(),
    readSummary: async () => {
      const series = await metricsTimeline.series(windowHours);
      // An unreadable series has no summary worth judging — availability is checked, not assumed.
      return series.available ? series.summary : null;
    },
    readAndWriteState: async (mutate) => {
      const db = getDb();
      if (!db) return null;
      const ref = db.collection(ALERT_STATE_COLLECTION).doc(ALERT_STATE_DOC);
      try {
        // A TRANSACTION, so several instances sweeping at the same moment send ONE notification
        // between them rather than one each.
        return await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const prev = ((snap.exists ? snap.data()?.alerts : {}) || {}) as AlertState;
          const actions = mutate(prev, Date.now());
          tx.set(ref, { alerts: actions.nextState, updatedAt: Date.now() }, { merge: false });
          return actions;
        });
      } catch {
        return null;
      }
    },
    notify: async (message) => {
      // One in-app notification per admin — the same inbox the NotificationBell already reads.
      for (const email of adminEmailList()) {
        await saveNotification({ message, target: { type: 'user', email }, createdBy: 'monitor' }).catch(() => {});
      }
    },
  });
}

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}
