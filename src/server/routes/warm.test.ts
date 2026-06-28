import { describe, it, expect } from 'vitest';
import { warmStep, runWarmup } from './warm';

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

    it('reports ok:false + the error for a step that throws (never propagates)', async () => {
      const s = await warmStep('boom', () => { throw new Error('kaboom'); });
      expect(s.ok).toBe(false);
      expect(s.error).toBe('kaboom');
    });

    it('reports ok:false for a rejected async step', async () => {
      const s = await warmStep('reject', async () => { throw new Error('nope'); });
      expect(s.ok).toBe(false);
      expect(s.error).toBe('nope');
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
});
