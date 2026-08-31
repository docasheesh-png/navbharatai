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
    expect(buildPublicConfig('1234567890123456')).toEqual({ metaPixelId: '1234567890123456' });
    expect(buildPublicConfig('  1234567890123456  ')).toEqual({ metaPixelId: '1234567890123456' });
  });

  it('UNSET means no pixel — the default state must be silent, never broken', () => {
    expect(buildPublicConfig(undefined)).toEqual({ metaPixelId: null });
    expect(buildPublicConfig(null)).toEqual({ metaPixelId: null });
    expect(buildPublicConfig('')).toEqual({ metaPixelId: null });
    expect(buildPublicConfig('   ')).toEqual({ metaPixelId: null });
  });

  it('a MALFORMED value is treated exactly like unset, not injected into the page', () => {
    for (const bad of ['your-pixel-id', '123', 'https://facebook.com/12345678', '12345678901234567890123', '<script>']) {
      expect(buildPublicConfig(bad)).toEqual({ metaPixelId: null });
    }
  });

  it('exposes ONLY the pixel id — a new key here would be a public disclosure', () => {
    expect(Object.keys(buildPublicConfig('1234567890123456'))).toEqual(['metaPixelId']);
  });
});
