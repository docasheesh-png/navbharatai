import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evidenceFromResult, gateStateFromIssues, previewEvidenceFrom } from './benchEvidence';
import { metricsFromEvents, type BuildMetrics } from '../BakeoffMetrics';
import {
  buildSucceeded, compareEvidence, falsePositive, formatEvidenceComparison, formatEvidenceSummary, summarizeEvidence, verifiedOutcome,
  type BenchResultFile, type BenchRun,
} from './benchHarness';

/**
 * P1-1 (audit 2026-10-16) — the benchmark reads what each build cost and what it proved, from the build's OWN report.
 * The fixtures are slices of REAL reports (398db9f3 PAWTRACE, 67a2b0a2 portfolio); the expected numbers are theirs.
 */
const load = (name: string) => JSON.parse(readFileSync(`tests/fixtures/bench/${name}`, 'utf8')) as Record<string, unknown>;
const pawtrace = load('pawtrace-398db9f3.min.json');
const portfolio = load('portfolio-67a2b0a2.min.json');

describe('the real PAWTRACE build (111 model calls, 25 minutes, RED gate)', () => {
  const ev = evidenceFromResult(pawtrace);
  it('reads the tokens exactly as the providers reported them, cache included', () => {
    expect(ev.llmCalls).toBe(111);
    expect(ev.llmCallsFailed).toBe(1);
    expect(ev.inputTokens).toBe(5_959_463);   // KIMI 5,956,228 + the Haiku planner 3,235
    expect(ev.cachedInputTokens).toBe(5_723_136);
    expect(ev.outputTokens).toBe(63_693);     // 47,693 + the planner's 16,000
    expect(ev.providers.sort()).toEqual(['CLAUDE_HAIKU', 'KIMI']);
  });
  it('reads the clock and the real provider cost the report itself recorded', () => {
    expect(ev.buildMs).toBe(1_510_936);
    expect(ev.modelMs).toBeGreaterThan(0);
    expect(ev.realCostUsd).toBeCloseTo(1.58284, 5);
    expect(ev.sandboxCostUsd).toBeCloseTo(0.069476, 6);
  });
  it('reads the gate and the preview from the platform\'s own observations', () => {
    expect(ev.gateState).toBe('red');
    expect(ev.previewEvidence).toBe('rendered'); // IN_BUILD_GREEN: a real browser rendered it at +1,226 s
  });
});

describe('the real portfolio build (nothing written, RED)', () => {
  const ev = evidenceFromResult(portfolio);
  it('counts the failed calls as calls — they cost clock', () => {
    expect(ev.llmCalls).toBe(7);
    expect(ev.llmCallsFailed).toBe(2);
    expect(ev.inputTokens).toBe(154_320);
    expect(ev.cachedInputTokens).toBe(113_921);
    expect(ev.outputTokens).toBe(5_230);
    expect(ev.buildMs).toBe(604_090);
  });
  it('no preview was ever seen, and the gate is RED', () => {
    expect(ev.gateState).toBe('red');
    expect(ev.previewEvidence).toBe('not-proven');
  });
});

describe('a missing figure is null, NEVER zero', () => {
  it('a user-scoped report (no per-call ledger, no provider tokens) yields null tokens, not a free build', () => {
    const ev = evidenceFromResult({ ok: true, diagnostics: { startedAt: 1, endedAt: 2001, issues: [{ code: 'RELEASE_GATE', message: 'Release gate: GREEN — Shippable' }] } });
    expect(ev.llmCalls).toBeNull();
    expect(ev.inputTokens).toBeNull();
    expect(ev.cachedInputTokens).toBeNull();
    expect(ev.outputTokens).toBeNull();
    expect(ev.realCostUsd).toBeNull();
    expect(ev.gateState).toBe('green');
    expect(ev.buildMs).toBe(2000);
  });
  it('no result, no diagnostics: everything is null', () => {
    for (const r of [null, undefined, {}]) {
      const ev = evidenceFromResult(r as never);
      expect(Object.values({ ...ev, providers: null })).toSatisfy((vs: unknown[]) => vs.every((v) => v === null));
    }
  });
  it('per-call fallback sums the calls when the provider ledger is absent, and says nothing about cache', () => {
    const ev = evidenceFromResult({ diagnostics: { llmCalls: [{ inputTokens: 10, outputTokens: 2, latencyMs: 5, ok: true }, { inputTokens: 20, outputTokens: 3, latencyMs: 7, ok: true }] } });
    expect(ev.inputTokens).toBe(30);
    expect(ev.outputTokens).toBe(5);
    expect(ev.cachedInputTokens).toBeNull();
    expect(ev.modelMs).toBe(12);
  });
  it('garbage fields are ignored, not summed', () => {
    const ev = evidenceFromResult({ diagnostics: { providerTokens: { X: { inputTokens: 'lots', outputTokens: -4, cacheReadInputTokens: Number.NaN } }, llmCalls: 'no' } });
    expect(ev.inputTokens).toBeNull();
    expect(ev.outputTokens).toBeNull();
    expect(ev.cachedInputTokens).toBeNull();
    expect(ev.llmCalls).toBeNull();
  });
  it('withholds incomplete provider totals independently instead of rewarding partial telemetry', () => {
    const ev = evidenceFromResult({ diagnostics: { providerTokens: {
      A: { inputTokens: 10, outputTokens: 2 }, B: { outputTokens: 3 },
    } } });
    expect(ev.inputTokens).toBeNull();
    expect(ev.outputTokens).toBe(5);
  });
  it('does not drop malformed provider rows from the cost comparison', () => {
    const ev = evidenceFromResult({ diagnostics: { providerTokens: {
      A: { inputTokens: 10, outputTokens: 2 }, B: null,
    } } });
    expect(ev.inputTokens).toBeNull();
    expect(ev.outputTokens).toBeNull();
  });
  it('does not drop malformed calls from token and latency totals', () => {
    const ev = evidenceFromResult({ diagnostics: { llmCalls: [
      { inputTokens: 10, outputTokens: 2, latencyMs: 5 }, null,
    ] } });
    expect(ev.inputTokens).toBeNull();
    expect(ev.outputTokens).toBeNull();
    expect(ev.modelMs).toBeNull();
  });
  it('withholds partial per-call totals and latency, retaining independently complete fields', () => {
    const ev = evidenceFromResult({ diagnostics: { llmCalls: [
      { inputTokens: 10, outputTokens: 2, latencyMs: 5, ok: true },
      { outputTokens: 0, ok: false },
    ] } });
    expect(ev.inputTokens).toBeNull();
    expect(ev.modelMs).toBeNull();
    expect(ev.outputTokens).toBe(2);
    expect(ev.llmCalls).toBe(2);
    expect(ev.llmCallsFailed).toBe(1);
  });
  it('explicit zero is measured; absent, invalid and overflowing figures are unknown', () => {
    const zero = evidenceFromResult({ diagnostics: { llmCalls: [{ inputTokens: 0, outputTokens: 0, latencyMs: 0 }] } });
    expect(zero.inputTokens).toBe(0);
    expect(zero.outputTokens).toBe(0);
    expect(zero.modelMs).toBe(0);
    for (const value of [undefined, null, -1, '10', Number.NaN, Number.POSITIVE_INFINITY]) {
      const ev = evidenceFromResult({ diagnostics: { llmCalls: [{ inputTokens: value, outputTokens: value, latencyMs: value }] } });
      expect(ev.inputTokens).toBeNull();
      expect(ev.outputTokens).toBeNull();
      expect(ev.modelMs).toBeNull();
    }
    const overflow = evidenceFromResult({ diagnostics: { llmCalls: [
      { inputTokens: Number.MAX_VALUE }, { inputTokens: Number.MAX_VALUE },
    ] } });
    expect(overflow.inputTokens).toBeNull();
  });
});

describe('the gate and the preview', () => {
  const issue = (code: string, message = '') => ({ code, message });
  it('the LAST gate line wins (a re-run replaces it) and only the gate\'s own wording counts', () => {
    expect(gateStateFromIssues([issue('RELEASE_GATE', 'Release gate: RED — x'), issue('RELEASE_GATE', 'Release gate: YELLOW — y')])).toBe('yellow');
    expect(gateStateFromIssues([issue('RELEASE_GATE', 'something else')])).toBeNull();
    expect(gateStateFromIssues([issue('OTHER', 'Release gate: RED')])).toBeNull();
    expect(gateStateFromIssues('nope')).toBeNull();
  });
  it('a failure at the end outranks an earlier render; a render needs the platform\'s own flag or code', () => {
    expect(previewEvidenceFrom({ appRendered: true }, [issue('OUTCOME_PREVIEW_FAILED')])).toBe('failed');
    expect(previewEvidenceFrom({ appRendered: true }, [])).toBe('rendered');
    expect(previewEvidenceFrom({}, [issue('IN_BUILD_GREEN')])).toBe('rendered');
    expect(previewEvidenceFrom({ appRendered: false }, [])).toBe('not-proven');
    expect(previewEvidenceFrom({}, [issue('PREVIEW_PUBLISHED')])).toBe('not-proven'); // an address that is up is NOT a render
    expect(previewEvidenceFrom({}, undefined)).toBeNull();
  });
});

describe('the stream reader carries the evidence, and old shapes still parse', () => {
  it('metricsFromEvents attaches it from the result event', () => {
    const m = metricsFromEvents([{ type: 'file_changed', change: { path: 'a.ts' } }, { type: 'result', ok: true, billedUsd: 0.5, ...pawtrace }, { type: 'done', ok: true }]);
    expect(m.evidence?.llmCalls).toBe(111);
    expect(m.filesCreated).toBe(1);
  });
  it('a stream with no result event has no evidence field at all (an old result file reads the same)', () => {
    expect(metricsFromEvents([{ type: 'done', ok: true }]).evidence).toBeUndefined();
  });
});

const metrics = (over: Partial<BuildMetrics> = {}): BuildMetrics => ({
  filesCreated: 8, ok: true, readinessScore: 80, billedUsd: 1, toolCalls: 10, toolErrors: 0, providerFallbacks: 0, geminiTrap: false, errored: false, ...over,
});
const evOf = (over: object) => evidenceFromResult({ ...over });
const run = (id: string, m: BuildMetrics, seconds = 100): BenchRun => ({ id, lang: 'english', complexity: 'simple', attempt: 1, seconds, metrics: m, success: buildSucceeded(m) });
const file = (label: string, runs: BenchRun[]): BenchResultFile => ({ label, set: 'smoke', baseUrl: 'x', startedAt: 'x', flags: [], runs });

describe('FALSE SUCCESS: ok:true beside a RED gate (audit P0-1, seen from the benchmark)', () => {
  const gateRed = { diagnostics: { issues: [{ code: 'RELEASE_GATE', message: 'Release gate: RED — Not shippable — the app did not come up or did not render.' }] }, appRendered: false };
  it('`buildSucceeded` still calls it a success — its definition is deliberately unchanged', () => {
    const m = metrics({ evidence: evOf(gateRed) });
    expect(buildSucceeded(m)).toBe(true);
  });
  it('…but the evidence contradicts it, and that is counted as a false positive', () => {
    const m = metrics({ evidence: evOf(gateRed) });
    expect(verifiedOutcome(m)).toBe('contradicted');
    expect(falsePositive(m)).toBe(true);
  });
  it('a failed preview contradicts a success even with no gate line', () => {
    expect(verifiedOutcome(metrics({ evidence: evOf({ diagnostics: { issues: [{ code: 'OUTCOME_PREVIEW_FAILED', message: 'x' }] } }) }))).toBe('contradicted');
  });
  it('proven needs BOTH a non-RED gate and a real render; a build with no evidence is unproven, never proven', () => {
    const green = { appRendered: true, diagnostics: { issues: [{ code: 'RELEASE_GATE', message: 'Release gate: GREEN — Shippable' }] } };
    expect(verifiedOutcome(metrics({ evidence: evOf(green) }))).toBe('proven');
    expect(verifiedOutcome(metrics({ evidence: evOf({ diagnostics: { issues: [{ code: 'RELEASE_GATE', message: 'Release gate: GREEN — x' }] } }) }))).toBe('unproven');
    expect(verifiedOutcome(metrics())).toBe('unproven');
    expect(falsePositive(metrics())).toBe(false);
  });
  it('a build that did not succeed is never a "false positive"', () => {
    expect(falsePositive(metrics({ ok: false, evidence: evOf(gateRed) }))).toBe(false);
  });
});

describe('the summary and the A/B comparison', () => {
  const green = (calls: number, input: number, cached: number, out: number, cost: number) => metrics({
    evidence: evOf({
      appRendered: true,
      diagnostics: {
        startedAt: 0, endedAt: 60_000,
        llmCalls: Array.from({ length: calls }, () => ({ inputTokens: 1, outputTokens: 1, latencyMs: 1000, ok: true })),
        providerTokens: { KIMI: { inputTokens: input, outputTokens: out, cacheReadInputTokens: cached } },
        billing: { realCostUsd: cost, sandboxCostUsd: 0.01 },
        issues: [{ code: 'RELEASE_GATE', message: 'Release gate: GREEN — Shippable' }],
      },
    }),
  });
  const base = file('baseline', [run('a', green(100, 1_000_000, 900_000, 20_000, 1.0)), run('b', green(50, 500_000, 450_000, 10_000, 0.5)), run('c', metrics({ evidence: evOf({ appRendered: false, diagnostics: { issues: [{ code: 'RELEASE_GATE', message: 'Release gate: RED — x' }] } }) }))]);
  const cand = file('slim', [run('a', green(80, 600_000, 540_000, 20_000, 0.7)), run('b', green(40, 300_000, 270_000, 10_000, 0.35))]);

  it('means are per build over the builds that carried the figure, and say how many that was', () => {
    const s = summarizeEvidence(base.runs);
    expect(s.llmCalls).toMatchObject({ n: 2, mean: 75 });
    expect(s.inputTokens).toMatchObject({ n: 2, mean: 750_000 });
    expect(s.cachedShare).toBeCloseTo(0.9, 6);
    expect(s.gate).toMatchObject({ green: 2, red: 1 });
    expect(s.successes).toMatchObject({ proven: 2, contradicted: 1 });
    expect(s.falsePositiveRate.successes).toBe(1);
    expect(s.falsePositiveRate.n).toBe(3);
  });
  it('the comparison gives per-metric deltas and withholds one when a side has no figure', () => {
    const c = compareEvidence(base, cand);
    const row = (m: string) => c.rows.find((r) => r.metric === m)!;
    expect(row('input tokens / build').deltaPct).toBe(-40);
    expect(row('model calls / build').deltaPct).toBeCloseTo(-20, 5);
    const empty = compareEvidence(file('x', [run('a', metrics())]), cand);
    expect(empty.rows.find((r) => r.metric === 'input tokens / build')!.deltaPct).toBeNull();
  });
  it('the printed text names the false-positive rate and warns about thin coverage', () => {
    const text = formatEvidenceSummary(summarizeEvidence(base.runs), 'baseline');
    expect(text).toContain('CONTRADICTED by the evidence');
    expect(text).toContain('not every build carried');
    expect(formatEvidenceComparison(compareEvidence(base, cand), { baseline: 'baseline', candidate: 'slim' })).toContain('false-positive success');
  });
  it('an empty run list does not throw and reports nothing as zero', () => {
    const s = summarizeEvidence([]);
    expect(s.runs).toBe(0);
    expect(s.llmCalls.mean).toBeNull();
    expect(s.cachedShare).toBeNull();
  });
});

