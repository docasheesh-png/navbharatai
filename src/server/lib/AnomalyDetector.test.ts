import { describe, it, expect } from 'vitest';
import {
  mean, stddev, zScores, detectZAnomalies, ewma, detectEwmaAnomalies,
  linearTrend, forecast, analyzeSeries, type Point,
} from './AnomalyDetector';

describe('AnomalyDetector (P-MON.2)', () => {
  describe('basic stats', () => {
    it('mean and population stddev', () => {
      expect(mean([2, 4, 6])).toBe(4);
      expect(stddev([2, 4, 6])).toBeCloseTo(1.633, 2);
    });
    it('empty series are safe', () => {
      expect(mean([])).toBe(0);
      expect(stddev([])).toBe(0);
    });
  });

  describe('z-score anomalies', () => {
    it('flags a clear outlier', () => {
      const vals = [10, 10, 11, 9, 10, 100, 10, 11]; // 100 is the anomaly
      const idx = detectZAnomalies(vals, 2);
      expect(idx).toContain(5);
    });
    it('a flat series has no anomalies (stddev 0)', () => {
      expect(detectZAnomalies([5, 5, 5, 5])).toEqual([]);
      expect(zScores([5, 5, 5])).toEqual([0, 0, 0]);
    });
  });

  describe('EWMA', () => {
    it('smooths toward recent values', () => {
      const s = ewma([0, 10, 10, 10, 10], 0.5);
      expect(s[0]).toBe(0);
      expect(s[s.length - 1]).toBeGreaterThan(s[1]); // converging up toward 10
      expect(s[s.length - 1]).toBeLessThanOrEqual(10);
    });
    it('detects a sudden level shift', () => {
      const vals = [10, 10, 10, 10, 10, 10, 50, 10, 10]; // spike at index 6
      const idx = detectEwmaAnomalies(vals, 0.3, 2);
      expect(idx).toContain(6);
    });
    it('returns nothing for very short or flat series', () => {
      expect(detectEwmaAnomalies([1, 2])).toEqual([]);
      expect(detectEwmaAnomalies([5, 5, 5, 5, 5])).toEqual([]);
    });
  });

  describe('linear trend + forecast', () => {
    it('recovers a known slope/intercept', () => {
      const pts: Point[] = [{ t: 0, v: 1 }, { t: 1, v: 3 }, { t: 2, v: 5 }, { t: 3, v: 7 }]; // v = 2t + 1
      const tr = linearTrend(pts)!;
      expect(tr.slope).toBeCloseTo(2, 6);
      expect(tr.intercept).toBeCloseTo(1, 6);
    });
    it('forecasts forward along the trend at the median step', () => {
      const pts: Point[] = [{ t: 0, v: 0 }, { t: 1, v: 2 }, { t: 2, v: 4 }];
      const fc = forecast(pts, 2);
      expect(fc).toHaveLength(2);
      expect(fc[0]).toEqual({ t: 3, v: 6 });
      expect(fc[1]).toEqual({ t: 4, v: 8 });
    });
    it('returns null/empty for <2 points', () => {
      expect(linearTrend([{ t: 0, v: 1 }])).toBeNull();
      expect(forecast([{ t: 0, v: 1 }], 3)).toEqual([]);
    });
  });

  describe('analyzeSeries', () => {
    it('sorts by t, reports stats, anomalies, trend direction, and forecast', () => {
      const pts: Point[] = [
        { t: 5, v: 50 }, { t: 1, v: 10 }, { t: 2, v: 11 }, { t: 3, v: 10 }, { t: 4, v: 12 }, { t: 6, v: 11 },
      ];
      const r = analyzeSeries(pts, { zThreshold: 1.5, forecastHorizon: 3 });
      expect(r.count).toBe(6);
      expect(r.stats.max).toBe(50);
      expect(r.zAnomalies.some((a) => a.v === 50)).toBe(true);
      expect(r.trend).not.toBeNull();
      expect(['rising', 'falling', 'flat']).toContain(r.trend!.direction);
      expect(r.forecast).toHaveLength(3);
    });
    it('a rising series reports rising trend', () => {
      const pts: Point[] = Array.from({ length: 10 }, (_, i) => ({ t: i, v: i * 3 }));
      expect(analyzeSeries(pts).trend!.direction).toBe('rising');
    });
    it('an empty series is safe', () => {
      const r = analyzeSeries([]);
      expect(r.count).toBe(0);
      expect(r.zAnomalies).toEqual([]);
      expect(r.trend).toBeNull();
      expect(r.forecast).toEqual([]);
    });
  });
});
