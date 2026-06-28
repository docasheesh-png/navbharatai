import { describe, it, expect, beforeEach } from 'vitest';
import { warmStep, runWarmup, getWarmReport, __resetWarmCache } from './warm';

describe('warm (P3.3 keep-warm)', () => {
  describe('warmStep', () => {
    it('reports ok:true + a duration for a step that succeeds', async () => {
      const s = await warmStep('x', () => 42);
      expect(s.step).toBe('x');
      expect(s.ok).toBe(true);
      expect(typeof s.ms).toBe('number');
      expect(s.error).toBeUndefined();
    });

    it('awaits async steps', async () => {
      const s = await warmStep('async', async () => { await Promise.resolve(); return 'done'; });
      expect(s.ok).toBe(true);
    });

    it('reports ok:false for a step that throws (never propagates; generic error, no raw detail)', async () => {
      const s = await warmStep('boom', () => { throw new Error('kaboom-secret-path'); });
      expect(s.ok).toBe(false);
      // Public marker only — the raw message must NOT be disclosed (it goes to server logs).
      expect(s.error).toBe('failed');
      expect(s.error).not.toContain('secret');
    });

    it('reports ok:false for a rejected async step', async () => {
      const s = await warmStep('reject', async () => { throw new Error('nope'); });
      expect(s.ok).toBe(false);
      expect(s.error).toBe('failed');
    });
  });

  describe('runWarmup', () => {
    it('returns an honest report and never throws', async () => {
      const report = await runWarmup();
      expect(report.warm).toBe(true);
      expect(Array.isArray(report.steps)).toBe(true);
      expect(report.steps.length).toBeGreaterThanOrEqual(13);
      // okCount + failCount accounts for every step.
      expect(report.okCount + report.failCount).toBe(report.steps.length);
      expect(report.totalMs).toBeGreaterThanOrEqual(0);
      // The synchronous, no-network steps (router build, clinical KB, app-context) must succeed.
      const byStep = Object.fromEntries(report.steps.map((s) => [s.step, s]));
      expect(byStep['router:pro'].ok).toBe(true);
      expect(byStep['router:professional'].ok).toBe(true);
      expect(byStep['clinicalKB'].ok).toBe(true);
      expect(byStep['appContext:sda'].ok).toBe(true);
    });

    it('warms all three AI router universes', async () => {
      const report = await runWarmup();
      const names = report.steps.map((s) => s.step);
      expect(names).toEqual(expect.arrayContaining(['router:free', 'router:pro', 'router:professional']));
    });
  });

  describe('getWarmReport throttle (anti cost-amplification)', () => {
    beforeEach(() => { __resetWarmCache(); });

    it('first call runs the warmup (cached:false), an immediate second call returns cached:true', async () => {
      const first = await getWarmReport();
      expect(first.cached).toBe(false);
      expect(first.warm).toBe(true);
      const second = await getWarmReport();
      expect(second.cached).toBe(true);
      // Same report content served from cache (no re-run within the throttle window).
      expect(second.steps.length).toBe(first.steps.length);
    });

    it('re-runs once the throttle window has elapsed (simulated via the now param)', async () => {
      await getWarmReport(1_000);            // first run at t=1s
      const cached = await getWarmReport(5_000);   // within 30s → cached
      expect(cached.cached).toBe(true);
      const rerun = await getWarmReport(1_000 + 31_000); // >30s later → re-run
      expect(rerun.cached).toBe(false);
    });
  });
});
