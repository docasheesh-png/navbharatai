/**
 * "SAHI SOURCE LAGA DO" — admin, 2026-09-24, after the Builder scorecard was read back to them.
 *
 * 🔴 THE CARD WAS SCORING COMPLAINTS. `/api/admin/builder-scorecard` read `listAdminBuildReports()`,
 * the admin REPORT INBOX. A build enters that collection by exactly two routes — `shouldAutoReport`,
 * which fires only on `verdict === 'bad'`, and a user pressing Report — and neither admits a build
 * that worked. So "Build success: 90.2% of 41" was the success rate of the complaints, and nothing on
 * the card said so.
 *
 * 🔑 THE REPO ALREADY KNEW: `/api/admin/failure-categories` was moved to the comprehensive source on
 * 2026-09-16 and its docblock names the trap verbatim. The instance was fixed; the sibling was not.
 *
 * ⚠️ THE CENTRAL GUARD IS SOURCE-LEVEL AND HAS TO BE. `tsc` and `vitest` cannot see that a metric is
 * reading the wrong collection — both stores return plausible rows and every number computes fine.
 * That is exactly how this shipped and survived review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { workaroundPressure, builderScorecard, scorecardHeadline, type BuildMetricInput } from '../src/lib/builderMetrics';
import { toMetricInput, populationNote, collectScorecardBuilds, type ScorecardPopulation } from '../src/server/lib/scorecardPopulation';
import { listAllDiagnostics, listDiagnosticsHistoryResult } from '../src/server/AgentV3/DiagnosticsStore';

vi.mock('../src/server/AgentV3/DiagnosticsStore', () => ({
  listAllDiagnostics: vi.fn(),
  listDiagnosticsHistoryResult: vi.fn(),
}));
const index = vi.mocked(listAllDiagnostics);
const history = vi.mocked(listDiagnosticsHistoryResult);
const ws = (id: string) => ({ workspaceId: id, savedAt: 9, startedAt: 9, endedAt: 10, ok: true, counts: { autoResolved: 0, workarounds: 0 } });
const build = (started: number, ok: boolean) => ({ id: String(started), startedAt: started, endedAt: started + 1000, ok, counts: { total: 0, errors: 0, warnings: 0, autoResolved: 2, unresolved: 0, workarounds: 1 } });

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Comments stripped. Both files DOCUMENT the store they must not read — naming it is how the next
 * session learns why. A guard that reads comments fails on the explanation instead of on the code,
 * and gets weakened until it says nothing.
 */
const code = (p: string) => src(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** The same stripper, for a slice already in hand. */
const strip = (body: string) => body
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** The scorecard route handler, sliced out of admin.ts so the guard judges IT and not the whole file. */
function scorecardHandler(): string {
  const body = src('src/server/routes/admin.ts');
  const start = body.indexOf("app.get('/api/admin/builder-scorecard'");
  const next = body.indexOf('app.get(', start + 10);
  expect(start, 'the scorecard route vanished').toBeGreaterThan(-1);
  expect(next, 'could not find the end of the handler').toBeGreaterThan(start);
  return body.slice(start, next);
}

describe('THE SOURCE — the whole fix', () => {
  it('the handler was really found (so every guard below judges real code)', () => {
    const h = scorecardHandler();
    expect(h).toContain('builderScorecard');
    expect(h.length).toBeGreaterThan(200);
  });

  it('the stripper keeps code and drops prose, so no guard here is vacuously true', () => {
    const mod = code('src/server/lib/scorecardPopulation.ts');
    expect(mod).toContain('export async function collectScorecardBuilds');  // code survives
    expect(mod).not.toContain('sahi source laga do');                       // the block comment is gone
    expect(strip(scorecardHandler())).toContain('builderScorecard(builds)');
  });

  it('🔴 the scorecard does NOT read the complaint inbox', () => {
    expect(strip(scorecardHandler())).not.toContain('listAdminBuildReports');
  });

  it('it reads the comprehensive population instead', () => {
    expect(scorecardHandler()).toContain('collectScorecardBuilds');
  });

  it('the collector reads the SAME store the failure-category panel was moved to', () => {
    const mod = code('src/server/lib/scorecardPopulation.ts');
    expect(mod).toContain('listAllDiagnostics');
    expect(mod).toContain('listDiagnosticsHistoryResult');
    // The inbox must not be reachable from the collector either — that would move the bug, not fix it.
    expect(mod).not.toContain('listAdminBuildReports');
  });

  it('the inbox is still read where it BELONGS — this is not a ban on the store', () => {
    // The report inbox panel legitimately lists reports; the defect was a METRIC reading it.
    expect(src('src/server/routes/admin.ts')).toContain('listAdminBuildReports');
  });
});

describe('a naive swap would have destroyed edit survival — it did not', () => {
  it('history rows carry their workspace, so builds still group into projects', () => {
    // listAllDiagnostics gives ONE row per workspace; edit survival groups BY workspace, so on that
    // source alone every project would hold exactly one build and the metric would read "unknown"
    // for ever while looking like it had simply found nothing.
    const mod = code('src/server/lib/scorecardPopulation.ts');
    expect(mod).toContain('workspaceId: entry.workspaceId');
  });

  it('several builds of one workspace really do produce edits', () => {
    const rows: BuildMetricInput[] = [
      { workspaceId: 'w1', reportedAt: 1, ok: true },
      { workspaceId: 'w1', reportedAt: 2, ok: true },
      { workspaceId: 'w1', reportedAt: 3, ok: true },
    ];
    const card = builderScorecard(rows);
    expect(card.survival.projects).toBe(1);
    expect(card.survival.edits).toBe(2);   // the first build is the CREATION, not an edit
    expect(card.survival.rate).toBe(1);
  });
});

describe('toMetricInput — what a row means, and what it must never invent', () => {
  it('reads the verdict, the duration, the charge and both counts', () => {
    expect(toMetricInput({
      workspaceId: 'w1', startedAt: 1_000, endedAt: 61_000, ok: true, billedInr: 28.95,
      counts: { autoResolved: 6, workarounds: 2 },
    })).toEqual({
      workspaceId: 'w1', reportedAt: 1_000, ok: true, buildMs: 60_000,
      billedInr: 28.95, healCount: 6, workaroundCount: 2,
    });
  });

  it('🔒 an ABSENT heal count is undefined, never 0 — 0 would score a legacy row as a clean pass', () => {
    const r = toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2, ok: true, counts: {} });
    expect(r.healCount).toBeUndefined();
    expect(r.workaroundCount).toBeUndefined();
    expect(healOf([r]).builds).toBe(0);      // excluded from the rate, not counted as clean
  });

  it('a build with no end is not a zero-length build', () => {
    expect(toMetricInput({ workspaceId: 'w', startedAt: 5_000, ok: true }).buildMs).toBeNull();
    // and a clock that ran backwards is refused rather than reported as negative
    expect(toMetricInput({ workspaceId: 'w', startedAt: 9_000, endedAt: 1_000, ok: true }).buildMs).toBeNull();
  });

  it('no verdict yet ⇒ ok is null, so the build is skipped rather than counted as a failure', () => {
    const r = toMetricInput({ workspaceId: 'w', startedAt: 1, endedAt: 2 });
    expect(r.ok).toBeNull();
    expect(builderScorecard([r]).success.skipped).toBe(1);
    expect(builderScorecard([r]).success.failed).toBe(0);
  });

  it('prefers the BUILD clock over the row\'s write time', () => {
    expect(toMetricInput({ workspaceId: 'w', startedAt: 111, savedAt: 999, ok: true }).reportedAt).toBe(111);
    expect(toMetricInput({ workspaceId: 'w', savedAt: 999, ok: true }).reportedAt).toBe(999);
  });
});

const healOf = (rows: BuildMetricInput[]) => builderScorecard(rows).heal;

describe('🔀 THE WORKAROUND BUCKET — recorded for months, shown on no card until now', () => {
  it('counts builds that routed around a problem', () => {
    const w = workaroundPressure([
      { workspaceId: 'a', reportedAt: 1, ok: true, workaroundCount: 0 },
      { workspaceId: 'b', reportedAt: 2, ok: true, workaroundCount: 3 },
      { workspaceId: 'c', reportedAt: 3, ok: true, workaroundCount: 1 },
    ]);
    expect(w).toEqual({ builds: 3, buildsWithWorkaround: 2, rate: 2 / 3, perBuild: 1.33, worst: 3 });
  });

  it('🔒 excludes an unrecorded build, exactly as healPressure does', () => {
    const w = workaroundPressure([{ workspaceId: 'a', reportedAt: 1, ok: true }]);
    expect(w.builds).toBe(0);
    expect(w.rate).toBe(0);
  });

  it('is NEVER folded into the heal tally — a workaround did not fix anything', () => {
    const rows: BuildMetricInput[] = [{ workspaceId: 'a', reportedAt: 1, ok: true, healCount: 0, workaroundCount: 4 }];
    const card = builderScorecard(rows);
    expect(card.heal.buildsNeedingHeal).toBe(0);
    expect(card.workaround.buildsWithWorkaround).toBe(1);
  });

  it('the headline states it as DEBT, and says nothing when nothing was measured', () => {
    const withIt = scorecardHeadline(builderScorecard([
      { workspaceId: 'a', reportedAt: 1, ok: true, workaroundCount: 2 },
    ]));
    expect(withIt).toContain('deferred root cause');
    const without = scorecardHeadline(builderScorecard([{ workspaceId: 'a', reportedAt: 1, ok: true }]));
    expect(without).not.toContain('Workarounds:');
  });
});

describe('THE CARD NAMES ITS OWN POPULATION', () => {
  const base: ScorecardPopulation = {
    source: 'all-workspaces', workspaces: 120, historyFetched: 60, historyUnreadable: 0,
    latestOnly: 60, builds: 480, historyWorkspaces: 60,
  };

  it('says plainly that it is not only the reported builds', () => {
    const note = populationNote(base);
    expect(note).toContain('EVERY workspace');
    expect(note).toContain('not only the builds someone reported');
    expect(note).toContain('480 build(s)');
  });

  it('discloses the history bound rather than presenting a partial read as complete', () => {
    expect(populationNote(base)).toContain('60 workspace(s) beyond');
  });

  it('🔒 a FAILED history read is disclosed and never counted as zero builds', () => {
    const note = populationNote({ ...base, historyUnreadable: 4 });
    expect(note).toContain('4 workspace(s) could not have their history read');
    expect(note).toContain('not as zero');
  });

  it('a fully-read window says neither of those two things', () => {
    const note = populationNote({ ...base, latestOnly: 0, historyUnreadable: 0 });
    expect(note).not.toContain('beyond');
    expect(note).not.toContain('could not have their history read');
  });

  it('the route puts the note INSIDE the headline, where a card cannot forget to render it', () => {
    const h = scorecardHandler();
    expect(h).toContain('populationNote(population)');
    expect(h).toMatch(/headline:\s*`\$\{scorecardHeadline\(card\)\}/);
  });
});


describe('collectScorecardBuilds — the behaviour, not the sentence about it', () => {
  beforeEach(() => { index.mockReset(); history.mockReset(); });

  it('turns each workspace\'s HISTORY into build rows, so edit survival is real', async () => {
    index.mockResolvedValue([ws('w1'), ws('w2')] as any);
    history.mockImplementation(async (id: string) => ({
      entries: id === 'w1' ? [build(1, true), build(2, true), build(3, true)] : [build(4, true)],
      ok: true,
    }) as any);

    const { builds, population } = await collectScorecardBuilds(200);
    expect(population.builds).toBe(4);
    expect(population.historyFetched).toBe(2);
    expect(population.historyUnreadable).toBe(0);
    const card = builderScorecard(builds);
    expect(card.survival.projects).toBe(1);   // only w1 has more than one build
    expect(card.survival.edits).toBe(2);
    expect(card.workaround.buildsWithWorkaround).toBe(4);
  });

  it('🔴 A FAILED HISTORY READ IS COUNTED AND FALLS BACK — found by reversion, not by reasoning', async () => {
    // The first draft of this suite only checked that populationNote RENDERS `historyUnreadable`.
    // Deleting the counter AND the fallback from the collector passed every case — the workspace
    // simply vanished from the numbers, which is a metric quietly improving itself on an outage.
    index.mockResolvedValue([ws('w1'), ws('w2')] as any);
    history.mockImplementation(async (id: string) => (
      id === 'w1' ? { entries: [build(1, true), build(2, true)], ok: true } : { entries: [], ok: false }
    ) as any);

    const { builds, population } = await collectScorecardBuilds(200);
    expect(population.historyUnreadable).toBe(1);
    // w2 is still represented — by its latest build — rather than dropped from the denominator.
    expect(builds.some((b) => b.workspaceId === 'w2')).toBe(true);
    expect(population.builds).toBe(3);
    expect(populationNote(population)).toContain('1 workspace(s) could not have their history read');
  });

  it('a workspace with no history yet is represented by its latest build, not dropped', async () => {
    index.mockResolvedValue([ws('w1')] as any);
    history.mockResolvedValue({ entries: [], ok: true } as any);
    const { builds, population } = await collectScorecardBuilds(200);
    expect(population.builds).toBe(1);
    expect(population.historyUnreadable).toBe(0);   // an empty history is NOT a failed read
    expect(builds[0].workspaceId).toBe('w1');
  });

  it('🔒 the history bound is real: workspaces past it are counted, never silently dropped', async () => {
    index.mockResolvedValue([ws('w1'), ws('w2'), ws('w3')] as any);
    history.mockResolvedValue({ entries: [build(1, true), build(2, true)], ok: true } as any);
    const { population } = await collectScorecardBuilds(200, 1);
    expect(population.workspaces).toBe(3);
    expect(population.historyFetched).toBe(1);
    expect(population.latestOnly).toBe(2);
    expect(population.builds).toBe(4);            // 2 from history + 2 latest-only
    expect(history).toHaveBeenCalledTimes(1);     // the bound really bounds the I/O
  });

  it('an index that cannot be read yields an empty card, never a throw', async () => {
    index.mockRejectedValue(new Error('firestore down'));
    const { builds, population } = await collectScorecardBuilds(200);
    expect(builds).toEqual([]);
    expect(population.workspaces).toBe(0);
  });
});
