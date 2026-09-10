import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  shouldProbeCapacity,
  capacityAlertsFrom,
  capacityAlertsEnabled,
  capacityProbeIntervalMs,
  capacityExtraAlerts,
  __setCapacityCache,
  __getCapacityCache,
  type CapacityProbe,
} from './publishCapacityAlerts';
import { publishCapacityAlert } from '../AgentV3/channelInventory';
import { decideAlertActions } from './monitorAlerts';
import type { MetricAlert } from './metricsAlerts';

const warnAlert: MetricAlert = {
  id: 'publish-capacity', severity: 'warning', message: 'filling up', metric: 'hosting.channelsUsed',
  value: 36, threshold: 50,
};

describe('publishCapacityAlert — speaks only about a number it read', () => {
  it('says NOTHING when the platform is healthy', () => {
    expect(publishCapacityAlert({
      used: 4, cap: 50, remaining: 46, reclaimable: 0, level: 'ok', message: '',
    })).toBeNull();
  });

  it('warns with the numbers the admin needs to act on', () => {
    const a = publishCapacityAlert({
      used: 36, cap: 50, remaining: 14, reclaimable: 3, level: 'warn', message: '',
    })!;
    expect(a.severity).toBe('warning');
    expect(a.message).toContain('36');
    expect(a.message).toContain('14');
    expect(a.message).toContain('3 can be reclaimed');
    expect(a.value).toBe(36);
    expect(a.threshold).toBe(50);
  });

  it('escalates to critical, and names the blast radius — EVERY user', () => {
    const a = publishCapacityAlert({
      used: 47, cap: 50, remaining: 3, reclaimable: 0, level: 'critical', message: '',
    })!;
    expect(a.severity).toBe('critical');
    expect(a.message).toContain('EVERY user');
    // No reclaim hint when there is nothing to reclaim — an instruction that does nothing is worse
    // than none at a moment when the admin is acting under pressure.
    expect(a.message).not.toContain('reclaimed');
  });

  it('🔒 uses ONE id across both severities', () => {
    // Two ids would make an escalation look like one condition recovering while another appeared: the
    // admin would receive a green all-clear at the exact moment things got worse.
    const warn = publishCapacityAlert({ used: 36, cap: 50, remaining: 14, reclaimable: 0, level: 'warn', message: '' })!;
    const crit = publishCapacityAlert({ used: 47, cap: 50, remaining: 3, reclaimable: 0, level: 'critical', message: '' })!;
    expect(warn.id).toBe(crit.id);
  });
});

describe('shouldProbeCapacity', () => {
  it('probes when nothing has ever been measured', () => {
    expect(shouldProbeCapacity(null, 1_000, 60_000)).toBe(true);
  });

  it('waits out the interval, then probes again', () => {
    const cache: CapacityProbe = { at: 1_000, alert: null };
    expect(shouldProbeCapacity(cache, 30_000, 60_000)).toBe(false);
    expect(shouldProbeCapacity(cache, 61_000, 60_000)).toBe(true);
  });
});

describe('capacityAlertsFrom — a skipped or failed probe is NOT a recovery', () => {
  it('emits nothing when nothing has ever been measured', () => {
    expect(capacityAlertsFrom(null)).toEqual([]);
  });

  it('emits nothing when the last measurement found the platform healthy', () => {
    expect(capacityAlertsFrom({ at: 1, alert: null })).toEqual([]);
  });

  it('🔒 keeps re-emitting the last MEASURED alert, however old the cache is', () => {
    // This is the whole point of the module. An alert absent from a sweep is treated as resolved and
    // sends a green all-clear — so going quiet between probes would announce a recovery nobody
    // measured, at the moment the number is least trustworthy.
    const cache: CapacityProbe = { at: 0, alert: warnAlert };
    expect(capacityAlertsFrom(cache)).toEqual([warnAlert]);
    expect(capacityAlertsFrom({ ...cache, at: -999_999_999 })).toEqual([warnAlert]);
  });
});

describe('capacityExtraAlerts — cache lifecycle', () => {
  const saved = { ...process.env };
  beforeEach(() => { __setCapacityCache(null); });
  afterEach(() => { process.env = { ...saved }; __setCapacityCache(null); });

  it('is silent and does not probe when switched off', async () => {
    process.env.MONITOR_CAPACITY_ALERTS = 'off';
    expect(capacityAlertsEnabled()).toBe(false);
    await expect(capacityExtraAlerts()).resolves.toEqual([]);
    expect(__getCapacityCache()).toBeNull();
  });

  it('🔒 a FAILED probe leaves a standing alert standing', async () => {
    // Under vitest there is no Firebase app, so probeCapacity really fails — this exercises the real
    // failure path, not a mock of it. The pre-existing alert must survive it.
    __setCapacityCache({ at: 0, alert: warnAlert });
    const out = await capacityExtraAlerts(() => 10 * 60 * 60_000);
    expect(out).toEqual([warnAlert]);
    // And the cache keeps its ORIGINAL timestamp: a failed probe is not a measurement, so it must not
    // reset the clock and buy itself another quiet hour.
    expect(__getCapacityCache()).toEqual({ at: 0, alert: warnAlert });
  });

  it('a failed probe with no history stays silent rather than inventing an alert', async () => {
    await expect(capacityExtraAlerts()).resolves.toEqual([]);
    expect(__getCapacityCache()).toBeNull();
  });

  it('never throws — a monitoring path must not be able to take the server down', async () => {
    await expect(capacityExtraAlerts()).resolves.toBeInstanceOf(Array);
  });
});

describe('configuration', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('defaults to an hour and clamps anything absurd', () => {
    delete process.env.MONITOR_CAPACITY_PROBE_MINUTES;
    expect(capacityProbeIntervalMs()).toBe(60 * 60_000);
    process.env.MONITOR_CAPACITY_PROBE_MINUTES = '1';
    expect(capacityProbeIntervalMs()).toBe(15 * 60_000);      // floor: never hammer the Hosting API
    process.env.MONITOR_CAPACITY_PROBE_MINUTES = '99999';
    expect(capacityProbeIntervalMs()).toBe(24 * 60 * 60_000); // ceiling: never go a week blind
    process.env.MONITOR_CAPACITY_PROBE_MINUTES = 'nonsense';
    expect(capacityProbeIntervalMs()).toBe(60 * 60_000);      // malformed falls back, never to 0
  });

  it('is ON by default — the panel already exists for people who go looking', () => {
    expect(capacityAlertsEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(capacityAlertsEnabled({ MONITOR_CAPACITY_ALERTS: 'OFF' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('escalation reaches the admin (integration with the sweep’s dedupe)', () => {
  it('🔒 warning → critical notifies AGAIN, without waiting out the cooldown', () => {
    // The reason capacity can safely share one id. Before this, an alert announced as a warning stayed
    // silent for the whole quiet period — six hours by default — no matter how much worse it got.
    const warn = publishCapacityAlert({ used: 36, cap: 50, remaining: 14, reclaimable: 0, level: 'warn', message: '' })!;
    const crit = publishCapacityAlert({ used: 47, cap: 50, remaining: 3, reclaimable: 0, level: 'critical', message: '' })!;
    const cooldown = 6 * 60 * 60_000;

    const first = decideAlertActions([warn], {}, 0, cooldown);
    expect(first.notify).toHaveLength(1);

    // One minute later, still only a warning: correctly quiet.
    const quiet = decideAlertActions([warn], first.nextState, 60_000, cooldown);
    expect(quiet.notify).toHaveLength(0);

    // One minute after that it is CRITICAL. The admin hears about it now, not in six hours.
    const escalated = decideAlertActions([crit], quiet.nextState, 120_000, cooldown);
    expect(escalated.notify).toHaveLength(1);
    expect(escalated.notify[0].severity).toBe('critical');
    expect(escalated.resolved).toEqual([]);   // it escalated; it did NOT recover

    // …and it does not then repeat itself on every sweep.
    const after = decideAlertActions([crit], escalated.nextState, 180_000, cooldown);
    expect(after.notify).toHaveLength(0);
  });

  it('🔒 does NOT re-announce on a DE-escalation, and cannot be made to flap', () => {
    const warn = publishCapacityAlert({ used: 36, cap: 50, remaining: 14, reclaimable: 0, level: 'warn', message: '' })!;
    const crit = publishCapacityAlert({ used: 47, cap: 50, remaining: 3, reclaimable: 0, level: 'critical', message: '' })!;
    const cooldown = 6 * 60 * 60_000;

    let state = decideAlertActions([crit], {}, 0, cooldown).nextState;
    // critical → warning: still bad, slightly less bad. Not news worth interrupting for.
    const down = decideAlertActions([warn], state, 1_000, cooldown);
    expect(down.notify).toHaveLength(0);
    // …and back up again must NOT re-announce, or a condition sitting on the threshold would notify
    // on every crossing — the noise this whole module exists to prevent.
    const up = decideAlertActions([crit], down.nextState, 2_000, cooldown);
    expect(up.notify).toHaveLength(0);
  });

  it('a genuine recovery still sends the all-clear', () => {
    const warn = publishCapacityAlert({ used: 36, cap: 50, remaining: 14, reclaimable: 0, level: 'warn', message: '' })!;
    const state = decideAlertActions([warn], {}, 0, 60_000).nextState;
    const recovered = decideAlertActions([], state, 1_000, 60_000);
    expect(recovered.resolved).toEqual(['publish-capacity']);
  });
});
