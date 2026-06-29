import { describe, it, expect } from 'vitest';
import {
  foldCostTelemetry,
  type CostTelemetryEntry,
  type DailyCostTelemetryDoc,
} from './AgentV3CostTelemetry';

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
});
