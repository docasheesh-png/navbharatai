import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  decideAlertActions, snapshotFromWindow, alertMessage, resolvedMessage,
  runAlertSweep, alertCooldownMs, alertWindowHours, alertsEnabled,
  detectSandboxSpike, sandboxSpikeMultiple, sandboxSpikeMinUsd,
  type AlertState,
  alertResolveAfterMs,
  resolvedNoticesEnabled,
} from './monitorAlerts';
import { evaluateAlerts, type MetricAlert } from './metricsAlerts';
import type { TimelineSummary } from './metricsTimeline';

const alert = (id: string, severity: 'critical' | 'warning' = 'critical'): MetricAlert => ({
  id, severity, message: `${id} fired`, metric: id, value: 1, threshold: 0.5,
});

const summary = (over: Partial<TimelineSummary>): TimelineSummary => ({
  builds: 0, buildsOk: 0, buildsFailed: 0, buildMs: 0, previewOk: 0,
  aiRequests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, sandboxSeconds: 0,
  successRate: null, previewRate: null, avgBuildMs: null, costUsd: 0,
  sandboxUsd: null, sandboxRateConfigured: false, ...over,
});

describe('decideAlertActions — announce once, then stay quiet', () => {
  const COOLDOWN = 6 * 60 * 60_000;
  /** The confirmation window an episode must stay clear for before it is declared over. */
  const RESOLVE_AFTER = 2 * 60 * 60_000;

  it('announces a brand-new alert', () => {
    const out = decideAlertActions([alert('high-error-rate')], {}, 1_000, COOLDOWN);
    expect(out.notify.map((a) => a.id)).toEqual(['high-error-rate']);
    expect(out.nextState['high-error-rate'].lastNotifiedAt).toBe(1_000);
  });

  it('does NOT repeat a still-firing alert inside the cooldown', () => {
    // An alerting system that repeats every sweep trains its reader to ignore it.
    const state: AlertState = { 'high-error-rate': { firstSeenAt: 0, lastNotifiedAt: 0 } };
    const out = decideAlertActions([alert('high-error-rate')], state, COOLDOWN - 1, COOLDOWN);
    expect(out.notify).toEqual([]);
    expect(out.nextState['high-error-rate'].lastNotifiedAt).toBe(0); // untouched
  });

  it('repeats once the cooldown has fully elapsed, and keeps the original first-seen time', () => {
    const state: AlertState = { 'high-error-rate': { firstSeenAt: 500, lastNotifiedAt: 500 } };
    const out = decideAlertActions([alert('high-error-rate')], state, 500 + COOLDOWN, COOLDOWN);
    expect(out.notify).toHaveLength(1);
    expect(out.nextState['high-error-rate'].firstSeenAt).toBe(500);
    expect(out.nextState['high-error-rate'].lastNotifiedAt).toBe(500 + COOLDOWN);
  });

  // 🔴 THE ALL-CLEAR IS NOW CONFIRMED BEFORE IT IS SENT, and this test's shape changed with it.
  // It used to assert that a condition absent for a single sweep resolved IMMEDIATELY and was
  // forgotten. That instant forgetting was the flapping bug: the state entry vanished, so the next
  // crossing of the threshold was a BRAND NEW alert that announced itself with no cooldown at all.
  // The admin's inbox (2026-09-12) had ALERT/resolved/Warning/ALERT/resolved inside two hours from
  // exactly this. A condition must now stay clear for the confirmation window before it is over.
  it('🔒 does NOT resolve on the first quiet sweep — it cools first, and says nothing meanwhile', () => {
    const state: AlertState = { 'slow-builds': { firstSeenAt: 0, lastNotifiedAt: 0, notifyCount: 1 } };
    const out = decideAlertActions([], state, 10_000, COOLDOWN, RESOLVE_AFTER);
    expect(out.resolved).toEqual([]);
    expect(out.notify).toEqual([]);
    expect(out.nextState['slow-builds'].clearSince).toBe(10_000);
  });

  it('sends the all-clear once the condition has been clear for the whole window, then forgets it', () => {
    const state: AlertState = { 'slow-builds': { firstSeenAt: 0, lastNotifiedAt: 0, notifyCount: 1, clearSince: 1_000 } };
    const out = decideAlertActions([], state, 1_000 + RESOLVE_AFTER, COOLDOWN, RESOLVE_AFTER);
    expect(out.resolved).toEqual(['slow-builds']);
    expect(out.nextState).toEqual({});
  });

  it('🔒 THE FLAP: stops firing, fires again while cooling — one episode, and NOT ONE extra mail', () => {
    // The exact sequence from the admin's inbox, at the real timings: fires at 0, quiet at 45 min,
    // firing again at 60 min. Old behaviour: resolved mail + a fresh ALERT mail. New: silence.
    let state: AlertState = {};
    const first = decideAlertActions([alert('slow-builds')], state, 0, COOLDOWN, RESOLVE_AFTER);
    expect(first.notify).toHaveLength(1);
    state = first.nextState;

    const dip = decideAlertActions([], state, 45 * 60_000, COOLDOWN, RESOLVE_AFTER);
    expect(dip.resolved).toEqual([]);
    expect(dip.notify).toEqual([]);
    state = dip.nextState;

    const again = decideAlertActions([alert('slow-builds')], state, 60 * 60_000, COOLDOWN, RESOLVE_AFTER);
    expect(again.notify).toEqual([]);           // the whole point
    expect(again.resolved).toEqual([]);
    expect(again.nextState['slow-builds'].clearSince).toBeUndefined();
    expect(again.nextState['slow-builds'].notifyCount).toBe(1);
  });

  it('🔒 TWO MAILS PER EPISODE, EVER — the second after the cooldown, then permanent silence', () => {
    let state: AlertState = decideAlertActions([alert('a')], {}, 0, COOLDOWN, RESOLVE_AFTER).nextState;
    const second = decideAlertActions([alert('a')], state, COOLDOWN, COOLDOWN, RESOLVE_AFTER);
    expect(second.notify).toHaveLength(1);
    expect(second.nextState.a.notifyCount).toBe(2);
    state = second.nextState;
    // A year later, still firing: nothing. A condition nobody fixed is not new information.
    const third = decideAlertActions([alert('a')], state, COOLDOWN * 200, COOLDOWN, RESOLVE_AFTER);
    expect(third.notify).toEqual([]);
    expect(third.nextState.a.notifyCount).toBe(2);
  });

  it('🔒 an escalation SPENDS the second slot rather than being exempt — the cap is absolute', () => {
    const state: AlertState = { a: { firstSeenAt: 0, lastNotifiedAt: 0, severity: 'warning', notifyCount: 2 } };
    const out = decideAlertActions([alert('a', 'critical')], state, 1_000, COOLDOWN, RESOLVE_AFTER);
    expect(out.notify).toEqual([]);
  });

  it('handles several alerts independently in one sweep', () => {
    const state: AlertState = {
      a: { firstSeenAt: 0, lastNotifiedAt: 0, notifyCount: 1 },
      gone: { firstSeenAt: 0, lastNotifiedAt: 0, notifyCount: 1, clearSince: 0 },
    };
    const out = decideAlertActions([alert('a'), alert('b')], state, RESOLVE_AFTER, COOLDOWN, RESOLVE_AFTER);
    expect(out.notify.map((x) => x.id)).toEqual(['b']);   // 'a' is inside its cooldown
    expect(out.resolved).toEqual(['gone']);               // clear for the whole window
    expect(Object.keys(out.nextState).sort()).toEqual(['a', 'b']);
  });

  it('🔒 breaks the cooldown when a warning becomes CRITICAL', () => {
    // Before this, an alert announced as a warning stayed silent for the rest of the quiet period —
    // six hours by default — however much worse it got. `slow-builds` has had both severities since it
    // was written (10 min / 20 min), so builds could go from 11 minutes to half an hour, in the window
    // where the admin most needs to hear from us, with nothing said.
    const state: AlertState = { 'slow-builds': { firstSeenAt: 0, lastNotifiedAt: 0, severity: 'warning' } };
    const out = decideAlertActions([alert('slow-builds', 'critical')], state, 1_000, COOLDOWN);
    expect(out.notify).toHaveLength(1);
    expect(out.nextState['slow-builds'].severity).toBe('critical');
    expect(out.nextState['slow-builds'].firstSeenAt).toBe(0);   // same episode, not a new one
    expect(out.resolved).toEqual([]);                            // it escalated; it did not recover
  });

  it('🔒 a legacy state entry with no recorded severity is NOT read as an escalation', () => {
    // Every entry written before the field existed lacks it. Reading "unknown" as "was a warning"
    // would make every currently-critical alert announce itself once more on the first sweep after
    // deploy — a burst of notifications caused by shipping, about nothing that changed.
    const state: AlertState = { 'high-error-rate': { firstSeenAt: 0, lastNotifiedAt: 0 } };
    const out = decideAlertActions([alert('high-error-rate', 'critical')], state, 1_000, COOLDOWN);
    expect(out.notify).toEqual([]);
    // …but the field is backfilled, so a genuine escalation is caught from the next sweep onwards.
    expect(out.nextState['high-error-rate'].severity).toBe('critical');
    expect(out.nextState['high-error-rate'].lastNotifiedAt).toBe(0);  // still not "announced"
  });

  it('🔒 cannot be made to flap across a threshold', () => {
    // An episode announces its escalation ONCE. Otherwise a condition sitting on the boundary would
    // notify on every crossing — exactly the noise this module exists to prevent.
    const state: AlertState = { 'slow-builds': { firstSeenAt: 0, lastNotifiedAt: 0, severity: 'critical' } };
    const down = decideAlertActions([alert('slow-builds', 'warning')], state, 1_000, COOLDOWN);
    expect(down.notify).toEqual([]);
    expect(down.nextState['slow-builds'].severity).toBe('critical');  // high-water mark, never lowered
    const up = decideAlertActions([alert('slow-builds', 'critical')], down.nextState, 2_000, COOLDOWN);
    expect(up.notify).toEqual([]);
  });

  it('survives empty input on both sides', () => {
    const out = decideAlertActions([], {}, 1, COOLDOWN);
    expect(out).toEqual({ notify: [], resolved: [], nextState: {} });
  });
});

describe('snapshotFromWindow — never judge on missing data', () => {
  it('refuses to produce a verdict when the window has no builds', () => {
    expect(snapshotFromWindow(summary({ builds: 0 }))).toBeNull();
    expect(snapshotFromWindow(null)).toBeNull();
    expect(snapshotFromWindow(undefined)).toBeNull();
  });

  it('feeds the EXISTING rules engine, so thresholds are never restated in two places', () => {
    // 20 builds, 5 failed = 25% failure — over the 10% threshold the shared evaluator owns.
    const snap = snapshotFromWindow(summary({
      builds: 20, buildsOk: 15, buildsFailed: 5, previewOk: 19,
      buildMs: 200_000, successRate: 0.75, previewRate: 0.95, avgBuildMs: 10_000,
    }));
    expect(snap).not.toBeNull();
    const ids = evaluateAlerts(snap!).map((a) => a.id);
    expect(ids).toContain('high-error-rate');
  });

  it('produces no alert for a healthy window', () => {
    const snap = snapshotFromWindow(summary({
      builds: 20, buildsOk: 20, buildsFailed: 0, previewOk: 20,
      buildMs: 100_000, successRate: 1, previewRate: 1, avgBuildMs: 5_000,
    }));
    expect(evaluateAlerts(snap!)).toEqual([]);
  });
});

describe('alert messages', () => {
  it('names the window so the number is interpretable', () => {
    expect(alertMessage(alert('high-error-rate'), 1)).toContain('the last hour');
    expect(alertMessage(alert('high-error-rate'), 6)).toContain('the last 6 hours');
  });

  it('marks severity and points at where to look', () => {
    expect(alertMessage(alert('x', 'critical'), 1)).toContain('🔴');
    expect(alertMessage(alert('x', 'warning'), 1)).toContain('🟡');
    expect(alertMessage(alert('x'), 1)).toContain('Admin → Monitor');
  });

  it('reads as an all-clear on recovery', () => {
    expect(resolvedMessage('high-error-rate')).toContain('🟢');
    expect(resolvedMessage('high-error-rate')).toContain('resolved');
  });

  it('carries no provider or model name — the alert text is generic by construction', () => {
    const text = alertMessage(alert('high-error-rate'), 1) + resolvedMessage('slow-builds');
    for (const vendor of ['glm', 'kimi', 'claude', 'sonnet', 'opus', 'gemini', 'grok']) {
      expect(text.toLowerCase()).not.toContain(vendor);
    }
  });
});

describe('runAlertSweep — the honesty rules', () => {
  const baseDeps = {
    now: () => 1_000,
    windowHours: 1,
    cooldownMs: 60_000,
    notify: async () => undefined,
    readAndWriteState: async (mutate: any) => mutate({}, 1_000),
    readSummary: async () => summary({ builds: 0 }),
  };

  it('says NOTHING when the window cannot be judged — absence is not an incident', async () => {
    const sent: string[] = [];
    const res = await runAlertSweep({ ...baseDeps, notify: async (m) => { sent.push(m); } });
    expect(res.skipped).toBe('no-window');
    expect(sent).toEqual([]);
  });

  it('says NOTHING when the state store is unavailable, rather than re-announcing every sweep', async () => {
    const sent: string[] = [];
    const res = await runAlertSweep({
      ...baseDeps,
      readSummary: async () => summary({ builds: 20, buildsOk: 5, buildsFailed: 15, previewOk: 20, buildMs: 100_000, successRate: 0.25, previewRate: 1, avgBuildMs: 5_000 }),
      readAndWriteState: async () => null,
      notify: async (m) => { sent.push(m); },
    });
    expect(res.skipped).toBe('no-storage');
    expect(sent).toEqual([]);
  });

  it('notifies on a genuinely bad window', async () => {
    const sent: string[] = [];
    const res = await runAlertSweep({
      ...baseDeps,
      readSummary: async () => summary({ builds: 20, buildsOk: 5, buildsFailed: 15, previewOk: 20, buildMs: 100_000, successRate: 0.25, previewRate: 1, avgBuildMs: 5_000 }),
      notify: async (m) => { sent.push(m); },
    });
    expect(res.notified).toBeGreaterThan(0);
    expect(sent.join(' ')).toContain('Monitor');
  });

  it('a failing notifier can never take the sweep (or the server) down', async () => {
    const res = await runAlertSweep({
      ...baseDeps,
      readSummary: async () => summary({ builds: 20, buildsOk: 5, buildsFailed: 15, previewOk: 20, buildMs: 100_000, successRate: 0.25, previewRate: 1, avgBuildMs: 5_000 }),
      notify: async () => { throw new Error('inbox down'); },
    });
    expect(res.notified).toBeGreaterThan(0); // decided correctly; delivery failure is swallowed
  });

  it('a throwing reader is contained', async () => {
    const res = await runAlertSweep({ ...baseDeps, readSummary: async () => { throw new Error('boom'); } });
    expect(res).toEqual({ notified: 0, resolved: 0 });
  });
});

describe('monitorAlerts — configuration', () => {
  it('is ON unless explicitly switched off', () => {
    const prev = process.env.MONITOR_ALERTS;
    delete process.env.MONITOR_ALERTS;
    expect(alertsEnabled()).toBe(true);
    process.env.MONITOR_ALERTS = 'off';
    expect(alertsEnabled()).toBe(false);
    if (prev === undefined) delete process.env.MONITOR_ALERTS; else process.env.MONITOR_ALERTS = prev;
  });

  it('clamps the cooldown and window to sane values', () => {
    const prevC = process.env.MONITOR_ALERT_COOLDOWN_MINUTES;
    const prevW = process.env.MONITOR_ALERT_WINDOW_HOURS;
    process.env.MONITOR_ALERT_COOLDOWN_MINUTES = '1';       // too chatty
    expect(alertCooldownMs()).toBe(15 * 60_000);
    process.env.MONITOR_ALERT_COOLDOWN_MINUTES = 'abc';
    // 🔴 DEFAULT RAISED 6h → 48h (admin 2026-09-12: "maximum 2 — woh bhi 48hr baad").
    expect(alertCooldownMs()).toBe(48 * 60 * 60_000);
    process.env.MONITOR_ALERT_WINDOW_HOURS = '999';
    expect(alertWindowHours()).toBe(24);
    // 48h is inside the new ceiling — the old one capped at 24h and would have silently halved it.
    process.env.MONITOR_ALERT_COOLDOWN_MINUTES = String(48 * 60);
    expect(alertCooldownMs()).toBe(48 * 60 * 60_000);
    if (prevC === undefined) delete process.env.MONITOR_ALERT_COOLDOWN_MINUTES; else process.env.MONITOR_ALERT_COOLDOWN_MINUTES = prevC;
    if (prevW === undefined) delete process.env.MONITOR_ALERT_WINDOW_HOURS; else process.env.MONITOR_ALERT_WINDOW_HOURS = prevW;
  });
});

describe('the all-clear window and switch', () => {
  const keys = ['MONITOR_ALERT_RESOLVE_AFTER_MINUTES', 'MONITOR_ALERT_RESOLVED'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('defaults to two hours — twice the window the metrics are judged over, so a wobble cannot end an episode', () => {
    expect(alertResolveAfterMs()).toBe(120 * 60_000);
  });

  it('clamps, and an unreadable value falls back to the default rather than to zero', () => {
    process.env.MONITOR_ALERT_RESOLVE_AFTER_MINUTES = '1';
    expect(alertResolveAfterMs()).toBe(15 * 60_000);
    process.env.MONITOR_ALERT_RESOLVE_AFTER_MINUTES = 'abc';
    expect(alertResolveAfterMs()).toBe(120 * 60_000);
  });

  it('🔒 zero would make every dip an instant all-clear — the exact bug — so it is refused', () => {
    process.env.MONITOR_ALERT_RESOLVE_AFTER_MINUTES = '0';
    expect(alertResolveAfterMs()).toBe(120 * 60_000);
  });

  it('all-clear mails are ON unless explicitly turned off', () => {
    expect(resolvedNoticesEnabled()).toBe(true);
    process.env.MONITOR_ALERT_RESOLVED = 'off';
    expect(resolvedNoticesEnabled()).toBe(false);
    process.env.MONITOR_ALERT_RESOLVED = ' OFF ';
    expect(resolvedNoticesEnabled()).toBe(false);
  });
});

describe('detectSandboxSpike — the VM bill alarm', () => {
  const opts = { multiple: 3, minUsd: 1 };

  it('fires when recent VM spend is several times the previous window', () => {
    const a = detectSandboxSpike({ recentUsd: 12, baselineUsd: 3, ...opts });
    expect(a).not.toBeNull();
    expect(a!.id).toBe('sandbox-cost-spike');
    expect(a!.message).toContain('4.0×');
  });

  it('stays silent below the multiple', () => {
    expect(detectSandboxSpike({ recentUsd: 5, baselineUsd: 3, ...opts })).toBeNull();
  });

  it('ignores a big MULTIPLE on trivial money — ₹2 to ₹6 is not an incident', () => {
    // Without this guard the alert fires on almost every quiet-then-busy hour and stops being read.
    expect(detectSandboxSpike({ recentUsd: 0.6, baselineUsd: 0.1, ...opts })).toBeNull();
  });

  it('treats a zero baseline as "nothing to compare", not as an infinite spike', () => {
    expect(detectSandboxSpike({ recentUsd: 50, baselineUsd: 0, ...opts })).toBeNull();
  });

  it('says nothing when VM time was never priced — no rate, no money to compare', () => {
    expect(detectSandboxSpike({ recentUsd: null, baselineUsd: 3, ...opts })).toBeNull();
    expect(detectSandboxSpike({ recentUsd: 12, baselineUsd: null, ...opts })).toBeNull();
  });

  it('survives nonsense numbers instead of alerting on them', () => {
    expect(detectSandboxSpike({ recentUsd: NaN, baselineUsd: 3, ...opts })).toBeNull();
    expect(detectSandboxSpike({ recentUsd: 12, baselineUsd: Infinity, ...opts })).toBeNull();
  });

  it('names it as OUR infrastructure, so it is never mistaken for a user charge', () => {
    const a = detectSandboxSpike({ recentUsd: 12, baselineUsd: 3, ...opts });
    expect(a!.message).toContain('not a user charge');
  });

  it('has sane, clamped configuration', () => {
    const prevM = process.env.MONITOR_SANDBOX_SPIKE_MULTIPLE;
    const prevU = process.env.MONITOR_SANDBOX_SPIKE_MIN_USD;
    delete process.env.MONITOR_SANDBOX_SPIKE_MULTIPLE;
    delete process.env.MONITOR_SANDBOX_SPIKE_MIN_USD;
    expect(sandboxSpikeMultiple()).toBe(3);
    expect(sandboxSpikeMinUsd()).toBe(1);
    process.env.MONITOR_SANDBOX_SPIKE_MULTIPLE = '0.5';   // would fire constantly
    expect(sandboxSpikeMultiple()).toBe(3);
    process.env.MONITOR_SANDBOX_SPIKE_MULTIPLE = '999';
    expect(sandboxSpikeMultiple()).toBe(20);
    if (prevM === undefined) delete process.env.MONITOR_SANDBOX_SPIKE_MULTIPLE; else process.env.MONITOR_SANDBOX_SPIKE_MULTIPLE = prevM;
    if (prevU === undefined) delete process.env.MONITOR_SANDBOX_SPIKE_MIN_USD; else process.env.MONITOR_SANDBOX_SPIKE_MIN_USD = prevU;
  });
});

describe('runAlertSweep — a cost spike is real even with no builds', () => {
  const base = {
    now: () => 1_000,
    windowHours: 1,
    cooldownMs: 60_000,
    notify: async () => undefined,
    readAndWriteState: async (mutate: any) => mutate({}, 1_000),
    readSummary: async () => summary({ builds: 0 }),
  };

  it('notifies about an idle VM burning money even though no build ran', () => {
    // An idle VM burning money with nobody building is EXACTLY the case worth hearing about, so the
    // cost alert must not be gated on the build window being judgeable.
    const sent: string[] = [];
    return runAlertSweep({
      ...base,
      notify: async (m) => { sent.push(m); },
      extraAlerts: async () => [{
        id: 'sandbox-cost-spike', severity: 'warning' as const,
        message: 'VM spend spiked', metric: 'sandbox.costUsd', value: 4, threshold: 3,
      }],
    }).then((res) => {
      expect(res.notified).toBe(1);
      expect(sent[0]).toContain('VM spend spiked');
    });
  });

  it('a failing extra-alert source cannot break the sweep', async () => {
    const res = await runAlertSweep({
      ...base,
      extraAlerts: async () => { throw new Error('timeline down'); },
    });
    expect(res.skipped).toBe('no-window');
  });
});
