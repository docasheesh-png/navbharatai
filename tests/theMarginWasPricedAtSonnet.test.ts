import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldCostTelemetry, buildUsageReport, type CostTelemetryEntry, type DailyCostTelemetryDoc } from '../src/server/AgentV3/AgentV3CostTelemetry';
import { modelUsageFromEntries } from '../src/server/AgentV3/ProviderUsageLedger';
import { sonnetEquivalentUsd } from '../src/server/AgentV3/pricing';

/**
 * 🔴 THE ADMIN'S OWN REPORT SAID `-$1,257` AND IT WAS NOT A LOSS (2026-09-23).
 *
 * The card read: 510 builds, billed $277.67, "Baseline cost" $1,534.69, **Margin (at least)
 * −$1,257.02 in red**. The admin sent it asking about the loss. It is not one. `baselineCostUsd` is
 * `sonnetEquivalentUsd` — every engine priced at Sonnet's $3.00/$15.00 per MTok whatever it really
 * charged — so the figure means "we charged 18% of what Sonnet would have cost", inverted and
 * painted as a deficit.
 *
 * WHAT MAKES IT A DEFECT RATHER THAN A WORDING PREFERENCE. The statement was TRUE: real margin is
 * genuinely ≥ that number, and the module said so in its own docblock. But the bound is so loose it
 * carries no information — a real margin of +$150 and a real loss of −$1,200 both satisfy it — and
 * `text-danger` asserted a verdict the number could not support. **A vacuous bound displayed as a
 * verdict is worse than no number**, because nobody doubts a number.
 *
 * AND THE REAL FIGURE ALREADY EXISTED, ONE VARIABLE AWAY. `decideBuildBilledUsd` prices every build
 * with the per-model rate card (`decided.realCostUsd` + `decided.sandboxUsd`) and the route had both
 * in scope at the telemetry call. They were simply not recorded. So is the model id: the provider
 * map alone cannot price anything, because 'GLM' is both `glm-4.7-flashx` ($0.07/MTok in) and
 * `glm-5.3` ($1.40) — a 20x spread under one key.
 *
 * Four things are locked here, and each is a way this comes back:
 *   1. The baseline really is Sonnet-flat — reproduced from the admin's own six rows.
 *   2. An unmeasured window reports `null`, never 0. "We did not measure" and "it was free" are
 *      different facts and only one may be shown as a number.
 *   3. Coverage is counted, so a partial sum can never be presented as a window's whole spend.
 *   4. The card never paints the Sonnet baseline as a verdict again (source-level guard — no
 *      behavioural test in this repo can see a `tone` prop).
 */

const BASE: CostTelemetryEntry = {
  taskType: 'app', startTier: 'weak', billedUsd: 1, inputTokens: 1000, outputTokens: 100,
  ok: true, powerMode: false, durationMs: 1000,
};

function fold(entries: CostTelemetryEntry[]): DailyCostTelemetryDoc {
  let doc: DailyCostTelemetryDoc | null = null;
  for (const e of entries) doc = foldCostTelemetry(doc, '2026-09-23', e, 1);
  return doc as DailyCostTelemetryDoc;
}

describe('the margin was priced at Sonnet', () => {
  it('reproduces the admin report: every engine priced at the SAME $3/$15, whatever it really is', () => {
    // The six rows exactly as the admin's report carried them. If the baseline were the real rate
    // card these could not all land on one pair of constants — KIMI would be $0.95/$4.00 and GLM
    // $0.07/$0.40. They do, to the last decimal, which is what identifies the pricer.
    const rows: Array<[string, number, number, number]> = [
      ['KIMI', 346_483_853, 5_183_025, 1117.196934],
      ['GLM', 110_068_308, 3_671_097, 385.271379],
      ['VERTEX', 8_605_922, 256_325, 29.662641],
      ['CLAUDE_HAIKU', 3_111, 101_004, 1.524393],
      ['other', 19_821, 44_212, 0.722643],
      ['GEMINI', 65_180, 7_790, 0.31239],
    ];
    for (const [name, input, output, reported] of rows) {
      expect(sonnetEquivalentUsd({ inputTokens: input, outputTokens: output }), name)
        .toBeCloseTo(reported, 5);
      // …and that IS $3.00 in + $15.00 out per MTok.
      expect((input / 1e6) * 3 + (output / 1e6) * 15, `${name} is the flat Sonnet pair`)
        .toBeCloseTo(reported, 5);
    }
  });

  it('records what a build REALLY cost, tokens and VM, beside the baseline', () => {
    const doc = fold([
      { ...BASE, realCostUsd: 0.25, sandboxUsd: 0.05 },
      { ...BASE, realCostUsd: 0.15, sandboxUsd: 0.01 },
    ]);
    expect(doc.totalRealCostUsd).toBeCloseTo(0.4, 6);
    expect(doc.totalSandboxUsd).toBeCloseTo(0.06, 6);
    expect(doc.realCostBuilds).toBe(2);
  });

  it('a build that did not report a real cost adds nothing and is NOT counted as measured', () => {
    const doc = fold([{ ...BASE, realCostUsd: 0.25, sandboxUsd: 0.05 }, { ...BASE }]);
    expect(doc.totalRealCostUsd).toBeCloseTo(0.25, 6);
    expect(doc.realCostBuilds).toBe(1);
    expect(doc.totalBuilds).toBe(2);
  });

  it('a genuinely FREE build still counts toward coverage — the check is on the number, not truthiness', () => {
    // `if (entry.realCostUsd)` would drop this one, and a window of free builds would then report
    // "nothing measured" when every build was measured and every one really cost $0.00.
    const doc = fold([{ ...BASE, realCostUsd: 0, sandboxUsd: 0 }]);
    expect(doc.realCostBuilds).toBe(1);
    expect(doc.totalRealCostUsd).toBe(0);
  });

  it('an unmeasured window reports null, never 0 — and colours nothing', () => {
    const doc = fold([{ ...BASE, providerUsage: { GLM: { inputTokens: 1000, outputTokens: 100 } } }]);
    const report = buildUsageReport([doc], sonnetEquivalentUsd);
    expect(report.totalRealSpendUsd).toBeNull();
    expect(report.realMarginUsd).toBeNull();
    expect(report.lossSpendUsd).toBeNull();
    expect(report.realCostCoverage).toBe(0);
    // The Sonnet baseline is still reported — it just is not the margin.
    expect(report.totalBaselineCostUsd).toBeGreaterThan(0);
  });

  it('the real margin is billed minus (tokens + VM), and coverage says how much of the window it covers', () => {
    const doc = fold([
      { ...BASE, billedUsd: 2, realCostUsd: 0.4, sandboxUsd: 0.1 },
      { ...BASE, billedUsd: 2 },
    ]);
    const report = buildUsageReport([doc], sonnetEquivalentUsd);
    expect(report.totalRealSpendUsd).toBeCloseTo(0.5, 6);
    expect(report.realMarginUsd).toBeCloseTo(4 - 0.5, 6);
    expect(report.realCostBuilds).toBe(1);
    expect(report.realCostCoverage).toBeCloseTo(0.5, 6);
  });

  it('a zeroed build records what it really cost us, beside the historical baseline figure', () => {
    const doc = fold([
      { ...BASE, billedUsd: 0, wasLoss: true, lossRealCostUsd: 9.99, realCostUsd: 0.3, sandboxUsd: 0.2 },
    ]);
    expect(doc.lossBuilds).toBe(1);
    // The old field keeps its old meaning — documents written before this change hold it.
    expect(doc.lossRealCostUsd).toBeCloseTo(9.99, 6);
    // …and the measured twin is what it really cost.
    expect(doc.lossSpendUsd).toBeCloseTo(0.5, 6);
  });

  it('per-model rows separate rungs one engine holds at very different prices', () => {
    const usage = modelUsageFromEntries([
      { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 90 } },
      { provider: 'GLM', model: 'glm-5.3', usage: { inputTokens: 200, outputTokens: 20 } },
      // Same (provider, model) in a second PHASE — slices are keyed by phase too, so these must SUM
      // rather than overwrite each other.
      { provider: 'GLM', model: 'glm-5.3', usage: { inputTokens: 5, outputTokens: 1 }, phase: 'post-build-review' },
      // A runner that never named a model must not be folded into a real rung's row.
      { provider: 'KIMI', usage: { inputTokens: 7, outputTokens: 2 } },
    ]);
    expect(usage['GLM|glm-4.7-flashx']).toEqual({ inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 90 });
    expect(usage['GLM|glm-5.3'].inputTokens).toBe(205);
    expect(usage['GLM|glm-5.3'].outputTokens).toBe(21);
    expect(usage['KIMI|']).toBeTruthy();

    const doc = fold([{ ...BASE, modelUsage: usage }]);
    const report = buildUsageReport([doc], sonnetEquivalentUsd);
    const flashx = report.perModel.find(r => r.model === 'glm-4.7-flashx');
    const five = report.perModel.find(r => r.model === 'glm-5.3');
    const unnamed = report.perModel.find(r => r.provider === 'KIMI');
    expect(flashx?.cacheReadInputTokens).toBe(90);
    expect(five?.inputTokens).toBe(205);
    expect(unnamed?.model).toBe('unknown');
  });

  it('the report carries how deep down the ladder builds finished', () => {
    const doc = fold([
      { ...BASE, ladderDepth: 1 }, { ...BASE, ladderDepth: 1 }, { ...BASE, ladderDepth: 2 }, { ...BASE },
    ]);
    const report = buildUsageReport([doc], sonnetEquivalentUsd);
    expect(report.byLadderDepth['1']).toBe(2);
    expect(report.byLadderDepth['2']).toBe(1);
    // A build whose rung could not be attributed is folded, never dropped — dropping it would make
    // the rung-1 share look better than it is.
    expect(report.byLadderDepth['unknown']).toBe(1);
  });

  it('REVERSION GUARD: the card never paints the Sonnet baseline as a verdict again', () => {
    // `tsc` and every behavioural test in this repo are blind to a `tone` prop on a Stat, which is
    // exactly how a bound that could never be positive came to be rendered in red.
    const src = readFileSync(join(process.cwd(), 'src/components/admin/EngineReportsPanel.tsx'), 'utf8');
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, 'marginUsd (the Sonnet baseline) must not drive a colour')
      .not.toMatch(/tone=\{[^}]*\bmarginUsd\b/);
    expect(code, 'the card must lead with the measured margin').toContain('realMarginUsd');
    expect(code, 'a partial window must state its coverage').toContain('realCostCoverage');
  });
});
