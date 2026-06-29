import { describe, it, expect } from 'vitest';
import { analyzeFinOps, costPerRequest, type FinOpsSnapshot } from './FinOpsAdvisor';

const snap = (over: Partial<FinOpsSnapshot> = {}): FinOpsSnapshot => ({
  tokens: {},
  totalCostUsd: 0,
  builds: {
    total: 0, succeeded: 0, failed: 0, previewAllowed: 0, totalRepairAttempts: 0,
    successRate: 0, previewRate: 0, avgMs: 0,
  },
  ...over,
});

describe('FinOpsAdvisor (P-MON.6)', () => {
  it('HONESTY: no data → no recommendations (never fabricates advice)', () => {
    const r = analyzeFinOps(snap());
    expect(r.recommendations).toEqual([]);
    expect(r.summary.builds).toBe(0);
    expect(r.summary.costPerBuildUsd).toBeNull();
    expect(r.summary.topProvider).toBeNull();
  });

  it('flags spend wasted on failed builds with REAL observed waste', () => {
    const r = analyzeFinOps(snap({
      totalCostUsd: 10,
      builds: { total: 20, succeeded: 12, failed: 8, previewAllowed: 20, totalRepairAttempts: 0, successRate: 0.6, previewRate: 1, avgMs: 100 },
    }));
    const rec = r.recommendations.find((x) => x.id === 'failed-build-spend');
    expect(rec).toBeTruthy();
    expect(rec!.observedWasteUsd).toBeCloseTo(10 * (8 / 20), 4); // $4 wasted
    expect(r.summary.failedBuildRatePct).toBe(40);
  });

  it('escalates to critical when failure rate is very high', () => {
    const r = analyzeFinOps(snap({
      totalCostUsd: 5,
      builds: { total: 20, succeeded: 6, failed: 14, previewAllowed: 20, totalRepairAttempts: 0, successRate: 0.3, previewRate: 1, avgMs: 100 },
    }));
    expect(r.recommendations.find((x) => x.id === 'failed-build-spend')!.severity).toBe('critical');
  });

  it('does not flag tiny samples (below minBuilds)', () => {
    const r = analyzeFinOps(snap({
      totalCostUsd: 5,
      builds: { total: 3, succeeded: 0, failed: 3, previewAllowed: 0, totalRepairAttempts: 9, successRate: 0, previewRate: 0, avgMs: 100 },
    }));
    expect(r.recommendations).toEqual([]);
  });

  it('flags low preview rate', () => {
    const r = analyzeFinOps(snap({
      totalCostUsd: 8,
      builds: { total: 20, succeeded: 20, failed: 0, previewAllowed: 6, totalRepairAttempts: 0, successRate: 1, previewRate: 0.3, avgMs: 100 },
    }));
    expect(r.recommendations.find((x) => x.id === 'low-preview-rate')).toBeTruthy();
  });

  it('flags heavy repair loops', () => {
    const r = analyzeFinOps(snap({
      totalCostUsd: 8,
      builds: { total: 20, succeeded: 20, failed: 0, previewAllowed: 20, totalRepairAttempts: 40, successRate: 1, previewRate: 1, avgMs: 100 },
    }));
    expect(r.recommendations.find((x) => x.id === 'high-repair-loops')).toBeTruthy();
  });

  it('flags provider spend concentration', () => {
    const r = analyzeFinOps(snap({
      totalCostUsd: 10,
      tokens: {
        claude: { requests: 100, inputTokens: 0, outputTokens: 0, costUsd: 8 },
        groq: { requests: 100, inputTokens: 0, outputTokens: 0, costUsd: 2 },
      },
    }));
    const rec = r.recommendations.find((x) => x.id === 'provider-concentration');
    expect(rec).toBeTruthy();
    expect(r.summary.topProvider!.name).toBe('claude');
    expect(r.summary.topProvider!.sharePct).toBe(80);
  });

  it('flags a provider far more expensive per request (data-driven, no hardcoded prices)', () => {
    const r = analyzeFinOps(snap({
      totalCostUsd: 12,
      tokens: {
        claude: { requests: 10, inputTokens: 0, outputTokens: 0, costUsd: 10 }, // $1.0/req
        groq: { requests: 100, inputTokens: 0, outputTokens: 0, costUsd: 2 },   // $0.02/req
      },
    }));
    const rec = r.recommendations.find((x) => x.id === 'expensive-provider-claude');
    expect(rec).toBeTruthy();
    expect(rec!.title).toContain('×');
  });

  it('costPerRequest returns null for zero-request providers', () => {
    expect(costPerRequest({ requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 })).toBeNull();
    expect(costPerRequest({ requests: 4, inputTokens: 0, outputTokens: 0, costUsd: 2 })).toBe(0.5);
  });
});
