import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { firstPassStatsFromMeta, firstPassMetaFromDiagnostics } from '../src/lib/firstPassQuality';

/**
 * ADMIN SCREENSHOT 2026-08-12 — the First-pass quality card reading "4.3% right first time, 24 of 47
 * failed".
 *
 * The number was real. What it MEASURED was not what the card said.
 *
 * Both the endpoint and the card computed the rate from the inbox of reports USERS SUBMITTED by
 * pressing "Report" — and people press Report when something went WRONG. So the sample was
 * self-selected for failure, while the endpoint's own comment called it "the one number that says
 * whether the ENGINE is getting better".
 *
 *     "4.3% of builds are right first time"
 *     "4.3% of the builds people complained about were right first time"
 *
 * Different sentences. Only the second one was ever true. This is the same defect class as
 * TIME_TO_FIRST_CALL blaming setup for a model's latency: a number measured off the wrong source and
 * presented with total confidence.
 */

const route = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
const panel = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

describe('the headline now counts every build, not every complaint', () => {
  it('the endpoint reads the engine\'s own record of ALL builds', () => {
    const at = route.indexOf("app.get('/api/admin/first-pass-quality'");
    const fn = route.slice(at, at + 3000);
    expect(fn).toContain('listAllDiagnostics(limit)');
    expect(fn).toContain("source: 'all-builds'");
  });

  it('the reported-only figure is KEPT beside it, not deleted', () => {
    /**
     * The GAP between the two is itself the signal. Complaints far below the engine-wide rate is
     * healthy self-selection — people report what broke. The two being EQUAL would mean users are
     * reporting a fair sample, which is much worse news, and deleting the complaints figure would
     * hide exactly that.
     */
    const at = route.indexOf("app.get('/api/admin/first-pass-quality'");
    expect(route.slice(at, at + 4000)).toContain('reported: { ...reported, headline: firstPassHeadline(reported) }');
  });

  it('the card takes the SERVER\'s answer — the local computation is gone', () => {
    // Sharing a formula while feeding it a different population is how two numbers drift while
    // looking identical. Removing the second path is what stops that happening again.
    expect(panel).toContain("fetch('/api/admin/first-pass-quality?limit=500'");
    expect(panel).not.toContain('firstPassStatsFromMeta(buildReports)');
  });

  it('the card says out loud which population it counted', () => {
    expect(panel).toContain('Source: every user’s build records, not only reported complaints.');
  });

  it('…and shows the complaints rate with an honest reading of the gap', () => {
    expect(panel).toMatch(/users actually pressed/);
    expect(panel).toMatch(/people report what broke/);
    expect(panel).toMatch(/that alone does not show whether reports are a representative sample/);
  });
});

describe('the shape mismatch that would have produced a WORSE number', () => {
  /**
   * `firstPassStatsFromMeta` reads the ADMIN-REPORT projection (`healCount` / `unresolvedCount`); the
   * engine's build record carries the same two numbers as `counts.autoResolved` / `counts.unresolved`.
   *
   * Passing the second straight in TYPE-CHECKS — every field is optional — and then classifies every
   * delivered build as "legacy, no counts recorded". This test is the proof, and the reason the mapping
   * is explicit at the one place the two vocabularies meet.
   */
  const raw = [
    { ok: true, counts: { healRule: 3, autoResolved: 0, unresolved: 0 } },   // genuinely clean
    { ok: true, counts: { healRule: 3, autoResolved: 3, unresolved: 0 } },   // healed
    { ok: false, counts: { healRule: 3, autoResolved: 1, unresolved: 2 } },  // failed
  ];

  it('unmapped, it reports almost nothing as measurable — and would have read ~100% failed', () => {
    const wrong = firstPassStatsFromMeta(raw as any);
    expect(wrong.clean).toBe(0);          // the genuinely clean build vanished
    expect(wrong.healed).toBe(0);
    expect(wrong.skippedLegacy).toBe(2);  // both delivered builds thrown away
    expect(wrong.cleanRate).toBe(0);
  });

  it('mapped, it reports the truth', () => {
    const right = firstPassStatsFromMeta(raw.map(firstPassMetaFromDiagnostics));
    expect(right.clean).toBe(1);
    expect(right.healed).toBe(1);
    expect(right.failed).toBe(1);
    expect(right.skippedLegacy).toBe(0);
    expect(right.cleanRate).toBeCloseTo(1 / 3, 5);
  });

  it('the route performs that mapping explicitly', () => {
    expect(route).toContain('allBuilds.map(firstPassMetaFromDiagnostics)');
    expect(firstPassMetaFromDiagnostics(raw[0])).toMatchObject({ healCount: 0, unresolvedCount: 0,
      repairCount: { total: 0, provenance: 'current-rule' } });
  });

  it('a genuinely legacy row is still excluded, not counted as clean', () => {
    // The original protection must survive: a row with no counts at all is unknowable, and counting
    // it as clean would inflate the exact number we judge ourselves by.
    const s = firstPassStatsFromMeta([{ ok: true }, { ok: true, healRule: 3, healCount: 0, unresolvedCount: 0 }]);
    expect(s.skippedLegacy).toBe(1);
    expect(s.clean).toBe(1);
    expect(s.total).toBe(1);
  });
});
