import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  summarizeModelPerformance,
  modelStatsFromCalls,
  providerFailureStats,
  buildOutcomeDims,
  gateStateFromIssues,
  providerOfModel,
  FIRST_PASS_NOTE,
} from '../src/server/AgentV3/modelPerformance';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import type { BuildDiagnosticsReport, LlmCallRecord } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * THE EVIDENCE LAYER FOR GLM-vs-KIMI ROUTING.
 *
 * 🔴 The gap (audit 2026-09-16). Every build already records `llmCalls` — model, latency, tokens,
 * `finishReason`, `ok` — and an accurate per-provider failure ledger. But `listAllDiagnostics`, the
 * ONLY cross-build index, projected metadata alone. So "is Kimi better than GLM on complex files?"
 * could be answered only by opening reports one at a time, and the single real observation was n = 1.
 *
 * These tests pin the projection AND the four integrity rules that decide whether the resulting
 * numbers can be trusted — most of all the two places where a plausible wrong number was available
 * and was deliberately not taken.
 */

const call = (over: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  ts: 1, ok: true, model: 'glm-5.3-flash', latencyMs: 100,
  inputTokens: 10, outputTokens: 20, finishReason: 'end_turn', toolCalls: 1,
  ...over,
});

const report = (over: Partial<BuildDiagnosticsReport> = {}): BuildDiagnosticsReport =>
  ({ schema: 'navbharatai.v3.build-diagnostics/1', issues: [], ...over } as BuildDiagnosticsReport);

describe('1 — provider and model identity is projected exactly', () => {
  it('keeps the REAL production ids, never a "GLM 4.7" / "Kimi 2.7" invention', () => {
    const s = modelStatsFromCalls([
      call({ model: 'glm-5.3-flash' }), call({ model: 'glm-5.3' }),
      call({ model: 'kimi-k2.7-code' }), call({ model: 'kimi-k2.7-code-highspeed' }),
      call({ model: 'kimi-k3' }),
    ]);
    expect(s.map((x) => x.model).sort()).toEqual(
      ['glm-5.3', 'glm-5.3-flash', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k3'],
    );
  });

  it('derives the provider family from the id, and refuses to guess an unknown one', () => {
    expect(providerOfModel('glm-5.3-flash')).toBe('GLM');
    expect(providerOfModel('kimi-k2.7-code-highspeed')).toBe('KIMI');
    expect(providerOfModel('claude-sonnet-4-6')).toBe('CLAUDE');
    expect(providerOfModel('gpt-5-nano')).toBe('OPENAI');
    expect(providerOfModel('gemini-2.5-flash')).toBe('GEMINI');
    expect(providerOfModel('grok-3')).toBe('GROK');
    // A mislabelled row would corrupt exactly the comparison this exists for.
    expect(providerOfModel('something-new-1')).toBe('unknown');
    expect(providerOfModel(undefined)).toBe('unknown');
  });
});

describe('2 — many builds aggregate, and each build stands alone', () => {
  it('two builds summarise independently — no shared or carried state', () => {
    const a = summarizeModelPerformance(report({ llmCalls: [call({ model: 'glm-5.3' })] }));
    const b = summarizeModelPerformance(report({ llmCalls: [call({ model: 'kimi-k3' })] }));
    expect(a.models.map((m) => m.model)).toEqual(['glm-5.3']);
    expect(b.models.map((m) => m.model)).toEqual(['kimi-k3']);
    // …and summarising again gives the same answer: the function holds nothing between calls.
    expect(summarizeModelPerformance(report({ llmCalls: [call({ model: 'glm-5.3' })] }))).toEqual(a);
  });
});

describe('3 / 4 / 5 — calls fold together per model; models and providers stay apart', () => {
  it('repeated calls on ONE model accumulate', () => {
    const [s] = modelStatsFromCalls([
      call({ outputTokens: 20, latencyMs: 100 }),
      call({ outputTokens: 30, latencyMs: 300 }),
      call({ outputTokens: 50, latencyMs: 200 }),
    ]);
    expect(s.calls).toBe(3);
    expect(s.outputTokens).toBe(100);
    expect(s.inputTokens).toBe(30);
    expect(s.deliveredTurns).toBe(3);
  });

  it('two models of the SAME provider never merge — the whole point is per-model comparison', () => {
    const s = modelStatsFromCalls([call({ model: 'glm-5.3-flash' }), call({ model: 'glm-5.3' })]);
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.provider === 'GLM')).toBe(true);
    expect(s.map((x) => x.calls)).toEqual([1, 1]);
  });

  it('two providers never merge', () => {
    const s = modelStatsFromCalls([call({ model: 'glm-5.3' }), call({ model: 'kimi-k3' })]);
    expect(new Set(s.map((x) => x.provider))).toEqual(new Set(['GLM', 'KIMI']));
  });
});

describe('6 — the median is a median, on both parities', () => {
  it('odd count takes the middle value, unsorted input included', () => {
    const [s] = modelStatsFromCalls([
      call({ latencyMs: 300 }), call({ latencyMs: 100 }), call({ latencyMs: 200 }),
    ]);
    expect(s.medianLatencyMs).toBe(200);
    expect(s.totalLatencyMs).toBe(600);
    expect(s.latencySamples).toBe(3);
  });

  it('even count averages the middle pair', () => {
    const [s] = modelStatsFromCalls([
      call({ latencyMs: 100 }), call({ latencyMs: 200 }), call({ latencyMs: 300 }), call({ latencyMs: 500 }),
    ]);
    expect(s.medianLatencyMs).toBe(250);
  });

  it('no latency anywhere ⇒ null, never 0 — "we did not time it" is not "it was instant"', () => {
    const [s] = modelStatsFromCalls([call({ latencyMs: undefined })]);
    expect(s.medianLatencyMs).toBeNull();
    expect(s.totalLatencyMs).toBeNull();
    expect(s.latencySamples).toBe(0);
  });
});

describe('7 — truncated calls are counted from the provider’s own finish reason', () => {
  it("counts finishReason 'max_tokens' and nothing else", () => {
    const [s] = modelStatsFromCalls([
      call({ finishReason: 'max_tokens' }), call({ finishReason: 'max_tokens' }),
      call({ finishReason: 'end_turn' }), call({ finishReason: 'tool_use' }), call({ finishReason: null }),
    ]);
    expect(s.truncatedCalls).toBe(2);
    expect(s.calls).toBe(5);
  });
});

describe('8 / 9 — starvation and timeout are counted, and stay DISTINCT', () => {
  const r = report({
    providerFailures: { GLM: 5, KIMI: 1 },
    providerFailureReasons: { GLM: '3 output-budget, 2 timeout', KIMI: '1 rate-limit' },
  });

  it('OUTPUT_BUDGET_STARVED (our own ceiling) is counted from its own bucket', () => {
    const glm = providerFailureStats(r).find((p) => p.provider === 'GLM')!;
    expect(glm.starvedCalls).toBe(3);
  });

  it('a TIMEOUT is a different number — the engine deliberately separates them and so does this', () => {
    const glm = providerFailureStats(r).find((p) => p.provider === 'GLM')!;
    expect(glm.timeoutCalls).toBe(2);
    expect(glm.starvedCalls).not.toBe(glm.timeoutCalls);
    expect(glm.failures).toBe(5);
    expect(glm.byReason).toEqual({ 'output-budget': 3, timeout: 2 });
  });

  it('a provider with neither reads 0 for both, without inventing a bucket', () => {
    const kimi = providerFailureStats(r).find((p) => p.provider === 'KIMI')!;
    expect(kimi.starvedCalls).toBe(0);
    expect(kimi.timeoutCalls).toBe(0);
    expect(kimi.byReason).toEqual({ 'rate-limit': 1 });
  });

  it('🔒 the ledger line is kept verbatim, because the comma parse is lossy for `other:` alone', () => {
    const [p] = providerFailureStats(report({
      providerFailures: { GLM: 1 },
      providerFailureReasons: { GLM: '1 other: Request failed, retrying' },
    }));
    expect(p.raw).toBe('1 other: Request failed, retrying');
  });

  it('🔒 the buckets are READ, not re-classified — no second opinion to drift from the runner’s', () => {
    // Comments stripped first: the module's own doc NAMES `isStarvedBudgetError` to explain why it
    // deliberately does not call it, and an assertion that cannot tell an explanation from an
    // implementation would fail on the very comment that documents the rule.
    const src = readFileSync('src/server/AgentV3/modelPerformance.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('isStarvedBudgetError');
    expect(src).not.toMatch(/rate.?limit|timed out/i);
  });
});

describe('10 — missing usage stays MISSING; it never becomes a fake zero', () => {
  it('a call that reported no usage yields null totals, not 0', () => {
    const [s] = modelStatsFromCalls([call({ inputTokens: undefined, outputTokens: undefined })]);
    expect(s.outputTokens).toBeNull();
    expect(s.inputTokens).toBeNull();
    expect(s.usageReportedCalls).toBe(0);
    expect(s.calls).toBe(1); // the call happened — only its usage is unknown
  });

  it('a mix reports the measured total AND how many calls it came from', () => {
    const [s] = modelStatsFromCalls([
      call({ outputTokens: 40, inputTokens: 10 }),
      call({ outputTokens: undefined, inputTokens: undefined }),
      call({ outputTokens: 60, inputTokens: 20 }),
    ]);
    expect(s.outputTokens).toBe(100);
    expect(s.calls).toBe(3);
    // 🔑 Without this an analysis would divide 100 by 3 and under-state the model's real output by a
    // third. `USAGE_NOT_REPORTED` (#2974) draws exactly this distinction; so does this.
    expect(s.usageReportedCalls).toBe(2);
  });

  it('a REAL zero survives as zero — measured nothing and measured-not-at-all stay different', () => {
    const [s] = modelStatsFromCalls([call({ outputTokens: 0, inputTokens: 0 })]);
    expect(s.outputTokens).toBe(0);
    expect(s.usageReportedCalls).toBe(1);
  });
});

describe('🔒 the integrity rule with the most tempting wrong answer: failed calls', () => {
  it('a FAILED call is never attributed to a model', () => {
    // AgentRunner's failure path reports the REQUESTED model (a Claude id), not the rung that threw.
    // Counting it per-model would file every GLM starvation under claude-haiku.
    const s = summarizeModelPerformance(report({
      llmCalls: [call({ ok: true, model: 'glm-5.3' }), call({ ok: false, model: 'claude-haiku-4-5', error: 'boom' })],
    }));
    expect(s.models).toHaveLength(1);
    expect(s.models[0].model).toBe('glm-5.3');
    expect(s.models.some((m) => m.model.startsWith('claude'))).toBe(false);
  });

  it('…but it is not silently dropped either — it is counted as unattributed', () => {
    const s = summarizeModelPerformance(report({
      llmCalls: [call({ ok: false }), call({ ok: false }), call({ ok: true })],
    }));
    expect(s.unattributedFailedCalls).toBe(2);
  });
});

describe('11 / 12 — taskType and complexityScore are preserved from the real analysis', () => {
  it('both are carried through, with the start tier', () => {
    const d = buildOutcomeDims(report({
      requestAnalysis: { taskType: 'complex_app', complexityScore: 72, startTier: 'sonnet' },
    } as Partial<BuildDiagnosticsReport>));
    expect(d.taskType).toBe('complex_app');
    expect(d.complexityScore).toBe(72);
    expect(d.startTier).toBe('sonnet');
  });

  it('a LEGACY report reads as unavailable — never re-derived from the truncated prompt', () => {
    const d = buildOutcomeDims(report({ prompt: 'build me a CRM' }));
    expect(d.taskType).toBeNull();
    expect(d.complexityScore).toBeNull();
  });

  it('the recorder takes all three or none — a half-analysis is not a measurement', () => {
    const d = new BuildDiagnostics({ buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'x' });
    d.setRequestAnalysis({ taskType: 'debugging' }); // no score, no tier
    expect(buildOutcomeDims(d.report()).taskType).toBeNull();
    d.setRequestAnalysis({ taskType: 'debugging', complexityScore: 55, startTier: 'haiku' });
    expect(buildOutcomeDims(d.report()).complexityScore).toBe(55);
  });

  it('a score of 0 is a real score and survives', () => {
    const d = new BuildDiagnostics({ buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'x' });
    d.setRequestAnalysis({ taskType: 'greeting', complexityScore: 0, startTier: 'gemini' });
    expect(buildOutcomeDims(d.report()).complexityScore).toBe(0);
  });
});

describe('13 / 14 / 15 — repair count, gate state and the correction budget', () => {
  const issues = [
    { ts: 1, phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: 'a', autoResolved: false },
    { ts: 2, phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: 'b', autoResolved: false },
    { ts: 3, phase: 'readiness', severity: 'warning', code: 'RELEASE_GATE', message: 'Release gate: YELLOW — caveats', autoResolved: false },
    { ts: 4, phase: 'readiness', severity: 'info', code: 'CORRECTION_BUDGET', message: 'm', detail: 'total=1800s · reserve=180s', autoResolved: true },
  ] as BuildDiagnosticsReport['issues'];

  it('13 — preview repair attempts are counted, and named for exactly what they are', () => {
    expect(buildOutcomeDims(report({ issues })).previewRepairAttempts).toBe(2);
  });

  it('14 — the release gate’s four-state verdict is preserved', () => {
    expect(buildOutcomeDims(report({ issues })).gateState).toBe('yellow');
    for (const [word, want] of [['GREEN', 'green'], ['RED', 'red'], ['UNKNOWN', 'unknown']] as const) {
      expect(gateStateFromIssues([
        { ts: 1, phase: 'readiness', severity: 'info', code: 'RELEASE_GATE', message: `Release gate: ${word} — x`, autoResolved: true },
      ] as BuildDiagnosticsReport['issues'])).toBe(want);
    }
    // A build where the gate never ran is null, not a guessed state.
    expect(gateStateFromIssues([])).toBeNull();
  });

  it('15 — the CORRECTION_BUDGET telemetry from #2979 survives verbatim', () => {
    expect(buildOutcomeDims(report({ issues })).correctionBudget).toBe('total=1800s · reserve=180s');
    expect(buildOutcomeDims(report({ issues: [] })).correctionBudget).toBeNull();
  });

  it('every issue code is also exposed unaggregated, so a later question needs no code change', () => {
    expect(buildOutcomeDims(report({ issues })).issueCodeCounts).toEqual({
      PREVIEW_NOT_RENDERED: 2, RELEASE_GATE: 1, CORRECTION_BUDGET: 1,
    });
  });

  it('🔒 no first-pass-success flag is invented — the limitation is reported instead', () => {
    const s = summarizeModelPerformance(report({ issues })) as unknown as Record<string, unknown>;
    expect(s.firstPassSuccess).toBeUndefined();
    expect((s.dims as Record<string, unknown>).firstPassSuccess).toBeUndefined();
    expect(FIRST_PASS_NOTE).toMatch(/No authoritative first-pass-success field exists/);
  });
});

describe('16 / 17 — isolation and backwards compatibility', () => {
  it('16 — the projection is pure: no module state, so no cross-tenant leakage is possible', () => {
    const src = readFileSync('src/server/AgentV3/modelPerformance.ts', 'utf8');
    expect(src).not.toMatch(/^(let|var) /m);           // no module-level mutable state
    expect(src).not.toMatch(/^const \w+\s*=\s*new (Map|Set|WeakMap)/m); // no module-level cache
    expect(src).not.toMatch(/process\.env|Date\.now|getDb|firestore/i); // no env, clock or I/O
  });

  it('16 — it is projected only inside the ADMIN-only listing, adding no new surface', () => {
    const store = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
    expect(store).toContain('modelPerformance: (() => {');
    const admin = readFileSync('src/server/routes/admin.ts', 'utf8');
    // Every caller of the listing is behind the admin token; no user route reads it.
    expect(admin).toContain('verifyAdminToken');
  });

  it('17 — a legacy or empty report yields an EMPTY summary, never a throw and never null rows', () => {
    for (const r of [undefined, null, {} as BuildDiagnosticsReport, report()]) {
      const s = summarizeModelPerformance(r);
      expect(s.models).toEqual([]);
      expect(s.providerFailures).toEqual([]);
      expect(s.unattributedFailedCalls).toBe(0);
      expect(s.providerDelivery).toBeNull();
      expect(s.dims.issueCodeCounts).toEqual({});
    }
  });

  it('17 — existing projected fields are untouched by this change', () => {
    const store = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
    for (const f of ['workspaceId:', 'savedAt:', 'ownerUid:', 'ok:', 'summary:', 'rootCause:', 'counts:', 'userTier:', 'billedInr:']) {
      expect(store).toContain(f);
    }
  });
});

describe('the comparison this was built to make', () => {
  it('a real mixed build answers GLM-vs-Kimi on every axis the routing question needs', () => {
    const s = summarizeModelPerformance(report({
      requestAnalysis: { taskType: 'complex_app', complexityScore: 80, startTier: 'sonnet' },
      llmCalls: [
        call({ model: 'glm-5.3-flash', latencyMs: 900, outputTokens: 4800, finishReason: 'max_tokens' }),
        call({ model: 'glm-5.3-flash', latencyMs: 1100, outputTokens: 4800, finishReason: 'max_tokens' }),
        call({ model: 'kimi-k2.7-code', latencyMs: 4000, outputTokens: 9000, finishReason: 'end_turn' }),
      ],
      providerFailures: { GLM: 2 },
      providerFailureReasons: { GLM: '2 output-budget' },
      providerDelivery: { GLM: 2, KIMI: 1 },
      builtBy: 'GLM',
      issues: [
        { ts: 1, phase: 'preview', severity: 'warning', code: 'PREVIEW_NOT_RENDERED', message: 'x', autoResolved: false },
        { ts: 2, phase: 'readiness', severity: 'warning', code: 'RELEASE_GATE', message: 'Release gate: RED — not shippable', autoResolved: false },
      ] as BuildDiagnosticsReport['issues'],
      startedAt: 1_000, endedAt: 601_000,
    }));

    const glm = s.models.find((m) => m.model === 'glm-5.3-flash')!;
    const kimi = s.models.find((m) => m.model === 'kimi-k2.7-code')!;
    expect(glm.truncatedCalls).toBe(2);              // GLM hit the ceiling twice…
    expect(kimi.truncatedCalls).toBe(0);             // …Kimi did not
    expect(glm.medianLatencyMs).toBe(1000);          // GLM faster per call…
    expect(kimi.medianLatencyMs).toBe(4000);
    expect(kimi.outputTokens).toBe(9000);            // …Kimi delivered more in one
    expect(s.providerFailures[0].starvedCalls).toBe(2);
    expect(s.dims.taskType).toBe('complex_app');     // …on work of known difficulty
    expect(s.dims.complexityScore).toBe(80);
    expect(s.dims.gateState).toBe('red');            // …and a known outcome
    expect(s.dims.previewRepairAttempts).toBe(1);
    expect(s.dims.durationMs).toBe(600_000);         // …and a time-to-result
  });
});
