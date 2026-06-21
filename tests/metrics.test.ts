import { describe, it, expect } from 'vitest';
import { MetricsRegistry, estimateTokens } from '../src/server/lib/metrics';

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('rounds up for non-multiples of 4', () => {
    expect(estimateTokens('hello')).toBe(2);
  });
});

describe('MetricsRegistry', () => {
  it('snapshot() returns 0-build stats on a fresh instance', () => {
    const reg = new MetricsRegistry();
    const snap = reg.snapshot();
    expect(snap.builds.total).toBe(0);
    expect(snap.builds.successRate).toBe(0);
    expect(snap.totalCostUsd).toBe(0);
  });

  it('recordBuild increments total and succeeded on success', () => {
    const reg = new MetricsRegistry();
    reg.recordBuild({ ok: true, previewAllowed: true, ms: 1000 });
    const snap = reg.snapshot();
    expect(snap.builds.total).toBe(1);
    expect(snap.builds.succeeded).toBe(1);
    expect(snap.builds.failed).toBe(0);
  });

  it('recordBuild increments failed on failure', () => {
    const reg = new MetricsRegistry();
    reg.recordBuild({ ok: false, previewAllowed: false, ms: 500 });
    expect(reg.snapshot().builds.failed).toBe(1);
  });

  it('successRate is computed from succeeded/total', () => {
    const reg = new MetricsRegistry();
    reg.recordBuild({ ok: true, previewAllowed: true, ms: 1 });
    reg.recordBuild({ ok: false, previewAllowed: false, ms: 1 });
    expect(reg.snapshot().builds.successRate).toBe(0.5);
  });

  it('avgMs is the mean of all recorded build durations', () => {
    const reg = new MetricsRegistry();
    reg.recordBuild({ ok: true, previewAllowed: false, ms: 1000 });
    reg.recordBuild({ ok: true, previewAllowed: false, ms: 3000 });
    expect(reg.snapshot().builds.avgMs).toBe(2000);
  });

  it('recordModelCall accumulates tokens and estimates cost', () => {
    const reg = new MetricsRegistry();
    reg.recordModelCall('groq', 1_000_000, 500_000);
    const snap = reg.snapshot();
    const groq = snap.tokens['groq'];
    expect(groq.requests).toBe(1);
    expect(groq.inputTokens).toBe(1_000_000);
    expect(groq.outputTokens).toBe(500_000);
    expect(groq.costUsd).toBeGreaterThan(0);
  });

  it('recordModelCall aggregates multiple calls for the same provider', () => {
    const reg = new MetricsRegistry();
    reg.recordModelCall('gemini', 100, 200);
    reg.recordModelCall('gemini', 50, 100);
    const snap = reg.snapshot();
    expect(snap.tokens['gemini'].requests).toBe(2);
    expect(snap.tokens['gemini'].inputTokens).toBe(150);
    expect(snap.tokens['gemini'].outputTokens).toBe(300);
  });

  it('totalCostUsd sums costs across all providers', () => {
    const reg = new MetricsRegistry();
    reg.recordModelCall('groq', 1_000_000, 0);
    reg.recordModelCall('gemini', 1_000_000, 0);
    expect(reg.snapshot().totalCostUsd).toBeGreaterThan(0);
  });

  it('snapshot() returns a deep copy — mutations do not affect stored state', () => {
    const reg = new MetricsRegistry();
    reg.recordModelCall('claude', 100, 50);
    const snap1 = reg.snapshot();
    snap1.tokens['claude'].requests = 999;
    const snap2 = reg.snapshot();
    expect(snap2.tokens['claude'].requests).toBe(1);
  });
});
