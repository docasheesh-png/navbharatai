import { describe, it, expect } from 'vitest';
import { percentile, summarize, checkThresholds } from '../src/server/lib/loadTestStats';

/** P-TQA.3 — load-test statistics (pure). */

describe('loadTestStats — percentile', () => {
  it('computes nearest-rank percentiles', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile(xs, 100)).toBe(10);
    expect(percentile(xs, 0)).toBe(1);
  });
  it('is order-independent and handles empty', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('loadTestStats — summarize', () => {
  it('computes count, error rate, throughput, latency stats', () => {
    const s = summarize([100, 200, 300, 400], 1, 2000); // 4 ok + 1 error over 2s
    expect(s.count).toBe(5);
    expect(s.errors).toBe(1);
    expect(s.errorRate).toBeCloseTo(0.2, 5);
    expect(s.throughputRps).toBe(2.5); // 5 req / 2s
    expect(s.minMs).toBe(100);
    expect(s.maxMs).toBe(400);
    expect(s.meanMs).toBe(250);
    expect(s.p50Ms).toBe(200);
  });
  it('handles an all-error run without NaN', () => {
    const s = summarize([], 3, 1000);
    expect(s.errorRate).toBe(1);
    expect(s.meanMs).toBe(0);
    expect(s.p95Ms).toBe(0);
  });
});

describe('loadTestStats — checkThresholds', () => {
  it('passes within limits, fails when breached', () => {
    const good = summarize([100, 150, 200], 0, 1000);
    expect(checkThresholds(good, { p95Ms: 2000, errorRate: 0.01 }).pass).toBe(true);

    const slow = summarize([3000, 3500, 4000], 0, 1000);
    const r = checkThresholds(slow, { p95Ms: 2000 });
    expect(r.pass).toBe(false);
    expect(r.failures[0]).toContain('p95');
  });
  it('flags an excessive error rate', () => {
    const s = summarize([100], 9, 1000); // 90% errors
    const r = checkThresholds(s, { errorRate: 0.01 });
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('error rate'))).toBe(true);
  });
  it('uses default thresholds (p95<2000ms, err<1%)', () => {
    expect(checkThresholds(summarize([10, 20, 30], 0, 1000)).pass).toBe(true);
  });
});
