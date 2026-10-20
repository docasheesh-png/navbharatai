/** Invented reports only. Closed events are not proof of repairs; absence is not measured zero. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { interpretRepairCount, healCountOf, isSelfHeal } from '../src/lib/healIssue';
import { summarizeHealCodes } from '../src/server/AgentV3/healBreakdown';
import { builderScorecard, scorecardHeadline } from '../src/lib/builderMetrics';
import { toMetricInput } from '../src/server/lib/scorecardPopulation';
import { firstPassMetaFromDiagnostics, firstPassStatsFromMeta, classifyFirstPass, firstPassStats, firstPassHeadline, FIRST_PASS_TARGET } from '../src/lib/firstPassQuality';
import { buildCostRow, summarizeCosts, costTrend } from '../src/server/lib/buildCostLedger';
import { repairCountLabel, repairAverageLabel, repairTrendLabel } from '../src/components/admin/BuildCostCard';
import { buildAdminReportRecord } from '../src/server/AgentV3/AdminBuildReportStore';

// These tests verify repair metrics, not pricing. Every cost fixture is settled zero; pricing must not run.
vi.mock('../src/server/AgentV3/providerRates', () => ({
  realRateFor: () => { throw new Error('Unexpected pricing in repair provenance fixture'); },
  usageCostUsd: () => { throw new Error('Unexpected pricing in repair provenance fixture'); },
}));

interface Fixture { id: string; case: string; report?: any; inputEncoding?: { field: string; nonJsonNumber: string } }
const fixtures: Fixture[] = JSON.parse(readFileSync(join(__dirname, 'fixtures/legacyRepairProvenance.json'), 'utf8'));
const original = (id: string): any => structuredClone(fixtures.find((f) => f.id === id)!.report);
const legacy = () => original('P01');
const current = (n: number) => ({ ok: true, counts: { healRule: 3, autoResolved: n, unresolved: 0 } });
const knownTotals: Record<string, number> = { P14: 0, P15: 2, P16: 3, P17: 1, P18: 3, P19: 2, P25: 0, P26: 2 };
const strictPositive = new Set(['P01', 'P02', 'P28']);

function input(f: Fixture): any {
  if (!f.inputEncoding) return structuredClone(f.report);
  const r = legacy();
  r.counts[f.inputEncoding.field] = f.inputEncoding.nonJsonNumber === 'NaN' ? NaN : Infinity;
  return r;
}

describe('finite provenance matrix: current totals, legacy evidence and unknown stay distinct', () => {
  it('keeps all 39 independently specified boundary cases', () => {
    expect(fixtures).toHaveLength(39);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(39);
  });
  it.each(fixtures)('$id: $case', (f) => {
    const report = input(f);
    const before = structuredClone(report);
    const out = interpretRepairCount(report);
    expect(report).toEqual(before); // including NaN; never rewrite the historical count
    for (const [field, raw] of [['rawAutoResolved', report?.counts?.autoResolved], ['rawHealRule', report?.counts?.healRule]] as const) {
      const numeric = typeof raw === 'number' && Number.isFinite(raw);
      expect(out[field]).toBe(numeric ? raw : null);
      expect(out[`${field}State`]).toBe(numeric ? 'numeric' : raw == null ? 'missing' : 'invalid');
    }
    expect(out.total).toBe(knownTotals[f.id] ?? null);
    expect(out.provenance === 'legacy-closed-events').toBe(strictPositive.has(f.id));
    expect(out.observed).toBe(Array.isArray(report?.issues) ? report.issues.filter(isSelfHeal).length : null);
    if (strictPositive.has(f.id)) {
      expect(out.timeline).toEqual({ status: 'complete', reason: 'coherent-census' });
      expect(healCountOf(report)).toBeNull();
      expect(summarizeHealCodes(report)?.unattributed).toBeNull();
    }
  });

  it('keeps raw six, visible zero, warnings and narrative evidence independently without parsing prose', () => {
    const report = legacy();
    const out = summarizeHealCodes(report)!;
    expect(out.total).toBeNull();
    expect(out.unattributed).toBeNull();
    expect(out.codes).toEqual({});
    expect(out.open).toEqual({ READINESS_WARNING: 1 });
    expect(out.interpretation).toEqual({ rawAutoResolved: 6, rawHealRule: null, rawAutoResolvedState: 'numeric', rawHealRuleState: 'missing', total: null,
      compatibilityCount: 4, provenance: 'legacy-closed-events', observed: 0,
      timeline: { status: 'complete', reason: 'coherent-census' } });
    report.issues[1].message = 'Adjusted 900 imports and repaired 42 times';
    report.issues[1].repeatCount = 500;
    expect(summarizeHealCodes(report)).toEqual(out);
    const positive = summarizeHealCodes(original('P02'))!;
    expect(positive.codes).toEqual({ HTML_ENTRY_REPAIRED: 1 });
    expect(positive.total).toBeNull();
  });

  it.each([{ severity: ['info'] }, { severity: { toString: () => 'warning' } }, { severity: false }, { severity: 1 }])('rejects malformed severity $severity as producer evidence', ({ severity }) => {
    const r = legacy();
    r.issues[2].severity = severity;
    expect(interpretRepairCount(r).timeline).toEqual({ status: 'unknown', reason: 'invalid-row' });
    expect(interpretRepairCount(r).provenance).toBe('legacy-unverified');
  });

  it('keeps supported one-time rule-2 adjustment, cropped compatibility and future producer semantics', () => {
    const r = original('P17');
    r.counts.total = r.issues.length;
    expect(interpretRepairCount(r)).toMatchObject({ total: 1, compatibilityCount: 1, provenance: 'rule-2-adjusted' });
    expect(interpretRepairCount(original('P18'))).toMatchObject({ total: 3, provenance: 'rule-2-visible-adjustment' });
    expect(interpretRepairCount(original('P19'))).toMatchObject({ total: 2, provenance: 'future-rule' });
    expect(interpretRepairCount({ counts: { healRule: 3, autoResolved: 2.8 } }).total).toBe(2);
    expect(healCountOf({ counts: { healRule: 3.5, autoResolved: 2.8 } })).toBe(2);
    expect(interpretRepairCount({ counts: { healRule: 3.5, autoResolved: 2.8 } }).total).toBeNull();
  });

  it('retains ambiguous legacy arithmetic only as unverified compatibility evidence', () => {
    const report = { counts: { autoResolved: 6 } };
    expect(healCountOf(report)).toBe(6);
    expect(interpretRepairCount(report)).toMatchObject({ total: null, compatibilityCount: 6,
      provenance: 'legacy-unverified', observed: null, timeline: { status: 'unknown', reason: 'missing-timeline' } });
  });
});

function projection(report: any) { return { ...report, workspaceId: 'synthetic', startedAt: 1, endedAt: 2,
  healCodes: summarizeHealCodes(report) }; }
function cost(report: any, startedAt = 1_000) {
  return buildCostRow({ workspaceId: 'synthetic', report: { ...report, schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt, endedAt: startedAt + 60_000, generatedFiles: [], llmCalls: [],
    billing: { realCostUsd: 0, billedInr: 0, sandboxCostUsd: 0, powerLevel: 'off' } } }, 1)!;
}

describe('all adapters preserve normalized uncertainty, known zero and their denominators', () => {
  it('scorecard excludes strict and ambiguous legacy values, including explicit normalization failure', () => {
    for (const report of [legacy(), { ok: true, counts: { autoResolved: 6 } }]) {
      expect(toMetricInput(projection(report)).healCount).toBeNull();
    }
    for (const healCodes of [null, { codes: {}, total: null, unattributed: null }]) {
      expect(toMetricInput({ ...current(6), healCodes }).healCount).toBeNull();
    }
    expect(toMetricInput(current(0)).healCount).toBe(0);
    const rows = [projection(legacy()), projection({ ok: true, counts: { autoResolved: 6 } }), projection(current(0)), projection(current(2))];
    const card = builderScorecard(rows.map(toMetricInput));
    expect(card.heal).toMatchObject({ builds: 2, unknownBuilds: 2, perBuild: 1, buildsNeedingHeal: 1 });
    const headline = scorecardHeadline(card);
    expect(headline).toContain('2 build(s) have unknown repair totals');
    expect(headline).toContain('visible zero rows do not prove no repairs occurred');
    expect(headline).toContain('Left open, not repaired: READINESS_WARNING ×1');
    expect(headline).not.toContain('timelines were trimmed');
  });

  it.each([2, 3, 4])('keeps older normalized rule %i projections when only the additive field is missing', (healRule) => {
    const row = { ok: true, counts: { healRule, autoResolved: 7, unresolved: 0 },
      healCodes: { total: 0, unattributed: 0, codes: {} } };
    expect(toMetricInput(row).healCount).toBe(0);
    expect(firstPassStatsFromMeta([firstPassMetaFromDiagnostics(row)])).toMatchObject({ total: 1, clean: 1 });
    row.healCodes.total = null as any;
    expect(toMetricInput(row).healCount).toBeNull();
    expect(firstPassStatsFromMeta([firstPassMetaFromDiagnostics(row)])).toMatchObject({ total: 0, skippedLegacy: 1 });
  });

  it('cost rows, averages and trends exclude unknowns, retain known zero and never invoke pricing', () => {
    const unknown = cost(legacy());
    expect(unknown.heals).toBeNull();
    expect([unknown.billedInr, unknown.realInr, unknown.marginInr, unknown.sandboxInr]).toEqual([0, 0, 0, 0]);
    expect(cost(current(0)).heals).toBe(0);
    const cell = summarizeCosts([unknown, cost(current(0)), cost(current(2))])[0];
    expect(cell).toMatchObject({ n: 3, nHeals: 2, avgHeals: 1, nMeasured: 3, nBilled: 3, avgBilledInr: 0, avgRealInr: 0 });
    expect(summarizeCosts([unknown])[0]).toMatchObject({ nHeals: 0, avgHeals: null });
    const rows = [current(2), current(0), legacy(), current(4), current(0), legacy()].map((r, i) => cost(r, (i + 1) * 1_000));
    expect(costTrend(rows).heals).toEqual({ recent: 2, older: 1, delta: null, nRecent: 2, nOlder: 2 });
    expect(repairCountLabel(unknown)).toBe('unknown (compatibility value 4, unverified)');
    expect(repairCountLabel(cost(current(0)))).toBe('0');
    expect(repairAverageLabel(cell)).toBe('1 (n=2)');
    expect(repairTrendLabel({ recent: 2, older: 1, delta: 1, nRecent: 3, nOlder: 4 })).toContain('(measured n=3 vs 4)');
    expect(repairCountLabel(cost(original('P18')))).toContain('rule 2, partial adjustment');
    expect(repairCountLabel(cost(original('P19')))).toContain('future rule');
  });

  it('a compatibility tag cannot promote a numeric value back to measured truth', () => {
    const repairCount = { ...interpretRepairCount(legacy()), total: 6 };
    const row = { ...current(6), healCodes: { total: 6, codes: {}, unattributed: 6, interpretation: repairCount } };
    expect(toMetricInput(row).healCount).toBeNull();
    expect(firstPassStatsFromMeta([{ ok: true, healCount: 6, unresolvedCount: 0, repairCount }])).toMatchObject({ total: 0, skippedLegacy: 1 });
    expect(builderScorecard([{ ok: true, reportedAt: 1, workspaceId: 'synthetic', healCount: 6,
      healCountProvenance: 'legacy-unverified' }]).heal.builds).toBe(0);
    expect(repairCountLabel({ heals: 6 })).toBe('unknown (stored value 6, unverified)');
  });

  it('first-pass projections preserve failures, User Stop, warnings, exact zero and delivered unknown', () => {
    const rows = [legacy(), current(0), { ...current(0), counts: { ...current(0).counts, leftOpen: 1 } }, current(2),
      { ...legacy(), ok: false }, { ...legacy(), ok: false, userStopped: true }].map(projection).map(firstPassMetaFromDiagnostics);
    expect(firstPassStatsFromMeta(rows)).toMatchObject({ total: 4, clean: 1, repaired: 1, warningOnly: 1, failed: 1,
      skippedLegacy: 1, unknownWithWarnings: 1, userStopped: 1 });
    expect(firstPassStatsFromMeta([{ ok: true, healCount: 0, unresolvedCount: 0 }])).toMatchObject({ total: 0, skippedLegacy: 1 });
    expect(firstPassStatsFromMeta([{ ok: true, healRule: 3, healCount: 0, unresolvedCount: 0 }])).toMatchObject({ total: 1, clean: 1 });
  });

  it('new admin metadata captures the available complete evidence before trimming, without mutating raw history', () => {
    const r = legacy();
    const before = structuredClone(r);
    const record = buildAdminReportRecord(r as never, { userId: null, email: null, workspaceId: 'synthetic', reportedAt: 1 });
    expect(record.meta.healCount).toBeNull();
    expect(record.meta.repairCount).toMatchObject({ rawAutoResolved: 6, total: null, provenance: 'legacy-closed-events',
      timeline: { status: 'complete' } });
    expect(record.report.counts.autoResolved).toBe(6);
    expect(r).toEqual(before);
    expect(firstPassStatsFromMeta([record.meta])).toMatchObject({ total: 0, skippedLegacy: 1 });
    const known = buildAdminReportRecord(current(0) as never, { userId: null, email: null, workspaceId: 'synthetic', reportedAt: 2 });
    expect(firstPassStatsFromMeta([known.meta])).toMatchObject({ total: 1, clean: 1 });
  });

  it('bounds malformed raw evidence in metadata and listings without copying secret-like text or nested undefined', () => {
    const marker = 'SYNTHETIC_SECRET_LIKE_PAYLOAD_NOT_A_CREDENTIAL';
    const oversized = marker.repeat(5_000);
    for (const malformed of [oversized, { nested: oversized }, [oversized], true, NaN, Infinity]) {
      for (const field of ['autoResolved', 'healRule'] as const) {
        const r = { ...current(2), issues: [], counts: { ...current(2).counts, [field]: malformed } };
        const before = structuredClone(r);
        const record = buildAdminReportRecord(r as never, { userId: null, email: null, workspaceId: 'synthetic', reportedAt: 4 });
        const repair = record.meta.repairCount!;
        const rawField = field === 'autoResolved' ? 'rawAutoResolved' : 'rawHealRule';
        expect(repair[rawField]).toBeNull();
        expect(repair[`${rawField}State`]).toBe('invalid');
        expect(JSON.stringify(record.meta)).not.toContain(marker);
        expect(JSON.stringify(repair).length).toBeLessThan(500);
        expect(JSON.parse(JSON.stringify(repair))).toEqual(repair); // no omitted nested undefined or nonfinite number
        expect(summarizeHealCodes(r)?.interpretation).toEqual(repair);
        expect(r).toEqual(before);
        expect(record.report.counts[field]).toEqual(before.counts[field]);
      }
    }
    const absent = interpretRepairCount({});
    expect(absent).toMatchObject({ rawAutoResolved: null, rawHealRule: null,
      rawAutoResolvedState: 'missing', rawHealRuleState: 'missing' });
    expect(JSON.parse(JSON.stringify(absent))).toEqual(absent);
    for (const value of [0, 2.8, -1, Number.MAX_VALUE]) {
      expect(interpretRepairCount({ counts: { autoResolved: value, healRule: value } })).toMatchObject({
        rawAutoResolved: value, rawHealRule: value, rawAutoResolvedState: 'numeric', rawHealRuleState: 'numeric' });
    }
  });

  it('admin metadata uses the existing full evidence before the stored copy loses rows', () => {
    const r = { ok: true, counts: { total: 600, autoResolved: 600, unresolved: 0 },
      issues: Array.from({ length: 600 }, (_, n) => ({ ts: n, phase: 'build', code: 'HEARTBEAT', severity: 'info', autoResolved: true, message: 'Synthetic event' })) };
    const record = buildAdminReportRecord(r as never, { userId: null, email: null, workspaceId: 'synthetic', reportedAt: 3 });
    expect(record.report.issues.length).toBeLessThan(r.issues.length);
    expect(record.meta.repairCount).toMatchObject({ total: null, rawAutoResolved: 600,
      provenance: 'legacy-closed-events', timeline: { status: 'complete' } });
    expect(interpretRepairCount(record.report)).toMatchObject({ total: null, provenance: 'legacy-unverified', timeline: { status: 'incomplete' } });
  });

  it.each([undefined, null, NaN, Infinity, -1, '0', false])('scalar first-pass cannot call missing/malformed %j clean', (value) => {
    expect(classifyFirstPass({ ok: true, counts: { autoResolved: value as any, unresolved: 0 } })).toBe('unknown');
    expect(classifyFirstPass({ ok: true, counts: { autoResolved: 0, unresolved: value as any } })).toBe('unknown');
    expect(classifyFirstPass({ ok: false, counts: { autoResolved: value as any } })).toBe('failed');
  });
  it('unknown scalar verdicts do not dilute rates; explicit finite zero remains clean', () => {
    expect(classifyFirstPass({ ok: true })).toBe('unknown');
    expect(classifyFirstPass(current(0))).toBe('clean');
    expect(firstPassStats([{ ok: true }, current(0), { ok: false }])).toMatchObject({ total: 2, unknown: 1, clean: 1, failed: 1, cleanRate: 0.5 });
  });
});

/** Whole-repository sibling census. TS AST ignores comments/fixture strings, not executable readers. */
function rawCounterReaders(kind: 'raw' | 'compatibility' = 'raw'): string[] {
  const root = process.cwd();
  const found = new Set<string>();
  function walk(dir: string) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist', 'coverage', 'tests', '.agents', '.codex'].includes(ent.name)) continue;
      const path = join(dir, ent.name);
      if (ent.isDirectory()) { walk(path); continue; }
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) || /\.test\.[jt]sx?$/.test(path)) continue;
      const source = readFileSync(path, 'utf8');
      if (!source.includes(kind === 'raw' ? 'autoResolved' : 'healCountOf')) continue;
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (kind === 'compatibility' && relative(root, path) !== 'src/lib/healIssue.ts'
          && ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === 'healCountOf')) found.add(relative(root, path));
        if (kind === 'raw' && ts.isPropertyAccessExpression(node) && node.name.text === 'autoResolved'
          && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'counts') found.add(relative(root, path));
        ts.forEachChild(node, visit);
      }
      visit(file);
    }
  }
  walk(root);
  return [...found].sort();
}

describe('raw counter readers stay centralized, not copied into a new adapter', () => {
  it('censuses the whole repository, including root, scripts and infra', () => {
    // The formatter preserves literal raw 'auto-resolved' evidence; it does not label it repairs.
    expect(rawCounterReaders()).toEqual(['src/lib/firstPassQuality.ts', 'src/lib/healIssue.ts', 'src/server/AgentV3/BuildDiagnostics.ts']);
  });
  it('keeps the unverified compatibility API out of every production metric adapter', () => {
    expect(rawCounterReaders('compatibility')).toEqual([]);
  });
  it('actual metadata, route and UI use the guarded boundaries', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
    const store = read('src/server/AgentV3/AdminBuildReportStore.ts');
    expect(store.indexOf('const repairCount = interpretRepairCount(report)')).toBeLessThan(store.indexOf('const trimmed = fitReportForStorage(report)'));
    expect(store).toContain('healCount: repairCount.total');
    expect(read('src/server/routes/admin.ts')).toContain('allBuilds.map(firstPassMetaFromDiagnostics)');
    expect(read('src/components/admin/BuildCostCard.tsx')).toContain('{repairCountLabel(r)}');
    expect(read('src/components/admin/BuildCostCard.tsx')).toContain('{repairAverageLabel(c)}');
    expect(read('src/components/AdminDashboard.tsx')).toContain('repair totals or their historical meaning are unknown');
  });
});

/** Render the actual dashboard JSX, not a copied card. External buttons/icons are inert test stubs. */
function renderFirstPassCard(firstPass: ReturnType<typeof firstPassStatsFromMeta> & { reported?: ReturnType<typeof firstPassStatsFromMeta> }): string {
  const path = join(process.cwd(), 'src/components/AdminDashboard.tsx');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isJsxExpression(node) && node.expression) {
      const text = node.expression.getText(source);
      if (/^firstPass &&/.test(text) && text.includes('firstPassHeadline(firstPass)')) expression = text;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(expression).not.toBe('');
  const code = ts.transpileModule(`const render = () => (${expression});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const render = new Function('firstPass', 'React', 'Target', 'ReportExportButtons', 'toast', 'FIRST_PASS_TARGET', 'firstPassHeadline',
    `${code}; return render();`);
  return renderToStaticMarkup(render(firstPass, React, () => null, () => null, () => undefined, FIRST_PASS_TARGET, firstPassHeadline));
}

describe('actual first-pass card renders uncertainty and coverage instead of disappearing', () => {
  it('an all-unknown legacy window remains visible without claiming zero or a warning-only repair', () => {
    const html = renderFirstPassCard(firstPassStatsFromMeta([{ ok: true, healCount: 6, unresolvedCount: 1 }]));
    expect(html).toContain('First-pass quality');
    expect(html).toContain('unknown');
    expect(html).toContain('1 build(s) excluded');
    expect(html).toContain('Rate denominator: 0 classifiable build(s)');
    expect(html).toContain('1 of these have known findings left open');
    expect(html).not.toContain('>0.0%<');
    expect(html).not.toContain('Needed repair');
  });
  it('reported-only exclusions stay visible and cannot manufacture a conclusion about selection bias', () => {
    const stats = firstPassStatsFromMeta([{ ok: true, healRule: 3, healCount: 0, unresolvedCount: 0 }]);
    const reported = firstPassStatsFromMeta([{ ok: true, healCount: 6, unresolvedCount: 0 }]);
    const html = renderFirstPassCard({ ...stats, reported });
    expect(html).toContain('Among the 0 classifiable build(s)');
    expect(html).toContain('first-pass quality is unknown');
    expect(html).toContain('1 additional reported build(s)');
    expect(html).toContain('coverage prevents a reliable comparison');
    expect(html).not.toContain('self-selection may contribute');
    const knownFailure = renderFirstPassCard({ ...stats, reported: firstPassStatsFromMeta([
      { ok: false }, { ok: true, healCount: 6, unresolvedCount: 0 },
    ]) });
    expect(knownFailure).toContain('Among the 1 classifiable build(s)');
    expect(knownFailure).toContain('coverage prevents a reliable comparison');
  });
  it('an explicitly measured current zero still shows 100% and its actual denominator', () => {
    const html = renderFirstPassCard(firstPassStatsFromMeta([{ ok: true, healRule: 3, healCount: 0, unresolvedCount: 0 }]));
    expect(html).toContain('100.0%');
    expect(html).toContain('Rate denominator: 1 classifiable build(s)');
    expect(html).toContain('Not first-pass');
    expect(html).not.toContain('build(s) excluded');
  });
});
