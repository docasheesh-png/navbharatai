import { describe, it, expect } from 'vitest';
import { generateInsights, generateOpsReport, answerMetricQuery, hasNoTelemetry } from './AiInsights';
import type { MetricsSnapshot } from './metrics';

function snap(partial: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    tokens: {},
    totalCostUsd: 0,
    builds: {
      total: 0, succeeded: 0, failed: 0, previewAllowed: 0, edits: 0, freshBuilds: 0,
      totalMs: 0, totalRepairAttempts: 0, successRate: 0, previewRate: 0, avgMs: 0,
    },
    since: '2026-07-06T00:00:00.000Z',
    ...partial,
  };
}

describe('hasNoTelemetry', () => {
  it('is true only when there are no builds and no provider calls', () => {
    expect(hasNoTelemetry(snap())).toBe(true);
    expect(hasNoTelemetry(snap({ builds: { ...snap().builds, total: 1 } }))).toBe(false);
    expect(hasNoTelemetry(snap({ tokens: { claude: { requests: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.01 } } }))).toBe(false);
  });
});

describe('generateInsights', () => {
  it('returns a single honest "no data" insight when nothing is recorded', () => {
    const ins = generateInsights(snap());
    expect(ins).toHaveLength(1);
    expect(ins[0].id).toBe('no-data');
    expect(ins[0].severity).toBe('info');
  });

  it('does not emit build-quality insights below the minimum sample', () => {
    const ins = generateInsights(snap({
      builds: { ...snap().builds, total: 3, succeeded: 3, successRate: 1 },
    }));
    expect(ins.find((i) => i.id === 'success-rate')).toBeUndefined();
  });

  it('flags a low success rate as critical and reports the real counts', () => {
    const ins = generateInsights(snap({
      builds: { ...snap().builds, total: 10, succeeded: 5, failed: 5, previewAllowed: 5, successRate: 0.5, previewRate: 0.5, avgMs: 60_000 },
    }));
    const sr = ins.find((i) => i.id === 'success-rate')!;
    expect(sr.severity).toBe('critical');
    expect(sr.detail).toContain('5 of 10');
    // critical sorts before info/good
    expect(ins[0].severity).toBe('critical');
  });

  it('surfaces the top-spend provider and its real share', () => {
    const ins = generateInsights(snap({
      totalCostUsd: 1.0,
      tokens: {
        claude: { requests: 10, inputTokens: 1000, outputTokens: 1000, costUsd: 0.8 },
        gemini: { requests: 10, inputTokens: 1000, outputTokens: 1000, costUsd: 0.2 },
      },
    }));
    const top = ins.find((i) => i.id === 'top-spend')!;
    expect(top.headline).toContain('claude');
    expect(top.headline).toContain('80%');
  });

  it('computes the per-request cost spread between providers', () => {
    const ins = generateInsights(snap({
      totalCostUsd: 1.02,
      tokens: {
        claude: { requests: 1, inputTokens: 1000, outputTokens: 1000, costUsd: 1.0 }, // $1.00/req
        groq: { requests: 10, inputTokens: 1000, outputTokens: 1000, costUsd: 0.02 }, // $0.002/req
      },
    }));
    const spread = ins.find((i) => i.id === 'provider-cost-spread')!;
    expect(spread).toBeTruthy();
    expect(spread.headline).toContain('claude');
    expect(spread.headline).toContain('groq');
  });
});

describe('generateOpsReport', () => {
  it('renders a plain-text report with the real headline numbers', () => {
    const report = generateOpsReport(snap({
      totalCostUsd: 0.5,
      tokens: { claude: { requests: 5, inputTokens: 100, outputTokens: 100, costUsd: 0.5 } },
      builds: { ...snap().builds, total: 8, succeeded: 7, failed: 1, previewAllowed: 7, successRate: 0.875, previewRate: 0.875, avgMs: 90_000 },
    }), 'last 24h');
    expect(report).toContain('last 24h');
    expect(report).toContain('8 total');
    expect(report).toContain('88%'); // success rate rounded
    expect(report).toContain('$0.50');
  });
});

describe('answerMetricQuery', () => {
  const s = snap({
    totalCostUsd: 0.5,
    tokens: {
      claude: { requests: 10, inputTokens: 100, outputTokens: 100, costUsd: 0.4 },
      groq: { requests: 20, inputTokens: 100, outputTokens: 100, costUsd: 0.1 },
    },
    builds: { ...snap().builds, total: 10, succeeded: 8, failed: 2, previewAllowed: 8, successRate: 0.8, previewRate: 0.8, avgMs: 75_000 },
  });

  it('answers cost questions from real spend', () => {
    const a = answerMetricQuery(s, 'what is my total cost?');
    expect(a.matched).toBe(true);
    expect(a.answer).toContain('$0.50');
    expect(a.answer).toContain('claude');
  });

  it('answers success-rate questions', () => {
    const a = answerMetricQuery(s, 'how many builds failed?');
    expect(a.matched).toBe(true);
    expect(a.answer).toContain('80%');
    expect(a.answer).toContain('2 failed');
  });

  it('answers speed questions', () => {
    expect(answerMetricQuery(s, 'why are builds so slow?').answer).toContain('75.0s');
  });

  it('answers provider questions with cheapest-per-request', () => {
    const a = answerMetricQuery(s, 'which provider is cheapest?');
    expect(a.matched).toBe(true);
    expect(a.answer).toContain('groq'); // groq is cheaper per request
  });

  it('returns matched:false with an honest capability list for an unknown question', () => {
    const a = answerMetricQuery(s, 'what is the meaning of life?');
    expect(a.matched).toBe(false);
    expect(a.answer).toContain('cost');
    expect(a.answer).toContain('success');
  });

  it('is honest when there is no telemetry', () => {
    const a = answerMetricQuery(snap(), 'what is my cost?');
    expect(a.matched).toBe(true);
    expect(a.answer.toLowerCase()).toContain('no telemetry');
  });
});
