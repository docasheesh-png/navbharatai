import { describe, it, expect } from 'vitest';
import { quantile, percentiles, aggregateProviderLatency, type SpanLike } from './Percentiles';

describe('Percentiles (P-MON.3)', () => {
  describe('quantile', () => {
    it('returns null for empty, the value for a single sample', () => {
      expect(quantile([], 0.5)).toBeNull();
      expect(quantile([42], 0.99)).toBe(42);
    });
    it('computes median and interpolates', () => {
      expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5); // interpolated middle
      expect(quantile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    });
    it('p100 is the max, p0 is the min', () => {
      expect(quantile([5, 1, 9, 3], 1)).toBe(9);
      expect(quantile([5, 1, 9, 3], 0)).toBe(1);
    });
    it('does not require pre-sorted input', () => {
      expect(quantile([50, 10, 30, 20, 40], 0.5)).toBe(30);
    });
  });

  describe('percentiles', () => {
    it('honest zero state for an empty sample (no invented latency)', () => {
      const s = percentiles([]);
      expect(s.count).toBe(0);
      expect(s.p50).toBeNull();
      expect(s.p99).toBeNull();
      expect(s.mean).toBeNull();
    });
    it('summarises a real sample', () => {
      const s = percentiles([100, 100, 100, 100, 100, 100, 100, 100, 100, 1000]);
      expect(s.count).toBe(10);
      expect(s.min).toBe(100);
      expect(s.max).toBe(1000);
      expect(s.p50).toBe(100);
      expect(s.p99!).toBeGreaterThan(s.p50!); // the tail catches the 1000ms outlier
    });
    it('ignores non-finite samples', () => {
      const s = percentiles([100, NaN, 200, Infinity]);
      expect(s.count).toBe(2);
      expect(s.min).toBe(100);
      expect(s.max).toBe(200);
    });
  });

  describe('aggregateProviderLatency', () => {
    const spans: SpanLike[] = [
      { name: 'ai.provider.GROK', durationMs: 100, status: 'ok', attributes: { provider: 'GROK' } },
      { name: 'ai.provider.GROK', durationMs: 200, status: 'ok', attributes: { provider: 'GROK' } },
      { name: 'ai.provider.GROK', durationMs: 300, status: 'error', attributes: { provider: 'GROK' } },
      { name: 'ai.provider.GEMINI', durationMs: 50, status: 'ok', attributes: { provider: 'GEMINI' } },
      { name: 'http.request', durationMs: 5, status: 'ok' }, // not a provider span → ignored
    ];

    it('groups by provider with latency percentiles + error rate', () => {
      const r = aggregateProviderLatency(spans);
      const grok = r.find((x) => x.provider === 'GROK')!;
      const gemini = r.find((x) => x.provider === 'GEMINI')!;
      expect(grok.latency.count).toBe(3);
      expect(grok.errors).toBe(1);
      expect(grok.errorRatePct).toBeCloseTo(33.3, 1);
      expect(grok.latency.min).toBe(100);
      expect(grok.latency.max).toBe(300);
      expect(gemini.latency.count).toBe(1);
      expect(gemini.errorRatePct).toBe(0);
    });

    it('orders by sample count (most-used first) and ignores non-provider spans', () => {
      const r = aggregateProviderLatency(spans);
      expect(r.map((x) => x.provider)).toEqual(['GROK', 'GEMINI']); // GROK has more samples
      expect(r.find((x) => x.provider === 'http.request')).toBeUndefined();
    });

    it('derives the provider from the span name when the attribute is absent', () => {
      const r = aggregateProviderLatency([{ name: 'ai.provider.VERTEX', durationMs: 80, status: 'ok' }]);
      expect(r[0].provider).toBe('VERTEX');
    });

    it('is empty for no provider spans', () => {
      expect(aggregateProviderLatency([{ name: 'http.request', durationMs: 5 }])).toEqual([]);
    });
  });
});
