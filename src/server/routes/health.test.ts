import { describe, it, expect } from 'vitest';
import { buildReadiness, markServerReady, isServerReady, buildPublicConfig } from './health';

describe('health/readiness (P2.4)', () => {
  it('buildReadiness reflects initialized + backupConfigured', () => {
    const r = buildReadiness(true, 12.5, true);
    expect(r).toEqual({ ready: true, uptime: 12.5, checks: { initialized: true, backupConfigured: true } });
  });

  it('not-ready report carries ready:false (→ 503 at the route)', () => {
    const r = buildReadiness(false, 0, false);
    expect(r.ready).toBe(false);
    expect(r.checks.initialized).toBe(false);
  });

  it('markServerReady flips the readiness flag', () => {
    // (module singleton — once ready it stays ready, which is the intended startup semantics)
    markServerReady();
    expect(isServerReady()).toBe(true);
  });
});

describe('buildPublicConfig — the advertising pixel id, and nothing secret', () => {
  it('passes a real numeric pixel id through, trimmed', () => {
    expect(buildPublicConfig('1234567890123456').metaPixelId).toBe('1234567890123456');
    expect(buildPublicConfig('  1234567890123456  ').metaPixelId).toBe('1234567890123456');
  });

  it('UNSET means no pixel — the default state must be silent, never broken', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(buildPublicConfig(raw).metaPixelId).toBeNull();
    }
  });

  it('a MALFORMED value is treated exactly like unset, not injected into the page', () => {
    for (const bad of ['your-pixel-id', '123', 'https://facebook.com/12345678', '12345678901234567890123', '<script>']) {
      expect(buildPublicConfig(bad).metaPixelId).toBeNull();
    }
  });

  it('exposes ONLY these keys — a new one here would be a public disclosure', () => {
    // Still an EXACT list, deliberately: this route is served unauthenticated to every browser, so
    // adding a key must be a decision someone makes here on purpose, not a side effect elsewhere.
    // `platformFeePct` was added 2026-09-10 and is safe by nature — a rate is printed on the
    // purchase screen either way, and the browser needs it to show the split before the user pays.
    // `grievance` was added 2026-09-12 and is safe for a stronger reason: the IT Rules, 2021 REQUIRE
    // a Grievance Officer's name and contact to be published, so these values are public by law.
    expect(Object.keys(buildPublicConfig('1234567890123456')).sort()).toEqual(['grievance', 'metaPixelId', 'platformFeePct']);
  });

  it('the grievance block carries the published contact and nothing beyond it', () => {
    const g = buildPublicConfig(null, undefined, { name: 'A. Sharma', email: 'g@navbharatai.com', phone: '+91…', address: 'Kanpur' }).grievance;
    expect(Object.keys(g).sort()).toEqual(['address', 'email', 'name', 'phone']);
    expect(g.name).toBe('A. Sharma');
  });

  it('an unconfigured officer serves an empty NAME, never a placeholder person', () => {
    const g = buildPublicConfig(null, undefined, null).grievance;
    expect(g.name).toBe('');
    // The address still works, so the in-app page can always tell a user where to complain.
    expect(g.email).toContain('@');
  });

  it('serves the recharge fee rate, falling back to the default when unset or unreadable', () => {
    expect(buildPublicConfig(null, '2.5').platformFeePct).toBe(2.5);
    expect(buildPublicConfig(null, undefined).platformFeePct).toBe(2);
    expect(buildPublicConfig(null, '').platformFeePct).toBe(2);
    expect(buildPublicConfig(null, 'abc').platformFeePct).toBe(2);
    expect(buildPublicConfig(null, '0').platformFeePct).toBe(0);
  });
});
