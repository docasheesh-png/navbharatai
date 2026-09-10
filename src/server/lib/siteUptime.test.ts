import { describe, it, expect } from 'vitest';
import {
  decideUptime, emptyRecord, outcomeFromServing, cooldownMs, sweepEnabled, maxDomainsPerSweep,
  downMessage, upMessage, FAILURES_BEFORE_ALERT,
} from './siteUptime';

const H = 3_600_000;
const rec = () => emptyRecord('mitrify.com', 'ws', 'u1');

describe('decideUptime — an alert worth reading', () => {
  it('🔒 one failure is not an outage; the second consecutive one is', () => {
    const a = decideUptime(rec(), 'down', 1000, 6 * H);
    expect(a.action).toBe('none');
    expect(a.next.failures).toBe(1);
    const b = decideUptime(a.next, 'down', 2000, 6 * H);
    expect(b.action).toBe('alert-down');
    expect(b.next.alerted).toBe(true);
    expect(b.next.lastAlertAt).toBe(2000);
    expect(FAILURES_BEFORE_ALERT).toBe(2);
  });

  it('🔒 "unknown" (WE could not reach it) is not their failure — it neither counts nor resets', () => {
    const a = decideUptime(rec(), 'down', 1000, 6 * H);
    const u = decideUptime(a.next, 'unknown', 2000, 6 * H);
    expect(u.action).toBe('none');
    expect(u.next.failures).toBe(1);
    expect(u.next.lastCheckedAt).toBe(2000);
    // The next real failure completes the pair.
    expect(decideUptime(u.next, 'down', 3000, 6 * H).action).toBe('alert-down');
  });

  it('🔒 one alert per outage, then quiet for the cooldown while it stays down', () => {
    let r = decideUptime(decideUptime(rec(), 'down', 0, 6 * H).next, 'down', 1000, 6 * H);
    expect(r.action).toBe('alert-down');
    r = decideUptime(r.next, 'down', 1000 + 15 * 60_000, 6 * H);
    expect(r.action).toBe('none');
    r = decideUptime(r.next, 'down', 1000 + 6 * H, 6 * H);
    expect(r.action).toBe('alert-down');   // still down after the cooldown — say so again, once
  });

  it('announces a recovery once, and only after an alert was sent', () => {
    // Up without a prior alert: silence. A flapping site that never reached two failures never rang.
    expect(decideUptime(decideUptime(rec(), 'down', 0, 6 * H).next, 'up', 1000, 6 * H).action).toBe('none');
    let r = decideUptime(decideUptime(rec(), 'down', 0, 6 * H).next, 'down', 1000, 6 * H);
    r = decideUptime(r.next, 'up', 2000, 6 * H);
    expect(r.action).toBe('alert-up');
    expect(r.next.alerted).toBe(false);
    expect(r.next.failures).toBe(0);
    expect(r.next.lastOkAt).toBe(2000);
    expect(decideUptime(r.next, 'up', 3000, 6 * H).action).toBe('none');
  });

  it('maps the serving check honestly', () => {
    expect(outcomeFromServing('serving')).toBe('up');
    expect(outcomeFromServing('error')).toBe('down');
    expect(outcomeFromServing('nothing_published')).toBe('down');
    expect(outcomeFromServing('unknown')).toBe('unknown');
    expect(outcomeFromServing(undefined)).toBe('unknown');
  });

  it('env knobs are clamped with safe defaults', () => {
    expect(cooldownMs({})).toBe(6 * H);
    expect(cooldownMs({ SITE_UPTIME_COOLDOWN_HOURS: '0' })).toBe(6 * H);
    expect(cooldownMs({ SITE_UPTIME_COOLDOWN_HOURS: '1000' })).toBe(72 * H);
    expect(sweepEnabled({})).toBe(true);
    expect(sweepEnabled({ SITE_UPTIME_SWEEP: 'off' })).toBe(false);
    expect(maxDomainsPerSweep({})).toBe(500);
    expect(maxDomainsPerSweep({ SITE_UPTIME_MAX_DOMAINS: '99999' })).toBe(5000);
  });

  it('🔒 the messages name the domain and the next step — never a vendor or a probe internal', () => {
    for (const m of [downMessage('mitrify.com', 0), upMessage('mitrify.com', 0)]) {
      expect(m).toContain('mitrify.com');
      expect(m).not.toMatch(/firebase|cloudflare|google|render|probe|fetch|http status|HTTP/i);
    }
    expect(downMessage('x.com', 0)).toMatch(/press Publish once/);
  });
});
