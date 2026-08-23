import { describe, it, expect } from 'vitest';
import {
  decideAlertActions, snapshotFromWindow, alertMessage, resolvedMessage,
  runAlertSweep, alertCooldownMs, alertWindowHours, alertsEnabled,
  detectSandboxSpike, sandboxSpikeMultiple, sandboxSpikeMinUsd,
  type AlertState,
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

  it('sends the all-clear when a condition stops firing, and forgets it', () => {
    // Without this the admin cannot tell "fixed" from "still broken and I stopped being told".
    const state: AlertState = { 'slow-builds': { firstSeenAt: 0, lastNotifiedAt: 0 } };
    const out = decideAlertActions([], state, 10_000, COOLDOWN);
    expect(out.resolved).toEqual(['slow-builds']);
    expect(out.nextState).toEqual({});
  });

  it('handles several alerts independently in one sweep', () => {
    const state: AlertState = { a: { firstSeenAt: 0, lastNotifiedAt: 0 }, gone: { firstSeenAt: 0, lastNotifiedAt: 0 } };
    const out = decideAlertActions([alert('a'), alert('b')], state, 1_000, COOLDOWN);
    expect(out.notify.map((x) => x.id)).toEqual(['b']);   // 'a' is inside its cooldown
    expect(out.resolved).toEqual(['gone']);
    expect(Object.keys(out.nextState).sort()).toEqual(['a', 'b']);
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
    expect(alertCooldownMs()).toBe(360 * 60_000);           // default 6h
    process.env.MONITOR_ALERT_WINDOW_HOURS = '999';
    expect(alertWindowHours()).toBe(24);
    if (prevC === undefined) delete process.env.MONITOR_ALERT_COOLDOWN_MINUTES; else process.env.MONITOR_ALERT_COOLDOWN_MINUTES = prevC;
    if (prevW === undefined) delete process.env.MONITOR_ALERT_WINDOW_HOURS; else process.env.MONITOR_ALERT_WINDOW_HOURS = prevW;
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
