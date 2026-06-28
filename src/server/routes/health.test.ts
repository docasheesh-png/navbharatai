import { describe, it, expect } from 'vitest';
import { buildReadiness, markServerReady, isServerReady } from './health';

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
