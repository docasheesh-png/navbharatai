import { describe, it, expect } from 'vitest';
import { scoreUserAgent, isBurst, computePenaltyMs, isGuardedPath } from '../src/server/lib/adaptiveRateLimit';

/**
 * P-SEC.8 — Adaptive rate limiting + bot detection (pure scoring functions).
 */
describe('adaptiveRateLimit — scoreUserAgent', () => {
  it('scores a real browser UA low', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
    expect(scoreUserAgent(chrome)).toBeLessThan(0.3);
  });

  it('scores a missing/empty UA high', () => {
    expect(scoreUserAgent(undefined)).toBeGreaterThanOrEqual(0.8);
    expect(scoreUserAgent('')).toBeGreaterThanOrEqual(0.8);
    expect(scoreUserAgent('   ')).toBeGreaterThanOrEqual(0.8);
  });

  it('scores known automated clients high', () => {
    expect(scoreUserAgent('curl/8.4.0')).toBeGreaterThanOrEqual(0.9);
    expect(scoreUserAgent('python-requests/2.31.0')).toBeGreaterThanOrEqual(0.9);
    expect(scoreUserAgent('Scrapy/2.11 (+https://scrapy.org)')).toBeGreaterThanOrEqual(0.9);
    expect(scoreUserAgent('Go-http-client/1.1')).toBeGreaterThanOrEqual(0.9);
  });

  it('treats benign crawlers as low-to-moderate (not malicious)', () => {
    expect(scoreUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBeLessThan(0.5);
  });

  it('flags a non-browser token without a known bot signature as mildly suspicious', () => {
    expect(scoreUserAgent('SomeCustomAgent/1.0')).toBeGreaterThanOrEqual(0.5);
  });
});

describe('adaptiveRateLimit — isBurst', () => {
  it('returns false when requests are under the window cap', () => {
    const now = 1_000_000;
    const ts = [now - 9000, now - 5000, now - 1000];
    expect(isBurst(ts, now, 10_000, 25)).toBe(false);
  });

  it('returns true when too many requests fall inside the window', () => {
    const now = 1_000_000;
    const ts: number[] = [];
    for (let i = 0; i < 30; i++) ts.push(now - i * 100); // 30 reqs in 3s
    // history must be ascending order (oldest first) — reverse the descending fill
    ts.reverse();
    expect(isBurst(ts, now, 10_000, 25)).toBe(true);
  });

  it('ignores timestamps older than the window', () => {
    const now = 1_000_000;
    const ts: number[] = [];
    for (let i = 0; i < 30; i++) ts.push(now - 60_000 - i * 100); // all > 10s old
    ts.reverse();
    expect(isBurst(ts, now, 10_000, 25)).toBe(false);
  });
});

describe('adaptiveRateLimit — isGuardedPath', () => {
  it('guards the general /api/ surface', () => {
    expect(isGuardedPath('/api/pro-chat')).toBe(true);
    expect(isGuardedPath('/api/admin/users')).toBe(true);
  });

  it('does NOT guard non-/api/ paths (static assets, the SPA)', () => {
    expect(isGuardedPath('/')).toBe(false);
    expect(isGuardedPath('/assets/index.js')).toBe(false);
  });

  it('EXEMPTS the interactive v5.0 build surface (the real-user-blocked bug)', () => {
    // A single build bursts these — they must never trip the behavioural bot block.
    expect(isGuardedPath('/api/agentv3/chat')).toBe(false);
    expect(isGuardedPath('/api/agentv3/status')).toBe(false);
    expect(isGuardedPath('/api/agentv3/preview-status')).toBe(false);
    expect(isGuardedPath('/api/agentv3/workspace-files')).toBe(false);
    expect(isGuardedPath('/api/agentv3/conversations')).toBe(false);
  });
});

describe('adaptiveRateLimit — computePenaltyMs', () => {
  it('is zero for no violations', () => {
    expect(computePenaltyMs(0)).toBe(0);
    expect(computePenaltyMs(-1)).toBe(0);
  });

  it('grows exponentially with violations', () => {
    expect(computePenaltyMs(1)).toBe(500);
    expect(computePenaltyMs(2)).toBe(1000);
    expect(computePenaltyMs(3)).toBe(2000);
    expect(computePenaltyMs(4)).toBe(4000);
  });

  it('is capped', () => {
    expect(computePenaltyMs(100, 30_000)).toBe(30_000);
    expect(computePenaltyMs(20, 5_000)).toBe(5_000);
  });
});
