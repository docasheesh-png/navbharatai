import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  judgeable, editSurvival, distribution, timeToWorkingApp, costPerWorkingApp,
  buildSuccess, builderScorecard, scorecardHeadline, MIN_SAMPLES_FOR_RATE,
  type BuildMetricInput,
} from '../src/lib/builderMetrics';

/**
 * THE FAILURE MODE THESE TESTS EXIST FOR is not a wrong number — it is a CONFIDENT number.
 *
 * Every autopsy this platform has run came back to the same thing: we could not tell whether the
 * engine was improving. The temptation when adding metrics is to always return something, because a
 * dashboard with a blank looks broken. That instinct is exactly what produces "0% success" for a
 * platform with no builds yet, or "100% edit survival" computed from a single edit — numbers that
 * survive for months and get decisions made on them.
 *
 * So most of these cases are about what the metrics REFUSE to say.
 */
const b = (o: Partial<BuildMetricInput> & { ok: boolean | null }): BuildMetricInput => ({
  workspaceId: 'w1', reportedAt: 1, inFlight: false, buildMs: null, billedInr: null, ...o,
});

describe('what it refuses to claim', () => {
  it('no data is NULL, never 0% — those are different facts', () => {
    expect(buildSuccess([]).rate).toBeNull();
    expect(editSurvival([]).rate).toBeNull();
    expect(timeToWorkingApp([]).median).toBeNull();
    expect(costPerWorkingApp([]).median).toBeNull();
  });

  it('an IN-FLIGHT build is excluded, not counted as a failure', () => {
    // A build still running has no verdict. Counting it as failed would make every dashboard read
    // worse the busier the platform is.
    const s = buildSuccess([b({ ok: null, inFlight: true }), b({ ok: true })]);
    expect(s.total).toBe(1);
    expect(s.rate).toBe(1);
    expect(s.skipped).toBe(1);
  });

  it('a verdict-less record is excluded too', () => {
    expect(judgeable([b({ ok: null })])).toHaveLength(0);
  });

  it('says out loud when a rate rests on too few builds', () => {
    const card = builderScorecard([b({ ok: true }), b({ ok: true })]);
    expect(scorecardHeadline(card)).toContain('too few builds');
  });

  it('and stops saying it once there is enough', () => {
    const many = Array.from({ length: MIN_SAMPLES_FOR_RATE + 1 }, (_, i) => b({ ok: true, workspaceId: `w${i}` }));
    expect(scorecardHeadline(builderScorecard(many))).not.toContain('too few builds');
  });

  it('reports the sample size behind every rate', () => {
    expect(buildSuccess([b({ ok: true }), b({ ok: false })]).total).toBe(2);
  });
});

describe('edit survival — the 500-edit benchmark, measured on real projects', () => {
  it('the FIRST build is the creation, not an edit', () => {
    // A project that was born broken belongs to build-success, not to edit survival.
    const s = editSurvival([b({ ok: true, workspaceId: 'a', reportedAt: 1 })]);
    expect(s.projects).toBe(0);
    expect(s.edits).toBe(0);
    expect(s.rate).toBeNull();
  });

  it('counts follow-up builds, and only those', () => {
    const s = editSurvival([
      b({ ok: true, workspaceId: 'a', reportedAt: 1 }),   // creation
      b({ ok: true, workspaceId: 'a', reportedAt: 2 }),   // edit 1
      b({ ok: false, workspaceId: 'a', reportedAt: 3 }),  // edit 2
    ]);
    expect(s.projects).toBe(1);
    expect(s.edits).toBe(2);
    expect(s.survived).toBe(1);
    expect(s.rate).toBe(0.5);
  });

  it('orders by time, not by array order — reports arrive out of order', () => {
    const s = editSurvival([
      b({ ok: false, workspaceId: 'a', reportedAt: 3 }),
      b({ ok: true, workspaceId: 'a', reportedAt: 1 }),
      b({ ok: true, workspaceId: 'a', reportedAt: 2 }),
    ]);
    // Chronologically: ok, ok, fail → 2 edits, 1 survived, and the project is currently broken.
    expect(s.edits).toBe(2);
    expect(s.survived).toBe(1);
    expect(s.currentlyBroken).toBe(1);
  });

  it('tracks the longest clean run across a project', () => {
    const s = editSurvival([
      b({ ok: true, workspaceId: 'a', reportedAt: 1 }),
      b({ ok: true, workspaceId: 'a', reportedAt: 2 }),
      b({ ok: true, workspaceId: 'a', reportedAt: 3 }),
      b({ ok: false, workspaceId: 'a', reportedAt: 4 }),
      b({ ok: true, workspaceId: 'a', reportedAt: 5 }),
    ]);
    expect(s.longestStreak).toBe(2); // edits 1–2 succeeded, edit 3 failed, edit 4 succeeded
  });

  it('CURRENTLY BROKEN counts the projects a user is stuck on right now', () => {
    // The most actionable number on the whole card: someone is sitting in front of a broken app.
    const s = editSurvival([
      b({ ok: true, workspaceId: 'a', reportedAt: 1 }), b({ ok: false, workspaceId: 'a', reportedAt: 2 }),
      b({ ok: true, workspaceId: 'x', reportedAt: 1 }), b({ ok: true, workspaceId: 'x', reportedAt: 2 }),
    ]);
    expect(s.currentlyBroken).toBe(1);
  });

  it('a later successful build clears "currently broken"', () => {
    const s = editSurvival([
      b({ ok: true, workspaceId: 'a', reportedAt: 1 }),
      b({ ok: false, workspaceId: 'a', reportedAt: 2 }),
      b({ ok: true, workspaceId: 'a', reportedAt: 3 }),
    ]);
    expect(s.currentlyBroken).toBe(0);
  });

  it('keeps projects separate — one broken app must not sink another', () => {
    const s = editSurvival([
      b({ ok: true, workspaceId: 'a', reportedAt: 1 }), b({ ok: true, workspaceId: 'a', reportedAt: 2 }),
      b({ ok: true, workspaceId: 'z', reportedAt: 1 }), b({ ok: false, workspaceId: 'z', reportedAt: 2 }),
    ]);
    expect(s.projects).toBe(2);
    expect(s.rate).toBe(0.5);
  });

  it('a build with no workspace cannot be attributed to a project history', () => {
    const s = editSurvival([b({ ok: true, workspaceId: null }), b({ ok: true, workspaceId: null })]);
    expect(s.projects).toBe(0);
  });
});

describe('distributions — the median leads, the tail is not hidden', () => {
  it('median, p90 and worst', () => {
    const d = distribution([1, 2, 3, 4, 100]);
    expect(d.median).toBe(3);
    expect(d.worst).toBe(100);
    expect(d.samples).toBe(5);
  });

  it('an even sample averages the middle pair', () => {
    expect(distribution([1, 2, 3, 4]).median).toBe(2.5);
  });

  it('junk values are dropped rather than poisoning the number', () => {
    const d = distribution([10, NaN as number, Infinity as number, -5, 20]);
    expect(d.samples).toBe(2);
    expect(d.median).toBe(15);
  });

  it('time is measured over SUCCESSFUL builds only', () => {
    // A build that gave up in 30 seconds is not "fast", and averaging it in flatters a slow engine.
    const t = timeToWorkingApp([
      b({ ok: true, buildMs: 120000 }),
      b({ ok: false, buildMs: 1000 }),
    ]);
    expect(t.samples).toBe(1);
    expect(t.median).toBe(120000);
  });

  it('cost is measured over successful builds only, and surfaces the WORST', () => {
    // The ₹566.96 build that started all of this sat inside a healthy-looking average.
    const c = costPerWorkingApp([
      b({ ok: true, billedInr: 12 }), b({ ok: true, billedInr: 15 }), b({ ok: true, billedInr: 566.96 }),
      b({ ok: false, billedInr: 400 }),
    ]);
    expect(c.samples).toBe(3);
    expect(c.median).toBe(15);
    expect(c.worst).toBeCloseTo(566.96, 2);
  });

  it('a free build at ₹0 is real data, not missing data', () => {
    expect(costPerWorkingApp([b({ ok: true, billedInr: 0 })]).samples).toBe(1);
  });
});

describe('the headline reads honestly in every state', () => {
  it('empty platform', () => {
    const h = scorecardHeadline(builderScorecard([]));
    expect(h).toContain('No finished builds recorded yet');
    expect(h).toContain('no project has been edited more than once');
    expect(h).not.toContain('0.0%'); // the lie this whole file exists to prevent
  });

  it('a real mixed history', () => {
    const builds = [
      b({ ok: true, workspaceId: 'a', reportedAt: 1, buildMs: 120000, billedInr: 20 }),
      b({ ok: true, workspaceId: 'a', reportedAt: 2, buildMs: 60000, billedInr: 10 }),
      b({ ok: false, workspaceId: 'b', reportedAt: 1 }),
      b({ ok: true, workspaceId: 'b', reportedAt: 2, buildMs: 900000, billedInr: 566.96 }),
      b({ ok: true, workspaceId: 'c', reportedAt: 1, buildMs: 90000, billedInr: 15 }),
      b({ ok: true, workspaceId: 'c', reportedAt: 2, buildMs: 90000, billedInr: 15 }),
    ];
    const h = scorecardHeadline(builderScorecard(builds));
    expect(h).toContain('Build success: 83.3% of 6');
    expect(h).toContain('Edit survival: 100.0% of 3 edit(s) across 3 project(s)');
    expect(h).toContain('₹566.96 worst');
  });
});

/**
 * THE WIRING. A metric nothing exposes is a metric nobody reads — the same dead-code failure this
 * codebase has hit repeatedly with generators the builder could not call.
 */
describe('the admin can actually see it', () => {
  const admin = readFileSync(join(__dirname, '../src/server/routes/admin.ts'), 'utf8');

  it('the scorecard route exists and is admin-gated', () => {
    expect(admin).toContain("app.get('/api/admin/builder-scorecard', verifyAdminToken");
  });

  it('it computes from the STORED reports, not a benchmark app', () => {
    // §53 of the directive: no hardcoded benchmark projects. Real builds or nothing.
    expect(admin).toContain('listAdminBuildReports(limit)');
    expect(admin).toContain('builderScorecard(reports)');
  });

  it('it returns the honest headline alongside the raw numbers', () => {
    expect(admin).toContain('scorecardHeadline(card)');
    expect(admin).toContain('reportsRead: reports.length');
  });
});
