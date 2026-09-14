/**
 * THE FRONTEND TRAFFIC METER — the number every `includedFrontendGb` figure was sold against.
 *
 * The tests that matter here are about HONESTY rather than arithmetic, because the input is reported
 * by a stranger's browser:
 *   • a hostile or absurd byte figure is DROPPED, not clamped — a clamped fabrication is still one;
 *   • a bytes report is never also counted as a page view, and a page view never as bytes;
 *   • an app whose figure could not be read is UNMEASURED, never a zero;
 *   • a free account has a real allowance, not a zero one, and no hypothetical charge at all.
 */
import { describe, it, expect } from 'vitest';
import {
  parseBytesReport, parseHit, beaconHtml, summarize, MAX_BYTES_PER_REPORT, POLICY_PHRASES,
} from '../src/server/lib/siteAnalytics';
import { sumFrontendBytes, judgeFrontendUsage } from '../src/server/AgentV3/frontendUsage';
import { HOSTING_TIERS, FREE_FRONTEND_GB } from '../src/lib/hostingTiers';

const APP = 'nbai-0123456789abcdef0123';
const GIB = 1024 ** 3;

describe('parseBytesReport — a public endpoint accepts nothing it did not ask for', () => {
  it('accepts the shape the beacon sends', () => {
    expect(parseBytesReport(JSON.stringify({ a: APP, b: 1_234_567 }))).toEqual({ appId: APP, bytes: 1_234_567 });
  });

  it('DROPS an absurd figure rather than clamping it — a clamped fabrication is still a fabrication', () => {
    expect(parseBytesReport(JSON.stringify({ a: APP, b: MAX_BYTES_PER_REPORT + 1 }))).toBeNull();
    expect(parseBytesReport(JSON.stringify({ a: APP, b: 1e18 }))).toBeNull();
    // The ceiling itself is still accepted — the rule is "implausible", not "large".
    expect(parseBytesReport(JSON.stringify({ a: APP, b: MAX_BYTES_PER_REPORT }))?.bytes).toBe(MAX_BYTES_PER_REPORT);
  });

  it('refuses zero, negative, fractional and non-numeric byte counts', () => {
    for (const b of [0, -1, -1e9, 1.5, NaN, Infinity, null, undefined, {}, [], 'lots']) {
      expect(parseBytesReport(JSON.stringify({ a: APP, b }))).toBeNull();
    }
  });

  it('refuses an app id that is not ours, and junk bodies', () => {
    expect(parseBytesReport(JSON.stringify({ a: 'nope', b: 100 }))).toBeNull();
    expect(parseBytesReport(JSON.stringify({ b: 100 }))).toBeNull();
    expect(parseBytesReport('not json')).toBeNull();
    expect(parseBytesReport('')).toBeNull();
    expect(parseBytesReport(null)).toBeNull();
    expect(parseBytesReport('x'.repeat(3000))).toBeNull();
  });

  it('🔒 the two beacon shapes are DISJOINT, so nothing can be counted twice', () => {
    const hit = JSON.stringify({ a: APP, p: '/pricing', r: 'google.com' });
    const bytes = JSON.stringify({ a: APP, b: 5000 });
    expect(parseHit(hit)).not.toBeNull();
    expect(parseBytesReport(hit)).toBeNull();       // a hit is never read as bytes
    expect(parseBytesReport(bytes)).not.toBeNull();
    expect(parseHit(bytes)).toBeNull();             // bytes are never read as a view
  });

  it('a payload carrying BOTH is refused as a bytes report — the guard is the path, not the order', () => {
    expect(parseBytesReport(JSON.stringify({ a: APP, p: '/x', b: 5000 }))).toBeNull();
  });
});

describe('the beacon measures, and keeps the promises the policy makes', () => {
  const html = beaconHtml(APP, 'https://navbharatai.com');

  it('reads the browser\'s own transfer figures, not a guess', () => {
    expect(html).toContain('transferSize');
    expect(html).toContain('getEntriesByType("resource")');
    expect(html).toContain('getEntriesByType("navigation")');
  });

  it('reports once, on the way out — pagehide AND visibilitychange, guarded', () => {
    expect(html).toContain('pagehide');
    expect(html).toContain('visibilitychange');
    expect(html).toContain('if(sent)return;sent=1');
  });

  it('the Do Not Track check still short-circuits everything, bytes included', () => {
    // The opt-out `return` precedes every send in the IIFE, so a DNT visitor reports neither shape.
    expect(html.indexOf('doNotTrack')).toBeLessThan(html.indexOf('transferSize'));
  });

  it('still stores nothing on the visitor\'s device', () => {
    expect(html).not.toMatch(/cookie|localStorage|sessionStorage|indexedDB/i);
  });

  it('🔒 the policy discloses the new field — the guard that made this test necessary', () => {
    expect(POLICY_PHRASES).toContain('how many bytes');
  });
});

describe('summarize carries bytes through, zero-filled like every other series', () => {
  const today = Date.parse('2026-09-13T10:00:00Z');

  it('sums bytes across shards and days', () => {
    const s = summarize([
      { appId: APP, day: '2026-09-13', views: 3, bytes: 1000 },
      { appId: APP, day: '2026-09-13', views: 2, bytes: 500 },
      { appId: APP, day: '2026-09-12', views: 1, bytes: 250 },
    ], { todayMs: today, days: 7 });
    expect(s.totalBytes).toBe(1750);
    expect(s.days.find((d) => d.day === '2026-09-13')!.bytes).toBe(1500);
  });

  it('a day with views but no bytes reports 0 bytes, never NaN', () => {
    const s = summarize([{ appId: APP, day: '2026-09-13', views: 5 }], { todayMs: today, days: 7 });
    expect(s.totalBytes).toBe(0);
    expect(s.days.every((d) => Number.isFinite(d.bytes))).toBe(true);
  });

  it('a negative or junk stored value can never drag the total below zero', () => {
    const s = summarize([
      { appId: APP, day: '2026-09-13', views: 1, bytes: -5_000_000 as number },
      { appId: APP, day: '2026-09-13', views: 1, bytes: 'lots' as unknown as number },
      { appId: APP, day: '2026-09-13', views: 1, bytes: 100 },
    ], { todayMs: today, days: 7 });
    expect(s.totalBytes).toBe(100);
  });
});

describe('sumFrontendBytes — an unreadable app is a GAP, never a zero', () => {
  it('counts what it measured and names what it could not', () => {
    const u = sumFrontendBytes([1000, null, 2000, null]);
    expect(u).toEqual({ bytes: 3000, appsMeasured: 2, appsUnmeasured: 2 });
  });

  it('a genuine zero is a measurement and is counted as one', () => {
    expect(sumFrontendBytes([0, 0])).toEqual({ bytes: 0, appsMeasured: 2, appsUnmeasured: 0 });
  });

  it('nonsense is a gap, not a number', () => {
    const u = sumFrontendBytes([NaN, Infinity, -1, 500]);
    expect(u.bytes).toBe(500);
    expect(u.appsUnmeasured).toBe(3);
  });

  it('no apps is not an error', () => {
    expect(sumFrontendBytes([])).toEqual({ bytes: 0, appsMeasured: 0, appsUnmeasured: 0 });
  });
});

describe('judgeFrontendUsage — against the plan the owner actually bought', () => {
  const starter = HOSTING_TIERS.find((t) => t.id === 'starter')!;

  it('within the allowance charges nothing and says so', () => {
    const v = judgeFrontendUsage({
      usage: sumFrontendBytes([GIB]), planId: 'starter',
    });
    expect(v.includedGb).toBe(starter.includedFrontendGb);
    expect(v.overGb).toBe(0);
    expect(v.wouldBillInr).toBe(0);
    expect(v.note).toMatch(/within the allowance/);
  });

  it('past the allowance reports what it WOULD cost, and says it is not charged', () => {
    const v = judgeFrontendUsage({
      usage: sumFrontendBytes([GIB]),
      planId: 'starter',
      periodUsedGb: starter.includedFrontendGb,
    });
    expect(v.overGb).toBeCloseTo(1, 3);
    expect(v.wouldBillInr).toBeGreaterThan(0);
    expect(v.note).toMatch(/NOT charged/);
  });

  it('🔒 a FREE account has a real allowance, not a zero one', () => {
    const v = judgeFrontendUsage({ usage: sumFrontendBytes([GIB]), planId: null });
    expect(v.includedGb).toBe(FREE_FRONTEND_GB);
    expect(v.includedGb).toBeGreaterThan(0);
    expect(v.overGb).toBe(0);
  });

  it('🔒 a free account past its allowance still has NO hypothetical charge — it agreed to no terms', () => {
    const v = judgeFrontendUsage({
      usage: sumFrontendBytes([GIB * 100]), planId: null,
    });
    expect(v.overGb).toBeGreaterThan(0);
    expect(v.wouldBillInr).toBe(0);
  });

  it('an unknown plan id is treated as no plan, never as the biggest one', () => {
    const v = judgeFrontendUsage({ usage: sumFrontendBytes([GIB]), planId: 'enterprise-mega' });
    expect(v.includedGb).toBe(FREE_FRONTEND_GB);
  });

  it('an incomplete measurement says so in the line the admin reads', () => {
    const v = judgeFrontendUsage({ usage: sumFrontendBytes([GIB, null]), planId: 'starter' });
    expect(v.incomplete).toBe(true);
    expect(v.note).toMatch(/unmeasured — this is a floor/);
  });

  it('the allowance is the OWNER\'s and is spent once across the period, not per app', () => {
    const tier = HOSTING_TIERS.find((t) => t.id === 'growth')!;
    const v = judgeFrontendUsage({
      usage: sumFrontendBytes([GIB, GIB, GIB]),
      planId: 'growth',
      periodUsedGb: tier.includedFrontendGb - 1,
    });
    // 3 GB today on top of (allowance − 1) already spent ⇒ 2 GB over, not "3 apps each under".
    expect(v.overGb).toBeCloseTo(2, 3);
  });
});

describe('formatTraffic — the unit a person reads, not the unit we store', () => {
  it('shows MB below a GB and GB above it, to two decimals against a whole-GB allowance', async () => {
    const { formatTraffic } = await import('../src/components/agentv3/HostingChooser');
    expect(formatTraffic(0)).toBe('0 MB');
    expect(formatTraffic(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatTraffic(420 * 1024 * 1024)).toBe('420 MB');
    expect(formatTraffic(2 * GIB)).toBe('2.00 GB');
  });

  it('never renders NaN or a negative figure at a user', async () => {
    const { formatTraffic } = await import('../src/components/agentv3/HostingChooser');
    expect(formatTraffic(NaN)).toBe('0 MB');
    expect(formatTraffic(-1)).toBe('0 MB');
    expect(formatTraffic(Infinity)).toBe('0 MB');
  });
});
