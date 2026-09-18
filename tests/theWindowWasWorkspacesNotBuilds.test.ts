/**
 * 🔴 ADMIN, 2026-09-18: *"yeh report fix hai, har build ke bad update nahi ho rahi. hame pata hi nahi
 * lag raha ki ham progress kar rahe ya nahi!!"*
 *
 * The Build-costs card said **"last 30 builds"** and read `listRecentFullReports`, which returns the
 * PARENT documents of `workspace_diagnostics_v3` — and there is exactly one per WORKSPACE, holding
 * that workspace's LATEST report, overwritten by `saveDiagnostics` on every build.
 *
 * So the window was **the latest build of each of the 30 most recently active workspaces**, and the
 * difference from what it claimed is precisely what the admin was trying to see: **twenty builds in
 * one workspace produce ONE row.** Iterating in a workspace is what testing the engine IS, so the
 * card was structurally incapable of showing the thing it exists to show. `reportsRead` stayed at 30
 * because the document COUNT had not moved.
 *
 * Two halves here, because either alone still leaves the admin's question unanswered:
 *   1. the window is per BUILD (`listRecentBuildReports`, reading the history subcollection that
 *      `saveDiagnosticsHistory` has been writing all along and nothing was reading);
 *   2. a TREND, because a table of averages over one window cannot answer "is it getting better" —
 *      a run of cheap builds and a run of dear ones produce the same mean.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { costTrend, MIN_TREND_SAMPLE, type BuildCostRow } from '../src/server/lib/buildCostLedger';
import { costHeadline, trendHeadline, deltaLabel, type BuildCostsResponse, type CostTrend } from '../src/components/admin/BuildCostCard';

const src = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');
/** Comments stripped: a promise in a comment is not a promise in the code. */
const code = (rel: string): string =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const row = (o: Partial<BuildCostRow> & { startedAt: number }): BuildCostRow => ({
  workspaceId: 'ws', tier: 'weak', tierName: 'Weak', size: 'simple', files: 3,
  ok: true, minutes: 5, heals: 0, billedInr: 10, zeroBillReason: null,
  realInr: 4, realUsd: 0.05, sandboxInr: null, measured: true, source: 'settled',
  unmeasuredCalls: 0, marginInr: 6, ...o,
});

describe('🔴 the window is BUILDS now, not workspaces', () => {
  it('the route reads the per-build history, not one report per workspace', () => {
    const admin = code('../src/server/routes/admin.ts');
    expect(admin).toContain('listRecentBuildReports(limit)');
    // REVERSION GUARD: the call that made twenty builds in one workspace look like one.
    expect(admin).not.toContain('listRecentFullReports(limit)');
  });

  it('the store reads each workspace\'s history subcollection, one entry per build', () => {
    const store = code('../src/server/AgentV3/DiagnosticsStore.ts');
    const fn = store.slice(store.indexOf('export async function listRecentBuildReports'));
    expect(fn).toContain('HISTORY_SUBCOLLECTION');
    expect(fn).toContain("source: 'history'");
  });

  it('⚠️ it orders by documentId, so it needs no Firestore index that nobody creates', () => {
    const store = code('../src/server/AgentV3/DiagnosticsStore.ts');
    const fn = store.slice(store.indexOf('export async function listRecentBuildReports'));
    expect(fn).toContain('admin.firestore.FieldPath.documentId()');
    // An ordered collectionGroup query is the obvious alternative and needs a collection-group index;
    // its absence is a RUNTIME failure, and this repo ships no firestore.indexes.json.
    expect(fn).not.toContain('collectionGroup');
  });

  it('a build still running is left out — it has no settled billing to average', () => {
    const store = code('../src/server/AgentV3/DiagnosticsStore.ts');
    const fn = store.slice(store.indexOf('export async function listRecentBuildReports'));
    expect(fn).toContain('report.endedAt === undefined');
  });

  it('🔒 an unreadable workspace cannot empty the whole card', () => {
    const store = code('../src/server/AgentV3/DiagnosticsStore.ts');
    const fn = store.slice(store.indexOf('export async function listRecentBuildReports'));
    expect(fn).toContain('return []; ');
  });
});

describe('🔒 the fallback is named, never disguised', () => {
  const base: BuildCostsResponse = {
    rows: [{ workspaceId: 'w', startedAt: 1, tierName: 'Weak', size: 'simple', files: 1, ok: true,
      minutes: 1, heals: 0, billedInr: 1, zeroBillReason: null, realInr: 1, sandboxInr: null,
      measured: true, source: 'settled', marginInr: 0 }],
    summary: [], usdInr: 87, window: 30, reportsRead: 1, sizeRule: '', note: '',
  };

  it('the per-build window says nothing extra', () => {
    const h = costHeadline({ ...base, source: 'history' }, '');
    expect(h).toContain('1 builds read');
    expect(h).not.toContain('LATEST build only');
  });

  it('⚠️ the per-workspace fallback SAYS it is per-workspace — the bug was a window that lied', () => {
    const h = costHeadline({ ...base, source: 'latest-per-workspace' }, '');
    expect(h).toContain("each workspace's LATEST build only");
    expect(h).toContain('repeated builds in one workspace are not shown');
  });

  it('a server that has not deployed this change still renders, claiming nothing new', () => {
    expect(costHeadline(base, '')).toContain('1 builds read');
  });
});

describe('📉 the trend answers "are we making progress?"', () => {
  it('a real improvement reads as negative on cost, minutes and heals', () => {
    const rows = [
      ...[10, 11, 12].map((i) => row({ startedAt: 2000 + i, realInr: 2, minutes: 3, heals: 0 })),
      ...[10, 11, 12].map((i) => row({ startedAt: 1000 + i, realInr: 6, minutes: 9, heals: 2 })),
    ];
    const t = costTrend(rows);
    expect(t.comparable).toBe(true);
    expect(t.realInr.delta).toBe(-4);
    expect(t.minutes.delta).toBe(-6);
    expect(t.heals.delta).toBe(-2);
    expect(trendHeadline(t)).toContain('real cost down');
    expect(trendHeadline(t)).toContain('heals down');
  });

  it('a regression reads as positive — the card is not built to flatter us', () => {
    const rows = [
      ...[1, 2, 3].map((i) => row({ startedAt: 2000 + i, realInr: 9 })),
      ...[1, 2, 3].map((i) => row({ startedAt: 1000 + i, realInr: 3 })),
    ];
    expect(costTrend(rows).realInr.delta).toBe(6);
    expect(trendHeadline(costTrend(rows))).toContain('real cost up');
  });

  it(`🔒 below ${MIN_TREND_SAMPLE} builds a side, it refuses to report a delta`, () => {
    const rows = [row({ startedAt: 2001, realInr: 1 }), row({ startedAt: 1001, realInr: 100 })];
    const t = costTrend(rows);
    expect(t.realInr.delta).toBeNull();
    expect(t.comparable).toBe(false);
    expect(trendHeadline(t)).toContain('Not enough builds');
    // "cost fell 99%" off one build each side is noise wearing a decimal point.
    expect(deltaLabel(t.realInr, 'inr')).toContain('not enough builds yet');
  });

  it('an unmeasured build is excluded from the cost halves rather than counted as ₹0', () => {
    const rows = [
      ...[1, 2, 3].map((i) => row({ startedAt: 2000 + i, realInr: 2 })),
      row({ startedAt: 1003, realInr: null, measured: false, source: 'none' }),
      ...[1, 2].map((i) => row({ startedAt: 1000 + i, realInr: 8 })),
    ];
    const t = costTrend(rows);
    expect(t.realInr.nOlder).toBe(2);           // the unmeasured one is not in the denominator
    expect(t.realInr.delta).toBeNull();          // and with 2 it is below the sample floor, honestly
  });

  it('⚠️ success rate is the ONE metric where up is better, and the label says so', () => {
    const up: CostTrend['successRate'] = { recent: 1, older: 0.5, delta: 0.5, nRecent: 4, nOlder: 4 };
    expect(deltaLabel(up, 'plain', true)).toContain('better');
    const down: CostTrend['successRate'] = { recent: 0.5, older: 1, delta: -0.5, nRecent: 4, nOlder: 4 };
    expect(deltaLabel(down, 'plain', true)).toContain('worse');
    // The same numbers on a COST metric mean the opposite.
    expect(deltaLabel(down, 'inr')).toContain('better');
  });

  it('an odd count drops the middle build rather than counting it twice', () => {
    const rows = [1, 2, 3, 4, 5].map((i) => row({ startedAt: 1000 + i }));
    const t = costTrend(rows);
    expect(t.nRecent).toBe(2);
    expect(t.nOlder).toBe(2);
  });

  it('input order does not matter — the split is by time, not by arrival', () => {
    const asc = [1, 2, 3, 4, 5, 6].map((i) => row({ startedAt: 1000 + i, realInr: i }));
    expect(costTrend(asc).realInr).toEqual(costTrend([...asc].reverse()).realInr);
  });

  it('no builds at all is not a crash and not a claim', () => {
    const t = costTrend([]);
    expect(t.comparable).toBe(false);
    expect(t.splitAt).toBeNull();
    expect(trendHeadline(t)).toContain('Not enough builds');
  });

  it('a server with no trend field says so instead of drawing an empty verdict', () => {
    expect(trendHeadline(undefined)).toContain('not available');
  });
});

describe('🔒 the card stops describing a window it does not have', () => {
  it('it shows WHEN it was read, so a stale card cannot look live', () => {
    expect(code('../src/components/admin/BuildCostCard.tsx')).toContain('data.readAt');
  });

  it('the route hands over the read time, the source and the trend', () => {
    const admin = code('../src/server/routes/admin.ts');
    for (const field of ['trend: costTrend(rows)', 'source: recent.source', 'readAt: Date.now()']) {
      expect(admin, field).toContain(field);
    }
  });

  it('the note tells the admin the window is per build', () => {
    expect(src('../src/server/routes/admin.ts')).toContain('One row per BUILD');
  });
});
