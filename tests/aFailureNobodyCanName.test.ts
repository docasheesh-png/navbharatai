/**
 * A FAILURE NOBODY CAN NAME, AND A NUMBER NO FIX CAN MOVE.
 *
 * 🔴 THE REPORT (admin, 2026-09-20). The admin panel's failure table, across every app type:
 *
 *     Other (not yet in the known pattern list)        42  (29.2% of failures)
 *     The release gate found evidence …                25  (17.4%)
 *     The run ended before it finished                 16  (11.1%)
 *     …
 *
 * — and the question: *"inko kaise kaise fix kar sakte hai? kya kya kar sakte ho aap jisse yeh
 * failure ab wapas na aye?"*
 *
 * TWO DEFECTS IN THAT TABLE, both about the panel telling the truth rather than about any one build.
 *
 * **1 — the top row named the wrong problem.** `classifyFailureReason` returns a mapped reason for
 * EVERY `OUTCOME_*` code it knows, and `tests/failureNaming.test.ts` fails CI when a code exists
 * without a label. So a build reaching the end of that function with **no code at all** did not
 * record why it ended — that is a hole in the engine's record, not a gap in our vocabulary. Calling
 * it *"not yet in the known pattern list"* told every reader to go and write regexes, when no regex
 * that could ever be written would help. Both fixes shipped straight at that row (the empty-build
 * outcome, 2026-09-17; the seven unrecorded aborts, 2026-09-18) were attacking exactly this, and the
 * panel could not say whether either had worked.
 *
 * **2 — the count is a lifetime total, so it can only ever go up.** Every row tallies the LATEST
 * build of every project over all time. A failure from three weeks ago counts as loudly as one from
 * this morning and goes on counting for ever, which is precisely why the admin saw the same 29.2%
 * two days after two fixes aimed at it. `recentCount` is the part of each row that is still
 * happening; a large total with none recently is a fixed bug, and nothing on that panel could ever
 * have shown that before.
 *
 * **3 — "the run ended before it finished" was three endings wearing one label.** `OUTCOME_STOPPED`
 * carried the wall-clock watchdog (a real timeout), a platform-composed stop, and `abortCauseOf`
 * returning `'unknown'` — an abort raised somewhere that never went through `abortBuild`. The last
 * is a hole of the same shape as (1), and it is invisible while averaged in with a timeout.
 *
 * Every test below fails if its fix is reverted — checked by reverting each one.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyFailureReason, OTHER_REASON, NO_OUTCOME_REASON, NO_ROOT_CAUSE_REASON, OUTCOME_REASONS,
} from '../src/lib/failureReason';
import { categorizeBuildFailures, type CategorizableBuild } from '../src/server/lib/buildFailureCategory';
import { abortOutcomeFor, ABORT_OUTCOME_CODES } from '../src/server/AgentV3/abortOutcome';
import { OUTCOME_TO_CATEGORY } from '../src/server/lib/BuildRetrospectiveEngine';

/** A sentence no pattern in the classifier matches — the real shape of an "Other" row. */
const UNPATTERNED = 'The assistant finished its turn and the workspace was left as it was.';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const SEVEN_DAYS_AGO = NOW - 7 * DAY;

function failed(over: Partial<CategorizableBuild> = {}): CategorizableBuild {
  return {
    workspaceId: `w${Math.random().toString(36).slice(2, 8)}`,
    ok: false, prompt: 'build me a todo app', rootCause: UNPATTERNED,
    appSeenRunning: false, savedAt: NOW, ...over,
  };
}

describe('1 · the top row named the wrong problem', () => {
  it('🔴 no outcome code at all ⇒ "the build never recorded WHY it ended", not "Other"', () => {
    const r = classifyFailureReason(UNPATTERNED);
    expect(r.key).toBe('no-outcome-recorded');
    expect(r).toEqual(NO_OUTCOME_REASON);
    // REVERSION GUARD: restoring `return OTHER_REASON` puts an engine bug back under a label that
    // sends the reader to write regexes for a sentence no regex can help with.
    expect(r.key).not.toBe('other');
  });

  it('a build that DID record a code keeps the honest wording gap — that one really is "Other"', () => {
    // An unmapped code is the genuine vocabulary case: the engine said why, and we have no word yet.
    const r = classifyFailureReason(UNPATTERNED, 'OUTCOME_SOMETHING_NEW', 'error');
    expect(r).toEqual(OTHER_REASON);
  });

  it('the two labels say different things, so nobody can read one as the other', () => {
    expect(NO_OUTCOME_REASON.label).not.toBe(OTHER_REASON.label);
    expect(NO_OUTCOME_REASON.label.toLowerCase()).toContain('never recorded');
    expect(OTHER_REASON.label.toLowerCase()).toContain('pattern list');
  });

  it('⚠️ it does NOT swallow the cases that were already named', () => {
    // Every mapped code still wins over the text, with or without one.
    for (const [code, reason] of Object.entries(OUTCOME_REASONS)) {
      expect(classifyFailureReason(UNPATTERNED, code, 'error')).toEqual(reason);
    }
    // A grounded text pattern still names an uncoded build — no code is not automatically a hole.
    expect(classifyFailureReason('Tool call failed: edit_file: old_string not found').key).toBe('tool-call-failed');
    expect(classifyFailureReason('The build produced no files.').key).toBe('empty-build');
    // And the engine SAYING it does not know stays its own bucket, distinct from a silent record.
    expect(classifyFailureReason('Build did not succeed, but no specific error was captured.').key)
      .toBe('no-cause-recorded');
    // An empty reason is still "no root cause was recorded", unchanged.
    expect(classifyFailureReason('')).toEqual(NO_ROOT_CAUSE_REASON);
    expect(classifyFailureReason(null)).toEqual(NO_ROOT_CAUSE_REASON);
  });

  it('the panel now separates them into two rows a reader can act on differently', () => {
    const report = categorizeBuildFailures([
      failed(), failed(), failed(),                                        // silent records
      failed({ rootCause: UNPATTERNED, outcomeCode: 'OUTCOME_BRAND_NEW' }), // a real wording gap
    ]);
    const keys = report.byReason.map((r) => r.key);
    expect(keys).toContain('no-outcome-recorded');
    expect(keys).toContain('other');
    expect(report.byReason.find((r) => r.key === 'no-outcome-recorded')?.count).toBe(3);
    expect(report.byReason.find((r) => r.key === 'other')?.count).toBe(1);
  });
});

describe('2 · a number no fix can move', () => {
  it('🔴 each reason row says how many of its failures are RECENT', () => {
    const report = categorizeBuildFailures(
      [
        failed({ savedAt: NOW - 1 * DAY }),
        failed({ savedAt: NOW - 30 * DAY }),
        failed({ savedAt: NOW - 60 * DAY }),
      ],
      { recentSinceMs: SEVEN_DAYS_AGO },
    );
    const row = report.byReason.find((r) => r.key === 'no-outcome-recorded');
    expect(row?.count).toBe(3);
    // REVERSION GUARD: without the recency column this row reads "3" for ever, and a fix that
    // stopped it happening yesterday is indistinguishable from one that did nothing.
    expect(row?.recentCount).toBe(1);
  });

  it('🔒 a FIXED bug is finally visible — a big lifetime total with none this week', () => {
    const report = categorizeBuildFailures(
      Array.from({ length: 42 }, () => failed({ savedAt: NOW - 21 * DAY })),
      { recentSinceMs: SEVEN_DAYS_AGO },
    );
    expect(report.byReason[0].count).toBe(42);
    expect(report.byReason[0].recentCount).toBe(0);
  });

  it('⚠️ no window given ⇒ null, NEVER 0 — "not measured" must not read as "it stopped"', () => {
    const report = categorizeBuildFailures([failed()]);
    expect(report.byReason[0].recentCount).toBeNull();
    expect(report.recentSinceMs).toBeNull();
    // A malformed window is the same as none, never a window at the epoch (which would count
    // every record ever written as recent).
    for (const bad of [0, -1, NaN, null, undefined]) {
      const r = categorizeBuildFailures([failed()], { recentSinceMs: bad as number });
      expect(r.byReason[0].recentCount).toBeNull();
      expect(r.recentSinceMs).toBeNull();
    }
  });

  it('⚠️ an UNDATED record counts as neither recent nor old', () => {
    const report = categorizeBuildFailures(
      [failed({ savedAt: null }), failed({ savedAt: undefined }), failed({ savedAt: NOW })],
      { recentSinceMs: SEVEN_DAYS_AGO },
    );
    const row = report.byReason[0];
    expect(row.count).toBe(3);
    // Counting an undated row as recent would invent improvement it cannot prove; counting it as old
    // would invent the opposite. Only a real timestamp moves this number.
    expect(row.recentCount).toBe(1);
  });

  it('the per-domain rows carry it too, so drilling in does not lose the answer', () => {
    const report = categorizeBuildFailures(
      [failed({ savedAt: NOW - 1 * DAY }), failed({ savedAt: NOW - 40 * DAY })],
      { recentSinceMs: SEVEN_DAYS_AGO },
    );
    const everyTopReason = report.byDomain.flatMap((d) => d.topReasons);
    expect(everyTopReason.length).toBeGreaterThan(0);
    for (const r of everyTopReason) expect(r.recentCount).not.toBeNull();
    expect(everyTopReason.reduce((n, r) => n + (r.recentCount ?? 0), 0)).toBe(1);
  });

  it('🔒 the recency column changes NOTHING about who is counted as failed', () => {
    const builds = [
      failed({ savedAt: NOW }),
      failed({ savedAt: NOW - 99 * DAY }),
      { ...failed(), ok: true },
      { ...failed(), outcomeCode: 'OUTCOME_USER_STOPPED' },
    ];
    const withWindow = categorizeBuildFailures(builds, { recentSinceMs: SEVEN_DAYS_AGO });
    const without = categorizeBuildFailures(builds);
    expect(withWindow.failed).toBe(without.failed);
    expect(withWindow.ok).toBe(without.ok);
    expect(withWindow.verdictSplit).toEqual(without.verdictSplit);
    expect(withWindow.overallFailureRatePct).toBe(without.overallFailureRatePct);
    // A user's stop is still not a failure, window or no window.
    expect(withWindow.failed).toBe(2);
  });
});

describe('3 · three endings wearing one label', () => {
  it('🔴 an abort whose signal carried no cause gets its OWN code, not the wall clock\'s', () => {
    const out = abortOutcomeFor('unknown');
    expect(out?.code).toBe('OUTCOME_ABORTED_UNKNOWN');
    // REVERSION GUARD: back on OUTCOME_STOPPED, an untagged abort is indistinguishable from a build
    // that genuinely ran out of its 30 minutes — one is a hole, the other is a budget.
    expect(out?.code).not.toBe(ABORT_OUTCOME_CODES.stopped);
    expect(out?.severity).toBe('error');
  });

  it('the wall-clock stop is untouched, and so is every other cause', () => {
    // The finalizer still owns these two; a second record here would write one ending twice.
    expect(abortOutcomeFor('watchdog')).toBeNull();
    expect(abortOutcomeFor('advisory-cap')).toBeNull();
    expect(abortOutcomeFor('user-stop')?.code).toBe('OUTCOME_USER_STOPPED');
    expect(abortOutcomeFor('user-stop', { platformComposed: true })?.code).toBe('OUTCOME_STOPPED');
    expect(abortOutcomeFor('cost-cap')?.code).toBe('OUTCOME_COST_CEILING');
    expect(abortOutcomeFor('futile')?.code).toBe('OUTCOME_FUTILE');
    expect(abortOutcomeFor('deploy-drain')?.code).toBe('OUTCOME_DEPLOY_DRAIN');
    expect(abortOutcomeFor('lock-reclaimed')?.code).toBe('OUTCOME_SUPERSEDED');
    expect(abortOutcomeFor('reaper')?.code).toBe('OUTCOME_REAPED');
  });

  it('🔒 the new code is NAMED everywhere a code must be named, or it is just another "Other"', () => {
    // Both maps, or the split buys nothing: an unmapped code falls straight back through to the text.
    expect(OUTCOME_REASONS.OUTCOME_ABORTED_UNKNOWN).toBeTruthy();
    expect(OUTCOME_TO_CATEGORY.OUTCOME_ABORTED_UNKNOWN).toBeTruthy();
    expect(OUTCOME_TO_CATEGORY.OUTCOME_ABORTED_UNKNOWN.category).not.toBe('unknown');
    const named = classifyFailureReason(abortOutcomeFor('unknown')!.message, 'OUTCOME_ABORTED_UNKNOWN', 'error');
    expect(named.key).toBe('aborted-unknown');
    expect(named.label).not.toBe(OUTCOME_REASONS.OUTCOME_STOPPED.label);
  });

  it('⚠️ its message never blames the app or the user', () => {
    const m = abortOutcomeFor('unknown')!.message;
    expect(m.toLowerCase()).toContain('not attributed to the user');
    expect(m.toLowerCase()).toContain('not a fact about the app');
  });
});
