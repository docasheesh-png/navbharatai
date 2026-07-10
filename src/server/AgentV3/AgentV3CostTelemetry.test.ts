import { describe, it, expect } from 'vitest';
import {
  foldCostTelemetry,
  buildUsageReport,
  type CostTelemetryEntry,
  type DailyCostTelemetryDoc,
} from './AgentV3CostTelemetry';
import { sonnetEquivalentUsd } from './pricing';

const DATE = '2026-06-25';

function entry(over: Partial<CostTelemetryEntry> = {}): CostTelemetryEntry {
  return {
    taskType: 'simple_app',
    startTier: 'gemini',
    billedUsd: 0.02,
    inputTokens: 1000,
    outputTokens: 500,
    ok: true,
    powerMode: false,
    durationMs: 4000,
    ...over,
  };
}

describe('foldCostTelemetry (pure cost-ladder aggregation)', () => {
  it('starts a fresh day doc from null and records the first build', () => {
    const doc = foldCostTelemetry(null, DATE, entry(), 111);
    expect(doc.date).toBe(DATE);
    expect(doc.totalBuilds).toBe(1);
    expect(doc.okBuilds).toBe(1);
    expect(doc.powerBuilds).toBe(0);
    expect(doc.totalBilledUsd).toBe(0.02);
    expect(doc.totalInputTokens).toBe(1000);
    expect(doc.totalOutputTokens).toBe(500);
    expect(doc.totalDurationMs).toBe(4000);
    expect(doc.updatedAt).toBe(111);
    expect(doc.byTaskType.simple_app.builds).toBe(1);
    expect(doc.byStartTier.gemini.builds).toBe(1);
  });

  it('accumulates multiple builds into the running totals', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ billedUsd: 0.02 }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ billedUsd: 0.03, inputTokens: 2000, outputTokens: 1000, durationMs: 6000 }), 2);
    expect(doc.totalBuilds).toBe(2);
    expect(doc.totalBilledUsd).toBe(0.05);
    expect(doc.totalInputTokens).toBe(3000);
    expect(doc.totalOutputTokens).toBe(1500);
    expect(doc.totalDurationMs).toBe(10000);
    expect(doc.byStartTier.gemini.builds).toBe(2);
    expect(doc.byTaskType.simple_app.builds).toBe(2);
  });

  it('breaks down by task type AND start tier independently', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ taskType: 'simple_app', startTier: 'gemini' }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ taskType: 'complex_app', startTier: 'sonnet', billedUsd: 0.5 }), 2);
    expect(Object.keys(doc.byTaskType).sort()).toEqual(['complex_app', 'simple_app']);
    expect(Object.keys(doc.byStartTier).sort()).toEqual(['gemini', 'sonnet']);
    expect(doc.byTaskType.complex_app.billedUsd).toBe(0.5);
    expect(doc.byStartTier.sonnet.builds).toBe(1);
    expect(doc.byStartTier.gemini.builds).toBe(1);
  });

  it('tracks per-tier success rate (okBuilds vs builds) — the quality signal', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ startTier: 'gemini', ok: true }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ startTier: 'gemini', ok: false }), 2);
    doc = foldCostTelemetry(doc, DATE, entry({ startTier: 'gemini', ok: true }), 3);
    expect(doc.byStartTier.gemini.builds).toBe(3);
    expect(doc.byStartTier.gemini.okBuilds).toBe(2); // 2/3 succeeded
    expect(doc.okBuilds).toBe(2);
  });

  it('counts power-mode builds separately', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ powerMode: true, startTier: 'opus' }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ powerMode: false }), 2);
    expect(doc.powerBuilds).toBe(1);
    expect(doc.totalBuilds).toBe(2);
  });

  it('keeps billed USD rounded to 6 dp (no float drift)', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ billedUsd: 0.1 }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ billedUsd: 0.2 }), 2);
    expect(doc.totalBilledUsd).toBe(0.3); // not 0.30000000000000004
  });

  it('maps empty task type / tier to an "unknown" slice rather than dropping it', () => {
    const doc = foldCostTelemetry(null, DATE, entry({ taskType: '', startTier: '' }), 1);
    expect(doc.byTaskType.unknown.builds).toBe(1);
    expect(doc.byStartTier.unknown.builds).toBe(1);
  });

  it('does not mutate the existing doc (pure fold)', () => {
    const first = foldCostTelemetry(null, DATE, entry(), 1);
    const snapshot = JSON.stringify(first);
    foldCostTelemetry(first, DATE, entry({ billedUsd: 1 }), 2);
    expect(JSON.stringify(first)).toBe(snapshot); // unchanged
  });

  // PR4 — deliveredVia split (cheap-floor-vs-Claude rollback tripwire).
  it('breaks down by deliveredVia provider — the cheap-floor-vs-Claude split', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ deliveredVia: 'GLM' }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ deliveredVia: 'GLM' }), 2);
    doc = foldCostTelemetry(doc, DATE, entry({ deliveredVia: 'CLAUDE', ok: false }), 3);
    expect(Object.keys(doc.byDeliveredVia).sort()).toEqual(['CLAUDE', 'GLM']);
    expect(doc.byDeliveredVia.GLM.builds).toBe(2);
    expect(doc.byDeliveredVia.GLM.okBuilds).toBe(2);
    expect(doc.byDeliveredVia.CLAUDE.builds).toBe(1);
    expect(doc.byDeliveredVia.CLAUDE.okBuilds).toBe(0); // a fallback that failed
  });

  it('folds a missing deliveredVia under "unknown" (non-agentic SimpleBuild/OneShot lanes)', () => {
    const doc = foldCostTelemetry(null, DATE, entry(), 1); // no deliveredVia
    expect(doc.byDeliveredVia.unknown.builds).toBe(1);
  });

  it('tolerates an older day doc that predates byDeliveredVia (no throw, self-extends)', () => {
    // Simulate a doc written before PR4 — byDeliveredVia absent entirely.
    const legacy = foldCostTelemetry(null, DATE, entry({ deliveredVia: 'GLM' }), 1);
    delete (legacy as Partial<DailyCostTelemetryDoc>).byDeliveredVia;
    const next = foldCostTelemetry(legacy, DATE, entry({ deliveredVia: 'CLAUDE' }), 2);
    expect(next.byDeliveredVia.CLAUDE.builds).toBe(1);
    expect(next.totalBuilds).toBe(2);
  });

  // T1-escalation-on — the canary A/B split ('in' vs 'out' vs 'off') + the escalated-builds counter.
  it('breaks down by escalation cohort — the in-vs-out A/B split the rollout decision needs', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ escalationCohort: 'in', ok: true }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ escalationCohort: 'in', ok: false }), 2);
    doc = foldCostTelemetry(doc, DATE, entry({ escalationCohort: 'out', ok: true }), 3);
    expect(doc.byEscalationCohort!.in.builds).toBe(2);
    expect(doc.byEscalationCohort!.in.okBuilds).toBe(1); // in-canary success rate measurable
    expect(doc.byEscalationCohort!.out.builds).toBe(1);
    expect(doc.byEscalationCohort!.out.okBuilds).toBe(1); // control-group success rate measurable
  });

  it('counts escalatedBuilds only when the ladder actually climbed (escalations > 0)', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ escalationCohort: 'in', escalations: 0 }), 1); // first tier delivered
    doc = foldCostTelemetry(doc, DATE, entry({ escalationCohort: 'in', escalations: 1 }), 2); // climbed once
    doc = foldCostTelemetry(doc, DATE, entry({ escalationCohort: 'off' }), 3); // escalations absent
    expect(doc.escalatedBuilds).toBe(1);
    expect(doc.totalBuilds).toBe(3);
  });

  it('folds a missing cohort under "unknown" and tolerates older docs without the fields', () => {
    const legacy = foldCostTelemetry(null, DATE, entry(), 1); // no cohort → 'unknown'
    expect(legacy.byEscalationCohort!.unknown.builds).toBe(1);
    delete (legacy as Partial<DailyCostTelemetryDoc>).byEscalationCohort;
    delete (legacy as Partial<DailyCostTelemetryDoc>).escalatedBuilds;
    const next = foldCostTelemetry(legacy, DATE, entry({ escalationCohort: 'in', escalations: 2 }), 2);
    expect(next.byEscalationCohort!.in.builds).toBe(1);
    expect(next.escalatedBuilds).toBe(1);
    expect(next.totalBuilds).toBe(2);
  });

  // Billing Phase 3 — per-provider token folding + loss accounting.
  it('folds per-provider token usage across builds (admin usage-report source)', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ providerUsage: { GLM: { inputTokens: 800_000, outputTokens: 140_000 } } }), 1);
    doc = foldCostTelemetry(doc, DATE, entry({ providerUsage: { GLM: { inputTokens: 200_000, outputTokens: 40_000 }, CLAUDE: { inputTokens: 150_000, outputTokens: 20_000 } } }), 2);
    expect(doc.byProviderUsage!.GLM).toEqual({ builds: 2, inputTokens: 1_000_000, outputTokens: 180_000 });
    expect(doc.byProviderUsage!.CLAUDE).toEqual({ builds: 1, inputTokens: 150_000, outputTokens: 20_000 });
  });

  it('counts loss builds and sums the eaten baseline cost', () => {
    let doc: DailyCostTelemetryDoc | null = null;
    doc = foldCostTelemetry(doc, DATE, entry({ billedUsd: 0.5 }), 1); // normal, not a loss
    doc = foldCostTelemetry(doc, DATE, entry({ billedUsd: 0, wasLoss: true, lossRealCostUsd: 0.12 }), 2);
    doc = foldCostTelemetry(doc, DATE, entry({ billedUsd: 0, wasLoss: true, lossRealCostUsd: 0.08 }), 3);
    expect(doc.lossBuilds).toBe(2);
    expect(doc.lossRealCostUsd).toBe(0.2);
  });

  it('tolerates older docs without the Phase-3 fields (self-extends, no throw)', () => {
    const legacy = foldCostTelemetry(null, DATE, entry(), 1);
    delete (legacy as Partial<DailyCostTelemetryDoc>).byProviderUsage;
    delete (legacy as Partial<DailyCostTelemetryDoc>).lossBuilds;
    delete (legacy as Partial<DailyCostTelemetryDoc>).lossRealCostUsd;
    const next = foldCostTelemetry(legacy, DATE, entry({ providerUsage: { GLM: { inputTokens: 10, outputTokens: 5 } }, wasLoss: true, lossRealCostUsd: 0.01 }), 2);
    expect(next.byProviderUsage!.GLM.builds).toBe(1);
    expect(next.lossBuilds).toBe(1);
    expect(next.lossRealCostUsd).toBe(0.01);
  });
});

describe('buildUsageReport — the admin usage-report shape (per-provider tokens + margin)', () => {
  it('sums per-provider tokens, prices the baseline, and computes achieved margin', () => {
    const day1 = foldCostTelemetry(null, '2026-06-24', entry({ billedUsd: 2, providerUsage: { GLM: { inputTokens: 800_000, outputTokens: 140_000 } } }), 1);
    const day2 = foldCostTelemetry(null, '2026-06-25', entry({ billedUsd: 3, providerUsage: { GLM: { inputTokens: 200_000, outputTokens: 40_000 }, CLAUDE: { inputTokens: 150_000, outputTokens: 20_000 } } }), 1);
    const report = buildUsageReport([day2, day1], sonnetEquivalentUsd); // newest-first, as the store returns
    expect(report.fromDate).toBe('2026-06-24');
    expect(report.toDate).toBe('2026-06-25');
    expect(report.totalBuilds).toBe(2);
    expect(report.totalBilledUsd).toBe(5);
    const glm = report.perProvider.find(r => r.provider === 'GLM')!;
    expect(glm.builds).toBe(2);
    expect(glm.inputTokens).toBe(1_000_000);
    expect(glm.outputTokens).toBe(180_000);
    expect(glm.baselineCostUsd).toBeCloseTo(sonnetEquivalentUsd({ inputTokens: 1_000_000, outputTokens: 180_000 }), 6);
    // margin = billed − baseline; ratio = billed / baseline
    expect(report.marginUsd).toBeCloseTo(5 - report.totalBaselineCostUsd, 6);
    expect(report.marginRatio).toBeCloseTo(5 / report.totalBaselineCostUsd, 6);
  });

  it('rolls up losses across the window', () => {
    const d = foldCostTelemetry(null, '2026-06-25', entry({ billedUsd: 0, wasLoss: true, lossRealCostUsd: 0.15 }), 1);
    const report = buildUsageReport([d], sonnetEquivalentUsd);
    expect(report.lossBuilds).toBe(1);
    expect(report.lossRealCostUsd).toBe(0.15);
  });

  it('empty history → a zeroed report, no divide-by-zero', () => {
    const report = buildUsageReport([], sonnetEquivalentUsd);
    expect(report.totalBuilds).toBe(0);
    expect(report.marginRatio).toBe(0);
    expect(report.perProvider).toEqual([]);
  });
});
