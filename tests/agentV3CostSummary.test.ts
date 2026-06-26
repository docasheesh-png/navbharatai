import { describe, it, expect } from 'vitest';
import {
  summarizeCostTelemetry,
  type DailyTelemetryLike,
  type TelemetryBreakdownLike,
} from '../src/lib/agentV3CostSummary';

function bd(over: Partial<TelemetryBreakdownLike> = {}): TelemetryBreakdownLike {
  return { builds: 0, okBuilds: 0, billedUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, ...over };
}

function day(over: Partial<DailyTelemetryLike> = {}): DailyTelemetryLike {
  return {
    date: '2026-06-25',
    totalBuilds: 0,
    okBuilds: 0,
    powerBuilds: 0,
    totalBilledUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    byTaskType: {},
    byStartTier: {},
    ...over,
  };
}

describe('summarizeCostTelemetry', () => {
  it('returns an all-zero honest summary for empty input', () => {
    const s = summarizeCostTelemetry([]);
    expect(s.totalBuilds).toBe(0);
    expect(s.overallSuccessPct).toBe(0);
    expect(s.cheapTierSharePct).toBe(0);
    expect(s.byTier).toEqual([]);
    expect(s.byTask).toEqual([]);
    expect(s.days).toBe(0);
  });

  it('tolerates a non-array input without throwing', () => {
    // @ts-expect-error — intentionally wrong type to prove robustness
    const s = summarizeCostTelemetry(null);
    expect(s.totalBuilds).toBe(0);
  });

  it('sums totals across multiple days', () => {
    const s = summarizeCostTelemetry([
      day({ totalBuilds: 3, okBuilds: 3, totalBilledUsd: 0.06, powerBuilds: 1 }),
      day({ date: '2026-06-24', totalBuilds: 2, okBuilds: 1, totalBilledUsd: 0.5 }),
    ]);
    expect(s.totalBuilds).toBe(5);
    expect(s.okBuilds).toBe(4);
    expect(s.overallSuccessPct).toBe(80); // 4/5
    expect(s.totalBilledUsd).toBe(0.56);
    expect(s.powerBuilds).toBe(1);
    expect(s.days).toBe(2);
  });

  it('computes the headline cheap-tier share from the gemini tier', () => {
    const s = summarizeCostTelemetry([
      day({
        totalBuilds: 10,
        okBuilds: 9,
        byStartTier: {
          gemini: bd({ builds: 7, okBuilds: 7 }),
          sonnet: bd({ builds: 3, okBuilds: 2 }),
        },
      }),
    ]);
    expect(s.cheapTierSharePct).toBe(70); // 7/10 on the cheapest tier
  });

  it('builds per-tier rows ordered cheapest→expensive with real success rates', () => {
    const s = summarizeCostTelemetry([
      day({
        totalBuilds: 4,
        byStartTier: {
          sonnet: bd({ builds: 1, okBuilds: 1, billedUsd: 0.4 }),
          gemini: bd({ builds: 3, okBuilds: 2, inputTokens: 3000, outputTokens: 1500, durationMs: 12000 }),
        },
      }),
    ]);
    expect(s.byTier.map(r => r.key)).toEqual(['gemini', 'sonnet']); // cheapest first
    const gemini = s.byTier[0];
    expect(gemini.builds).toBe(3);
    expect(gemini.sharePct).toBe(75); // 3/4
    expect(gemini.successPct).toBe(66.7); // 2/3
    expect(gemini.avgTokens).toBe(1500); // (3000+1500)/3
    expect(gemini.avgDurationSec).toBe(4); // 12000ms/3 = 4s
  });

  it('merges the same tier across days before computing rates', () => {
    const s = summarizeCostTelemetry([
      day({ totalBuilds: 2, byStartTier: { gemini: bd({ builds: 2, okBuilds: 2 }) } }),
      day({ date: '2026-06-24', totalBuilds: 2, byStartTier: { gemini: bd({ builds: 2, okBuilds: 1 }) } }),
    ]);
    expect(s.byTier).toHaveLength(1);
    expect(s.byTier[0].builds).toBe(4);
    expect(s.byTier[0].successPct).toBe(75); // 3/4 merged
  });

  it('orders task-type rows by build volume', () => {
    const s = summarizeCostTelemetry([
      day({
        totalBuilds: 9,
        byTaskType: {
          simple_app: bd({ builds: 6, okBuilds: 6 }),
          complex_app: bd({ builds: 3, okBuilds: 2 }),
        },
      }),
    ]);
    expect(s.byTask.map(r => r.key)).toEqual(['simple_app', 'complex_app']);
    expect(s.byTask[0].builds).toBe(6);
  });

  it('never divides by zero for a tier with zero builds', () => {
    const s = summarizeCostTelemetry([
      day({ totalBuilds: 0, byStartTier: { gemini: bd({ builds: 0 }) } }),
    ]);
    expect(s.byTier[0].successPct).toBe(0);
    expect(s.byTier[0].avgTokens).toBe(0);
  });
});
