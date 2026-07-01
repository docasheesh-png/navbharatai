import { describe, it, expect } from 'vitest';
import { funnelStage, sanitizeEventKey, funnelFromDaily, dayKey, recordAnalyticsEvent, getFunnel } from '../src/server/lib/AnalyticsPipeline';

/** P-MON.1 — server analytics pipeline: pure stage mapping + funnel aggregation + no-throw store. */

describe('funnelStage', () => {
  it('maps events to activation-funnel stages', () => {
    expect(funnelStage('sign_up')).toBe('signup');
    expect(funnelStage('user_signup')).toBe('signup');
    expect(funnelStage('build_start')).toBe('build');
    expect(funnelStage('build')).toBe('build');
    expect(funnelStage('deploy_success')).toBe('deploy');
    expect(funnelStage('subscribe')).toBe('pay');
    expect(funnelStage('checkout')).toBe('pay');
    expect(funnelStage('random_click')).toBeNull();
  });
});

describe('sanitizeEventKey', () => {
  it('strips Firestore-unsafe field chars and bounds length', () => {
    expect(sanitizeEventKey('a.b/c[d]')).toBe('a_b_c_d_');
    expect(sanitizeEventKey('')).toBe('unknown');
    expect(sanitizeEventKey('x'.repeat(200)).length).toBe(80);
  });
});

describe('funnelFromDaily', () => {
  it('sums stages across days and computes stage-to-stage conversion', () => {
    const res = funnelFromDaily([
      { funnel: { signup: 100, build: 60, deploy: 30, pay: 6 } },
      { funnel: { signup: 100, build: 40, deploy: 10, pay: 4 } },
      null,
      {},
    ]);
    expect(res.stages).toEqual({ signup: 200, build: 100, deploy: 40, pay: 10 });
    expect(res.conversion.signup).toBe(1);
    expect(res.conversion.build).toBeCloseTo(0.5); // 100/200
    expect(res.conversion.deploy).toBeCloseTo(0.4); // 40/100
    expect(res.conversion.pay).toBeCloseTo(0.25); // 10/40
  });
  it('handles an empty set without dividing by zero', () => {
    const res = funnelFromDaily([]);
    expect(res.stages).toEqual({ signup: 0, build: 0, deploy: 0, pay: 0 });
    expect(res.conversion.build).toBe(0);
  });
});

describe('dayKey', () => {
  it('returns a UTC YYYY-MM-DD bucket', () => {
    expect(dayKey(0)).toBe('1970-01-01');
    expect(dayKey(Date.UTC(2026, 5, 30, 23, 0, 0))).toBe('2026-06-30');
  });
});

describe('store (best-effort, no Firestore under VITEST)', () => {
  it('recordAnalyticsEvent never throws; getFunnel returns an empty funnel', async () => {
    await expect(recordAnalyticsEvent({ event: 'build_start', userId: 'u1' })).resolves.toBeUndefined();
    await expect(recordAnalyticsEvent({ event: '' })).resolves.toBeUndefined();
    const f = await getFunnel(30);
    expect(f.stages).toEqual({ signup: 0, build: 0, deploy: 0, pay: 0 });
  });
});
