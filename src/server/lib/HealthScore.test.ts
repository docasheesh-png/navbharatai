import { describe, it, expect } from 'vitest';
import {
  computeHealthScore, scoreErrors, scoreLatency, scoreSuccess, scoreUptime,
} from './HealthScore';

describe('HealthScore (P-MON.4)', () => {
  describe('component scorers', () => {
    it('errors: 0% is perfect, 25%+ is zero', () => {
      expect(scoreErrors(0)).toBe(100);
      expect(scoreErrors(25)).toBe(0);
      expect(scoreErrors(50)).toBe(0); // clamped
      expect(scoreErrors(12.5)).toBeCloseTo(50, 5);
    });
    it('latency: <=100ms perfect, >=2000ms zero', () => {
      expect(scoreLatency(50)).toBe(100);
      expect(scoreLatency(100)).toBe(100);
      expect(scoreLatency(2000)).toBe(0);
      expect(scoreLatency(5000)).toBe(0); // clamped
      expect(scoreLatency(1050)).toBeCloseTo(50, 0);
    });
    it('success: passes through, clamped', () => {
      expect(scoreSuccess(94)).toBe(94);
      expect(scoreSuccess(120)).toBe(100);
      expect(scoreSuccess(-5)).toBe(0);
    });
    it('uptime: 0s zero, >=1 day perfect', () => {
      expect(scoreUptime(0)).toBe(0);
      expect(scoreUptime(86_400)).toBe(100);
      expect(scoreUptime(43_200)).toBeCloseTo(50, 5);
    });
  });

  describe('computeHealthScore', () => {
    it('a healthy platform scores high and grades well', () => {
      const r = computeHealthScore({ errorRatePct: 0.5, avgLatencyMs: 80, successRatePct: 99, uptimeSeconds: 86_400 });
      expect(r.health).not.toBeNull();
      expect(r.health!).toBeGreaterThan(90);
      expect(r.grade).toBe('excellent');
      expect(r.risk).toBeCloseTo(100 - r.health!, 5);
      expect(r.missing).toEqual([]);
    });

    it('a failing platform scores low and is critical', () => {
      const r = computeHealthScore({ errorRatePct: 30, avgLatencyMs: 3000, successRatePct: 20, uptimeSeconds: 60 });
      expect(r.health!).toBeLessThan(35);
      expect(r.grade).toBe('critical');
    });

    it('HONESTY: missing signals drop out, are reported, and do not fabricate a value', () => {
      const r = computeHealthScore({ successRatePct: 100 }); // only one signal known
      expect(r.components.success).toBe(100);
      expect(r.health).toBe(100); // re-normalised over the one present signal
      expect(r.missing.sort()).toEqual(['errors', 'latency', 'uptime']);
    });

    it('HONESTY: no signals at all → null score, unknown grade (never a fake number)', () => {
      const r = computeHealthScore({});
      expect(r.health).toBeNull();
      expect(r.reliability).toBeNull();
      expect(r.risk).toBeNull();
      expect(r.grade).toBe('unknown');
      expect(r.missing.sort()).toEqual(['errors', 'latency', 'success', 'uptime']);
    });

    it('ignores non-finite inputs as missing (NaN/Infinity are not data)', () => {
      const r = computeHealthScore({ errorRatePct: NaN, avgLatencyMs: Infinity, successRatePct: 90 });
      expect(r.missing).toContain('errors');
      expect(r.missing).toContain('latency');
      expect(r.components.success).toBe(90);
    });

    it('reliability uses only the success/error axis', () => {
      const r = computeHealthScore({ errorRatePct: 0, successRatePct: 100, avgLatencyMs: 2000, uptimeSeconds: 0 });
      expect(r.reliability).toBe(100); // perfect on the correctness axis
      expect(r.health!).toBeLessThan(100); // dragged down by bad latency/uptime
    });
  });
});
