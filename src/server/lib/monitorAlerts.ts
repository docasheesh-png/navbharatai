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
import { evaluateAlerts, type MetricAlert, type AlertSeverity } from './metricsAlerts';
import type { MetricsSnapshot } from './metrics';
import { metricsTimeline, summarize, type TimelineSummary } from './metricsTimeline';
import { saveNotification } from './AdminNotificationStore';
import { adminEmailList } from './adminEmails';
import { resolveEmailConfig, sendAlertEmail } from './alertEmail';
import { capacityExtraAlerts } from './publishCapacityAlerts';

export const ALERT_STATE_COLLECTION = 'monitor_alert_state';
export const ALERT_STATE_DOC = 'current';

/**
 * How long an alert that keeps firing stays quiet after being announced once.
 *
 * 🔴 DEFAULT 48 HOURS (admin-mandated 2026-09-12: "ek information ke liye bas 1 mail only. agar jyada
 * jaruri hai, to maximum 2 — woh bhi 48hr baad"). It was six hours, which — combined with the
 * flapping bug fixed below — put five mails in the admin's inbox in two hours about ONE condition.
 * A monitoring system nobody reads is worse than none, because it trains the reader to ignore the
 * one mail that mattered.
 */
export function alertCooldownMs(): number {
  const raw = Number(process.env.MONITOR_ALERT_COOLDOWN_MINUTES);
  const mins = Number.isFinite(raw) && raw > 0 ? Math.min(7 * 24 * 60, Math.max(15, Math.floor(raw))) : 48 * 60;
  return mins * 60_000;
}

/**
 * The HARD CAP on how many times one episode may interrupt the admin. Two, and the second only after
 * the cooldown above — so a condition that fires and never clears costs exactly two mails, ever.
 *
 * 🔒 An ESCALATION (warning → critical) spends the SECOND slot rather than being exempt from the cap.
 * "Maximum 2" is the instruction, and an exemption is how a cap quietly becomes a suggestion.
 */
export const MAX_NOTIFICATIONS_PER_EPISODE = 2;

/**
 * How long a condition must stay CONTINUOUSLY clear before the episode is declared over.
 *
 * 🔴 THIS IS THE FLAPPING FIX, and it is the real root cause of the admin's inbox. Resolving used to
 * DELETE the alert's state, so the cooldown — the entire anti-noise mechanism — was bypassed by the
 * very thing it was meant to survive: an average hovering at its threshold resolved, forgot it had
 * ever fired, and the next crossing was a BRAND NEW alert that announced itself immediately. Two
 * mails per wobble, with no quiet period at any point. Now a condition that stops firing enters a
 * cooling period instead; re-firing inside it is the SAME episode and says nothing at all.
 *
 * Default two hours = twice the one-hour window the metrics are judged over, so a wobble inside one
 * window cannot possibly end an episode. An all-clear is never urgent, so waiting costs nothing.
 */
export function alertResolveAfterMs(): number {
  const raw = Number(process.env.MONITOR_ALERT_RESOLVE_AFTER_MINUTES);
  const mins = Number.isFinite(raw) && raw > 0 ? Math.min(24 * 60, Math.max(15, Math.floor(raw))) : 120;
  return mins * 60_000;
}

/** The all-clear mail. On by default; `off` keeps the alert mails and drops the "it is over" ones. */
export function resolvedNoticesEnabled(): boolean {
  return String(process.env.MONITOR_ALERT_RESOLVED ?? '').trim().toLowerCase() !== 'off';
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
  /**
   * The HIGHEST severity announced so far for this firing episode — not the severity last observed.
   *
   * That distinction is the whole reason the field exists. Storing "what we saw last time" would let
   * an alert flap across a threshold (11 min → critical → 9 min → warning → 11 min) and notify on
   * every crossing, which is the noise this module was built to prevent. Storing "the worst we have
   * already said out loud" means an episode announces its escalation exactly once.
   *
   * Optional because state written before this field existed does not have it. A legacy entry that is
   * currently critical therefore announces its escalation once, on the first sweep after deploy — a
   * single notification about a genuinely critical condition, which is the right side to err on.
   */
  severity?: AlertSeverity;
  /**
   * How many mails this EPISODE has already sent, capped at MAX_NOTIFICATIONS_PER_EPISODE.
   *
   * Optional because state written before this field existed does not have it; a legacy entry is read
   * as having sent ONE, which is both true and the safe side — it can still send its 48-hour
   * follow-up, and it can never exceed the cap.
   */
  notifyCount?: number;
  /**
   * When the condition STOPPED firing, while the episode is cooling. Absent means it is firing now.
   *
   * The presence of this field is what makes a flap silent: the entry still exists, so a re-fire is a
   * continuation rather than a new alert.
   */
  clearSince?: number;
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
  resolveAfterMs: number = alertResolveAfterMs(),
): AlertActions {
  const firing = new Map((current || []).map((a) => [a.id, a]));
  const prev = state || {};
  const notify: MetricAlert[] = [];
  const resolved: string[] = [];
  const nextState: AlertState = {};

  for (const [id, alert] of firing) {
    const seen = prev[id];
    if (!seen) {
      // Brand new episode — announce it. This is mail 1 of at most 2.
      notify.push(alert);
      nextState[id] = { firstSeenAt: nowMs, lastNotifiedAt: nowMs, severity: alert.severity, notifyCount: 1 };
      continue;
    }

    // 🔒 RE-FIRING DURING THE COOLING PERIOD IS THE SAME EPISODE, AND IT SAYS NOTHING.
    // This is the line that ends the flapping: an average wobbling across its threshold no longer
    // produces "resolved … ALERT … resolved … ALERT". `clearSince` is dropped because it is firing
    // again, and nothing is announced because this episode has already had its say.
    const sent = seen.notifyCount ?? 1;
    const escalated = alert.severity === 'critical' && seen.severity === 'warning';
    const dueAgain = nowMs - seen.lastNotifiedAt >= cooldownMs;

    if (sent < MAX_NOTIFICATIONS_PER_EPISODE && (escalated || dueAgain)) {
      // Either it got worse, or it is still firing a full cooldown later. Either way this is the
      // SECOND and FINAL mail for this episode — the cap is absolute, escalation included.
      notify.push(alert);
      nextState[id] = {
        firstSeenAt: seen.firstSeenAt,
        lastNotifiedAt: nowMs,
        // Never downgrade the recorded high-water mark: an episode that has already announced
        // 'critical' must not be able to announce it again by dipping to 'warning' and back.
        severity: seen.severity === 'critical' ? 'critical' : alert.severity,
        notifyCount: sent + 1,
      };
      continue;
    }

    // Firing, already announced, and either inside the quiet period or out of mail budget. The
    // recorded severity is deliberately left ALONE — it records what was announced, and staying quiet
    // announced nothing. The ONE exception is backfilling a legacy entry that has no severity at all,
    // which costs nothing and is what lets the escalation check work for alerts already firing at
    // deploy time. `clearSince` is dropped: it is firing.
    const { clearSince: _wasClear, ...rest } = seen;
    void _wasClear;
    nextState[id] = { ...rest, severity: seen.severity ?? alert.severity, notifyCount: sent };
  }

  // Everything that was in the state and is NOT firing right now.
  for (const [id, seen] of Object.entries(prev)) {
    if (firing.has(id)) continue;
    const clearSince = seen.clearSince ?? nowMs;
    if (nowMs - clearSince >= resolveAfterMs) {
      // Continuously clear for the whole confirmation window — the episode is genuinely over, so say
      // so ONCE and forget it. The next occurrence is then a real new episode, as it should be.
      resolved.push(id);
      continue;
    }
    // Still cooling. Say NOTHING and keep the entry, so a re-fire is a continuation rather than news.
    nextState[id] = { ...seen, clearSince };
  }

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

/**
 * VM-COST SPIKE — the alert that exists because this is the admin's largest bill.
 *
 * E2B is measured at roughly ₹15,000/month, and nothing in the product would have said a word if it
 * doubled overnight. Token spend has an alert of sorts (FinOps findings); the VM bill had nothing.
 *
 * It compares the RECENT window against the SAME-LENGTH window before it, so it needs no stored
 * baseline and no notion of a "normal day" — a comparison the data itself supplies. Two guards keep
 * it from crying wolf:
 *   • a MINIMUM absolute spend, so a jump from ₹2 to ₹6 (a 3× rise, and completely uninteresting)
 *     stays silent, and
 *   • a quiet baseline is not a spike: with nothing to compare against, we say nothing rather than
 *     treating "the first activity in a while" as an incident.
 *
 * Pure.
 */
export function detectSandboxSpike(opts: {
  recentUsd: number | null;
  baselineUsd: number | null;
  multiple: number;
  minUsd: number;
}): MetricAlert | null {
  const { recentUsd, baselineUsd, multiple, minUsd } = opts;
  // A null on either side means the rate is not configured, so there is no money to compare.
  if (recentUsd == null || baselineUsd == null) return null;
  if (!Number.isFinite(recentUsd) || !Number.isFinite(baselineUsd)) return null;
  if (recentUsd < minUsd) return null;          // too small to be worth waking anyone for
  if (baselineUsd <= 0) return null;            // nothing to compare against — not a spike
  const ratio = recentUsd / baselineUsd;
  if (ratio < multiple) return null;
  return {
    id: 'sandbox-cost-spike',
    severity: 'warning',
    message: `Build-machine (VM) spend is ${ratio.toFixed(1)}× the previous window — $${recentUsd.toFixed(2)} against $${baselineUsd.toFixed(2)}. This is our infrastructure bill, not a user charge.`,
    metric: 'sandbox.costUsd',
    value: Math.round(ratio * 100) / 100,
    threshold: multiple,
  };
}

/** How many times the previous window's VM spend counts as a spike. */
export function sandboxSpikeMultiple(): number {
  const raw = Number(process.env.MONITOR_SANDBOX_SPIKE_MULTIPLE);
  return Number.isFinite(raw) && raw > 1 ? Math.min(20, raw) : 3;
}

/** Below this much spend in the window, a spike is not worth a notification. */
export function sandboxSpikeMinUsd(): number {
  const raw = Number(process.env.MONITOR_SANDBOX_SPIKE_MIN_USD);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1;
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
  /** How long a condition must stay clear before its episode is declared over. */
  resolveAfterMs?: number;
  /** Send the all-clear mail at all. Default true. */
  resolvedNotices?: boolean;
  /**
   * Alerts that come from somewhere other than the build-rate rules (today: the VM-cost spike).
   *
   * They join the SAME notify/cooldown/all-clear machinery rather than getting their own delivery
   * path — a second notifier would mean a second set of dedupe bugs, and the admin would have no way
   * to tell why one kind of alert repeats and another does not.
   */
  extraAlerts?: () => Promise<MetricAlert[]>;
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
    const extra = await (deps.extraAlerts ? deps.extraAlerts().catch(() => []) : Promise.resolve([]));
    const snapshot = snapshotFromWindow(summary);
    // No window, or too few builds to judge: say nothing about BUILD health. A cost spike is still
    // real without builds in the window — an idle VM burning money is exactly the case worth hearing
    // about — so the extra alerts are not gated on it.
    if (!snapshot && extra.length === 0) return { skipped: 'no-window', notified: 0, resolved: 0 };

    const alerts = [...(snapshot ? evaluateAlerts(snapshot) : []), ...extra];
    const actions = await deps.readAndWriteState((prev, nowMs) =>
      decideAlertActions(alerts, prev, nowMs, deps.cooldownMs, deps.resolveAfterMs));
    if (!actions) return { skipped: 'no-storage', notified: 0, resolved: 0 };

    for (const a of actions.notify) {
      await deps.notify(alertMessage(a, deps.windowHours)).catch(() => {});
    }
    // The all-clear. One per EPISODE by construction (the entry only reaches `resolved` after the
    // condition has been continuously clear for the confirmation window), and droppable entirely for
    // an admin who wants alerts but not their endings.
    const announceResolved = deps.resolvedNotices ?? true;
    for (const id of actions.resolved) {
      if (!announceResolved) break;
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
    resolveAfterMs: alertResolveAfterMs(),
    resolvedNotices: resolvedNoticesEnabled(),
    now: () => Date.now(),
    readSummary: async () => {
      const series = await metricsTimeline.series(windowHours);
      // An unreadable series has no summary worth judging — availability is checked, not assumed.
      return series.available ? series.summary : null;
    },
    extraAlerts: async () => {
      // Compare the recent window against the SAME-LENGTH window immediately before it. Reading a
      // double-length series and splitting it costs ONE query instead of two, and guarantees both
      // halves come from the same read — two reads could straddle a bucket flush and disagree.
      const doubled = await metricsTimeline.series(windowHours * 2);
      if (!doubled.available || doubled.points.length < 2) return [];
      const half = Math.floor(doubled.points.length / 2);
      const baseline = summarize(doubled.points.slice(0, half));
      const recent = summarize(doubled.points.slice(half));
      const spike = detectSandboxSpike({
        recentUsd: recent.sandboxUsd,
        baselineUsd: baseline.sandboxUsd,
        multiple: sandboxSpikeMultiple(),
        minUsd: sandboxSpikeMinUsd(),
      });
      // PUBLISH CAPACITY joins here rather than getting its own delivery path, for the reason stated
      // on extraAlerts: a second notifier would mean a second set of dedupe bugs. It probes on its own
      // much slower cadence (the inventory costs a Hosting API call plus a 500-record Firestore read)
      // and re-emits what it last MEASURED in between — see publishCapacityAlerts.ts for why a skipped
      // probe must never look like a recovery.
      const capacity = await capacityExtraAlerts().catch(() => [] as MetricAlert[]);
      return [...(spike ? [spike] : []), ...capacity];
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
      // THE BELL FIRST, ALWAYS. It is the delivery path that is guaranteed to exist, so it must not
      // depend on an optional one: an email provider being down, slow or misconfigured can never cost
      // the admin the in-app notification.
      for (const email of adminEmailList()) {
        await saveNotification({ message, target: { type: 'user', email }, createdBy: 'monitor' }).catch(() => {});
      }
      // …then email, IF it is configured. An unconfigured provider is a no-op here and an honest
      // "not configured" line on the Monitor — never a silent failure and never a false "sent".
      const cfg = resolveEmailConfig();
      if (!cfg.configured) return;
      const result = await sendAlertEmail(cfg, message).catch((err) => ({ sent: false, error: String(err) }));
      if (!result.sent) {
        // Logged, not swallowed: an alerting channel that fails quietly is how alerting rots.
        console.warn('[MONITOR-ALERT] email delivery failed:', result.error);
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
