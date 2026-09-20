import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyBuildSize, realCostFromCalls, buildCostRow, summarizeCosts, reportPaths, SIMPLE_MAX_FILES, MID_MAX_FILES } from '../src/server/lib/buildCostLedger';
import { STORED_LLM_CALLS_MAX } from '../src/server/AgentV3/DiagnosticsStore';
import { realRateFor, usageCostUsd } from '../src/server/AgentV3/providerRates';

const files = (n: number, prefix = 'src/components/C'): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}.tsx`);

describe('classifyBuildSize — deterministic, stated boundaries', () => {
  it('counts distinct frontend files', () => {
    expect(classifyBuildSize(files(SIMPLE_MAX_FILES))).toBe('simple');
    expect(classifyBuildSize(files(SIMPLE_MAX_FILES + 1))).toBe('mid');
    expect(classifyBuildSize(files(MID_MAX_FILES))).toBe('mid');
    expect(classifyBuildSize(files(MID_MAX_FILES + 1))).toBe('full-stack');
    expect(classifyBuildSize([...files(3), ...files(3)])).toBe('simple'); // duplicates do not inflate
  });
  it('any backend / data-layer path makes it full-stack whatever the count', () => {
    for (const p of ['server/index.ts', 'backend/app.py', 'api/users.ts', 'prisma/schema.prisma', 'supabase/migrations/001.sql', 'Dockerfile', 'server.js']) {
      expect(classifyBuildSize(['src/App.tsx', p])).toBe('full-stack');
    }
  });
  it('frontend tooling at the root is NOT a backend signal', () => {
    expect(classifyBuildSize(['src/App.tsx', 'src/main.tsx', 'vite.config.ts', 'package.json', 'tailwind.config.js', 'index.html'])).toBe('simple');
  });
  it('no files → unknown, never "simple"', () => {
    expect(classifyBuildSize([])).toBe('unknown');
    expect(classifyBuildSize(['', '  '])).toBe('unknown');
  });
});

describe('realCostFromCalls — the SAME rate card billing uses, and never a guess', () => {
  it('prices each call by its own provider + model', () => {
    const cost = realCostFromCalls([
      { ts: 1, provider: 'GLM', model: 'glm-5.3-flash', inputTokens: 100_000, outputTokens: 10_000, ok: true },
      { ts: 2, provider: 'CLAUDE', model: 'claude-sonnet-4-6', inputTokens: 10_000, outputTokens: 1_000, ok: true },
    ]);
    const expected = usageCostUsd({ inputTokens: 100_000, outputTokens: 10_000 }, realRateFor('GLM', 'glm-5.3-flash'))
      + usageCostUsd({ inputTokens: 10_000, outputTokens: 1_000 }, realRateFor('CLAUDE', 'claude-sonnet-4-6'));
    expect(cost.usd).toBeCloseTo(expected, 8);
    expect(cost.measured).toBe(true);
    expect(cost.measuredCalls).toBe(2);
  });
  it('🔒 a call with no token counts is COUNTED as unmeasured, not priced at zero', () => {
    const cost = realCostFromCalls([
      { ts: 1, provider: 'GLM', model: 'glm-5.3-flash', inputTokens: 1_000, outputTokens: 100, ok: true },
      { ts: 2, provider: 'KIMI', model: 'kimi-k2.6', ok: false },
    ]);
    expect(cost.unmeasuredCalls).toBe(1);
    expect(cost.measured).toBe(false);
    expect(cost.usd).toBeGreaterThan(0);
  });
  it('a failed call that spent tokens still costs', () => {
    const cost = realCostFromCalls([{ ts: 1, provider: 'GLM', model: 'glm-5.3', inputTokens: 50_000, outputTokens: 0, ok: false }]);
    expect(cost.usd).toBeCloseTo(usageCostUsd({ inputTokens: 50_000, outputTokens: 0 }, realRateFor('GLM', 'glm-5.3')), 8);
  });
  it('no calls at all → nothing measured', () => {
    expect(realCostFromCalls(undefined)).toEqual({ usd: 0, measuredCalls: 0, unmeasuredCalls: 0, measured: false, capped: false });
  });
});

const report = (over: Record<string, unknown> = {}) => ({
  workspaceId: 'ws1', savedAt: 5_000,
  report: {
    schema: 'navbharatai.v3.build-diagnostics/1', startedAt: 1_000, endedAt: 1_000 + 6 * 60_000, ok: true,
    counts: { total: 3, errors: 0, warnings: 1, autoResolved: 2, unresolved: 0 },
    issues: [],
    generatedFiles: files(5).map((p) => ({ ts: 1, path: p, content: '' })),
    llmCalls: [{ ts: 1, provider: 'GLM', model: 'glm-5.3-flash', inputTokens: 200_000, outputTokens: 20_000, ok: true }],
    billing: { userTier: 'paid', billedInr: 40, powerLevel: 'off' },
    ...over,
  },
} as never);

describe('buildCostRow — one honest row per build', () => {
  it('fills tier, size, files, minutes, heals, bill, real cost and margin', () => {
    const row = buildCostRow(report(), 87)!;
    expect(row.tierName).toBe('Normal');
    expect(row.size).toBe('simple');
    expect(row.files).toBe(5);
    expect(row.minutes).toBe(6);
    expect(row.heals).toBe(2);
    expect(row.billedInr).toBe(40);
    const usd = usageCostUsd({ inputTokens: 200_000, outputTokens: 20_000 }, realRateFor('GLM', 'glm-5.3-flash'));
    expect(row.realInr).toBeCloseTo(Math.round(usd * 87 * 100) / 100, 2);
    expect(row.marginInr).toBeCloseTo(40 - (row.realInr as number), 2);
    expect(row.measured).toBe(true);
  });
  it('a retired tier key reads as Strong', () => {
    expect(buildCostRow(report({ billing: { userTier: 'paid', billedInr: 10, powerLevel: 'max' } }), 87)!.tierName).toBe('Strong');
  });
  it('🔒 an unsettled build has a NULL bill and a null margin — not ₹0', () => {
    const row = buildCostRow(report({ billing: undefined }), 87)!;
    expect(row.billedInr).toBeNull();
    expect(row.marginInr).toBeNull();
    expect(row.realInr).not.toBeNull(); // the real cost is still known
  });
  it('🔒 a build with no priced call has a NULL real cost, and its margin is null even with a bill', () => {
    const row = buildCostRow(report({ llmCalls: undefined }), 87)!;
    expect(row.realInr).toBeNull();
    expect(row.marginInr).toBeNull();
    expect(row.billedInr).toBe(40);
  });
  it('a missing or bad INR rate never prices anything', () => {
    expect(buildCostRow(report(), 0)!.realInr).toBeNull();
    expect(buildCostRow(report(), Number.NaN)!.realInr).toBeNull();
  });
  it('a document with no report yields no row', () => {
    expect(buildCostRow({ workspaceId: 'x', report: null }, 87)).toBeNull();
  });
});

describe('summarizeCosts — every average names its sample', () => {
  it('groups by tier × size, ordered Weak→Strong then simple→full-stack, nulls for empty samples', () => {
    const rows = [
      buildCostRow(report(), 87)!,
      buildCostRow(report({ billing: { userTier: 'paid', billedInr: 60, powerLevel: 'off' }, ok: false }), 87)!,
      buildCostRow(report({ billing: { userTier: 'free', billedInr: 0, powerLevel: 'weak', zeroBillReason: 'free tier' }, llmCalls: undefined }), 87)!,
      buildCostRow(report({ billing: { userTier: 'paid', billedInr: 500, powerLevel: 'mini' }, generatedFiles: [{ ts: 1, path: 'server/index.ts', content: '' }] }), 87)!,
    ];
    const cells = summarizeCosts(rows);
    expect(cells.map((c) => `${c.tierName}/${c.size}`)).toEqual(['Weak/simple', 'Normal/simple', 'Strong/full-stack']);
    const normal = cells[1];
    expect(normal.n).toBe(2);
    expect(normal.failed).toBe(1);
    expect(normal.nBilled).toBe(2);
    expect(normal.avgBilledInr).toBe(50);
    expect(normal.nMeasured).toBe(2);
    expect(normal.avgHeals).toBe(2);
    const weak = cells[0];
    expect(weak.nMeasured).toBe(0);
    expect(weak.avgRealInr).toBeNull();   // no priced call → no average, not ₹0
    expect(weak.avgMarginInr).toBeNull();
    expect(weak.avgBilledInr).toBe(0);    // a real ₹0 bill IS an average
  });
  it('an empty input is an empty summary', () => {
    expect(summarizeCosts([])).toEqual([]);
  });
});

describe('🔒 WHERE the real cost comes from — settled first, the call log only as a fallback, a capped log never as a fact', () => {
  const call = (i: number) => ({ ts: i, provider: 'GLM', model: 'glm-5.3-flash', inputTokens: 10_000, outputTokens: 1_000, ok: true });

  it('a report that persisted its settled real cost uses THAT figure, not a recomputation', () => {
    // The call log deliberately disagrees with the settled figure: the settled one must win.
    const row = buildCostRow(report({ billing: { userTier: 'paid', billedInr: 40, powerLevel: 'off', realCostUsd: 0.1, sandboxCostUsd: 0.02 } }), 87)!;
    expect(row.source).toBe('settled');
    expect(row.realInr).toBeCloseTo(8.7, 2);
    expect(row.sandboxInr).toBeCloseTo(1.74, 2);
    expect(row.measured).toBe(true);
    expect(row.marginInr).toBeCloseTo(40 - 8.7, 2);
  });

  it('a settled figure of exactly 0 is a measurement (a free-model build), not an absence', () => {
    const row = buildCostRow(report({ billing: { userTier: 'paid', billedInr: 0, powerLevel: 'weak', realCostUsd: 0 } }), 87)!;
    expect(row.source).toBe('settled');
    expect(row.realInr).toBe(0);
    expect(row.measured).toBe(true);
  });

  it('an older report (no settled figure) is re-priced from a COMPLETE call log', () => {
    const row = buildCostRow(report({ llmCalls: [call(1), call(2)] }), 87)!;
    expect(row.source).toBe('call-log');
    expect(row.measured).toBe(true);
    expect(row.sandboxInr).toBeNull(); // never recorded — not zero
  });

  it('🔒 a call log AT the storage cap is a LOWER BOUND: source says so, measured is false, margin is null', () => {
    // Storage keeps only the newest STORED_LLM_CALLS_MAX calls. A log of exactly that length may have
    // lost older calls, so the priced total can only be "at least this much" — and a margin computed
    // from a lower-bound cost would overstate what we made.
    const row = buildCostRow(report({ llmCalls: Array.from({ length: STORED_LLM_CALLS_MAX }, (_, i) => call(i)) }), 87)!;
    expect(row.source).toBe('call-log-capped');
    expect(row.measured).toBe(false);
    expect(row.realInr).not.toBeNull();
    expect(row.marginInr).toBeNull();
    // And it is left out of the summary's measured sample.
    const [cell] = summarizeCosts([row]);
    expect(cell.n).toBe(1);
    expect(cell.nMeasured).toBe(0);
    expect(cell.avgRealInr).toBeNull();
  });

  it('the cap the ledger honours IS the cap storage applies — one constant, read from the store', () => {
    const store = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
    // The spelling moved from `lastN(...)` to `trimChannel(...)` on 2026-09-20, when trimming and
    // declaring the loss became one operation (reportTruncation.ts). The CONSTANT is what this test
    // is about, and it is still the store's, still shared, still the ledger's import.
    expect(store).toContain('trimChannel(report.llmCalls, STORED_LLM_CALLS_MAX');
    expect(readFileSync('src/server/lib/buildCostLedger.ts', 'utf8')).toContain("import { STORED_LLM_CALLS_MAX } from '../AgentV3/DiagnosticsStore'");
  });

  it('🔑 a DECLARED loss beats the length guess — and exactly-40 real calls are no longer discarded', () => {
    // The guess (`length >= cap`) had a real false positive: a build that genuinely made 40 calls was
    // marked a lower bound, so a correct measurement was dropped from the admin's measured sample and
    // its margin shown as null. The report now states the truth, so the guess is only the fallback.
    const exactly40 = Array.from({ length: STORED_LLM_CALLS_MAX }, (_, i) => call(i));
    const honest = buildCostRow(report({ llmCalls: exactly40, truncation: { complete: true } } as never), 87)!;
    expect(honest.source).toBe('call-log');
    expect(honest.measured).toBe(true);
    expect(honest.marginInr).not.toBeNull();

    // …and a report that says it lost calls is a lower bound however short its list is.
    const short = buildCostRow(report({
      llmCalls: [call(1)],
      truncation: { complete: false, channels: { llmCalls: { kept: 1, total: 312 } } },
    } as never), 87)!;
    expect(short.source).toBe('call-log-capped');
    expect(short.measured).toBe(false);
    expect(short.marginInr).toBeNull();

    // A LEGACY report (no statement) keeps the old, margin-safe heuristic.
    const legacy = buildCostRow(report({ llmCalls: exactly40 }), 87)!;
    expect(legacy.source).toBe('call-log-capped');
  });
});

describe('reportPaths — the manifest carries EVERY file; generatedFiles is capped at 20 and is only the fallback', () => {
  it('prefers the manifest file list', () => {
    const r = { manifest: { fileHashes: Object.fromEntries(files(25).map((p) => [p, 'h'])) }, generatedFiles: files(3).map((p) => ({ ts: 1, path: p, content: '' })) } as never;
    expect(reportPaths(r)).toHaveLength(25);
    expect(classifyBuildSize(reportPaths(r))).toBe('full-stack');
  });
  it('falls back to generatedFiles when there is no manifest', () => {
    const r = { generatedFiles: files(3).map((p) => ({ ts: 1, path: p, content: '' })) } as never;
    expect(reportPaths(r)).toHaveLength(3);
  });
});

describe('🔒 THE SETTLE RECORDS THE REAL COST — both sites, so the card never has to re-derive it (rule 3: siblings)', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('decideBuildBilledUsd returns realCostUsd + sandboxUsd on every path', () => {
    // NOTE: the return became multi-line on 2026-09-18 when it gained `absorbedUnbilledUsd` — what we
    // spent on turns that produced nothing and did NOT pass on (unbilledTurns.ts). What this case
    // guards is unchanged and still asserted field by field: OUR OWN cost travels out of the single
    // billing decision on EVERY path, so the admin cost card never has to re-derive it.
    expect(route).toMatch(/return \{\n\s*effectiveBilledUsd, reconciledProviderUsage, realCostRemainder, isOpusTier,/);
    expect(route).toContain('realCostUsd: tokenCost, sandboxUsd: vmCost,');
    // …and that cost is the FULL ledger, never the reduced base the user is billed on. A clamp that
    // shrank our own number too would hide our bleeding on the exact panel used to judge it.
    expect(route).toContain('const tokenCost = costSplit.realCostUsd;');
  });
  it('the normal settle AND the watchdog finalizer both persist it on the billing record', () => {
    const sites = route.match(/realCostUsd: Math\.round\((decided\.realCostUsd|decidedRealCostUsd) \* 1_000_000\) \/ 1_000_000,/g) ?? [];
    expect(sites).toHaveLength(2);
    const vm = route.match(/sandboxCostUsd: Math\.round\((decided\.sandboxUsd|decidedSandboxUsd) \* 1_000_000\) \/ 1_000_000,/g) ?? [];
    expect(vm).toHaveLength(2);
  });
  it('🔒 the user-facing cost breakdown never carries the real cost or the margin (White-Label Law)', () => {
    const at = route.indexOf('export function userCostBreakdown(');
    expect(at).toBeGreaterThan(-1);
    const body = route.slice(at, route.indexOf('\n}\n', at));
    expect(body).not.toContain('realCostUsd');
    expect(body).not.toContain('sandboxCostUsd');
  });
});
