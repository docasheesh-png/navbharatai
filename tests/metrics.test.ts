import { describe, it, expect } from 'vitest';
import { MetricsRegistry, estimateTokens } from '../src/server/lib/metrics';

describe('estimateTokens', () => {
  it('approximates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('MetricsRegistry', () => {
  it('accumulates token usage and computes a non-zero cost per provider', () => {
    const m = new MetricsRegistry();
    m.recordModelCall('claude', 1_000_000, 1_000_000); // $3 in + $15 out = $18
    m.recordModelCall('claude', 0, 0);
    const snap = m.snapshot();
    expect(snap.tokens.claude.requests).toBe(2);
    expect(snap.tokens.claude.inputTokens).toBe(1_000_000);
    expect(snap.tokens.claude.outputTokens).toBe(1_000_000);
    expect(snap.tokens.claude.costUsd).toBeCloseTo(18, 5);
    expect(snap.totalCostUsd).toBeCloseTo(18, 5);
  });

  it('uses a default price for unknown providers', () => {
    const m = new MetricsRegistry();
    m.recordModelCall('mystery', 1_000_000, 0); // default in = 0.2
    expect(m.snapshot().tokens.mystery.costUsd).toBeCloseTo(0.2, 5);
  });

  it('tracks build outcomes with success/preview rates and avg duration', () => {
    const m = new MetricsRegistry();
    m.recordBuild({ ok: true, previewAllowed: true, isEdit: false, ms: 1000, repairAttempts: 1 });
    m.recordBuild({ ok: false, previewAllowed: false, isEdit: true, ms: 3000 });
    const b = m.snapshot().builds;
    expect(b.total).toBe(2);
    expect(b.succeeded).toBe(1);
    expect(b.failed).toBe(1);
    expect(b.previewAllowed).toBe(1);
    expect(b.edits).toBe(1);
    expect(b.freshBuilds).toBe(1);
    expect(b.successRate).toBeCloseTo(0.5, 5);
    expect(b.previewRate).toBeCloseTo(0.5, 5);
    expect(b.avgMs).toBe(2000);
    expect(b.totalRepairAttempts).toBe(1);
  });

  it('snapshot is an immutable copy (no external mutation of internals)', () => {
    const m = new MetricsRegistry();
    m.recordModelCall('groq', 100, 100);
    const snap = m.snapshot();
    snap.tokens.groq.requests = 999;
    expect(m.snapshot().tokens.groq.requests).toBe(1);
  });
});
