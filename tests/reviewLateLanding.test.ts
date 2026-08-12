import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reviewGraceMs, reviewerBudgetMs } from '../src/server/AgentV3/PipelineDepth';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. The reviewer diagnosed the app correctly and the
 * platform threw the diagnosis away.
 *
 * The report's own timeline, to the millisecond:
 *
 *     …696475  REVIEW_INCOMPLETE   Post-build review timed out after 114000ms on 26 files
 *     …697977  AGENT_STEP          "## Code Review Report
 *                                    ### [CRITICAL] (confidence: high) Missing CSS Styling —
 *                                    App will look broken … classes not defined anywhere"
 *     …697978  EVENT               • agent_done (reviewer)
 *
 * **1,502 ms.** That is the entire distance between "we gave up" and "here is the answer". Because
 * `raceTimeout` discards the loser, `review` became null and every downstream consumer saw a build with
 * no findings: nothing was recorded, the C9 auto-fix never fired, the verdict was never corrected — and
 * the user was told the review "didn't finish" while a working diagnosis sat in the log.
 *
 * The budget is a GUESS about how long a review takes. Every guess has a cliff, and some review will
 * always land just past it — raising BASE only moves the cliff. The thing that was actually wrong is
 * that finished, already-paid-for work (26 files of the user's tokens) was discarded because a timer
 * fired first.
 */

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the 1.5 seconds that cost the user a working app', () => {
  it('the report\'s exact budget still produces a grace that would have caught it', () => {
    // 26 files, 26-file project → BASE 90s + 6×4s = the 114,000ms the report names.
    const budget = reviewerBudgetMs(26, Infinity, 26);
    expect(budget).toBe(114_000);
    // 1,502ms late. Any grace above that recovers the [CRITICAL]; this one is ~19× the margin.
    expect(reviewGraceMs(budget, Infinity)).toBeGreaterThan(1_502);
  });

  it('the grace is a FRACTION of the budget, not another fixed cliff', () => {
    expect(reviewGraceMs(40_000, Infinity)).toBe(10_000);   // floor
    expect(reviewGraceMs(114_000, Infinity)).toBe(28_500);  // 25%
    expect(reviewGraceMs(210_000, Infinity)).toBe(30_000);  // ceiling
  });

  it('a hung reviewer can never spend the build\'s remaining wall clock', () => {
    /**
     * THE LINE THAT KEEPS THIS A FIX AND NOT A NEW BUG. A review that will never land must not be
     * able to push a finished app past its cap — that trade would swap one broken outcome for
     * another. The grace respects the SAME 60s safety margin the budget does.
     */
    expect(reviewGraceMs(114_000, 90_000)).toBe(28_500);   // 90s left − 60s margin = 30s of room, so the full 25%
    expect(reviewGraceMs(210_000, 80_000)).toBe(20_000);   // 20s of room CLAMPS the 30s ceiling down
    expect(reviewGraceMs(114_000, 65_000)).toBe(0);        // 5s of room is below the floor → none
    expect(reviewGraceMs(114_000, 60_000)).toBe(0);
    expect(reviewGraceMs(114_000, 0)).toBe(0);
    expect(reviewGraceMs(114_000, -5_000)).toBe(0);
  });

  it('takes the WHOLE grace or none of it', () => {
    // Waiting 3s for a review that needs 10 buys nothing and still costs the build 3s.
    expect(reviewGraceMs(114_000, 69_000)).toBe(0);
    expect(reviewGraceMs(114_000, 70_000)).toBe(10_000);
  });

  it('junk in gives zero, never a wait', () => {
    for (const b of [0, -1, NaN, Infinity]) expect(reviewGraceMs(b as number, Infinity)).toBe(0);
  });
});

describe('WIRING — the timeout stops us waiting, not looking', () => {
  it('the review promise is held in its own binding, so it survives the timeout', () => {
    // The whole defect: the promise used to be an inline expression argument, so when raceTimeout
    // rejected there was nothing left to collect from.
    expect(route).toContain('const reviewPromise = reviewBuild({');
    expect(route).toContain("review = await raceTimeout(reviewPromise, reviewBudget, 'post-build-review')");
  });

  it('the grace re-races the SAME promise — it never spawns a second reviewer', () => {
    // A second reviewer would double the user's bill for one review, and two reviewers reasoning
    // about one workspace is exactly the concurrency the C9 retry rule already forbids.
    expect(route).toContain("raceTimeout(reviewPromise, graceMs, 'post-build-review-grace')");
    expect((route.match(/reviewBuild\(\{/g) || []).length).toBe(1);
  });

  it('the grace runs ONLY after a timeout, never after a thrown reviewer', () => {
    // A reviewer that threw has already produced its answer; waiting on a settled rejection is pure
    // dead time.
    expect(route).toContain('const graceMs = timedOut');
    const at = route.indexOf('const graceMs = timedOut');
    expect(route.slice(at, at + 400)).toContain(': 0;');
  });

  it('a late review is honestly labelled — not passed off as an on-time one', () => {
    expect(route).toContain("code: 'REVIEW_LATE'");
    const at = route.indexOf("code: 'REVIEW_LATE'");
    expect(route.slice(at, at + 240)).toMatch(/kept, not discarded/);
  });

  it('a review that truly never lands is no longer recorded as "resolved"', () => {
    /**
     * HONESTY (rule 5). REVIEW_INCOMPLETE carried `autoResolved: true` — a literal claim that the
     * problem had been handled. Nothing was handled: the completeness net was DOWN for that build,
     * and the health card showed no trace of it.
     */
    const at = route.indexOf("code: 'REVIEW_INCOMPLETE'");
    expect(at).toBeGreaterThan(-1);
    const rec = route.slice(route.lastIndexOf('buildDiag.record', at), at + 400);
    expect(rec).toContain("severity: 'warning'");
    expect(rec).toContain('autoResolved: false');
    expect(rec).toMatch(/NOT available for this build/);
  });

  it('it stays a WARNING — an unfinished review must never block a working app', () => {
    // buildHealthFromDiagnostics gates `ready` on ERRORS only. Our own inability to review is a
    // caveat about US, not evidence of a defect in the user's app — blocking on it would be the
    // #2267 mistake (failing a good build over an ambiguity in our own tooling).
    const at = route.indexOf("code: 'REVIEW_INCOMPLETE'");
    expect(route.slice(route.lastIndexOf('buildDiag.record', at), at)).not.toContain("severity: 'error'");
  });

  it('everything downstream of the review is unchanged — one path, not two', () => {
    // A late review must feed recordReview, the C9 auto-fix and the honesty holder through the SAME
    // code an on-time review does. A parallel "late" path would drift from the primary one.
    const at = route.indexOf("review = await raceTimeout(reviewPromise, reviewBudget");
    expect(at).toBeGreaterThan(-1);
    // Asserted by ORDER rather than a character window: each consumer must sit after the race and
    // read the one `review` binding, whichever pass filled it.
    for (const consumer of [
      'const reviewText = review ? formatReview(review) : ',
      'buildDiag.recordReview(reviewText)',
      'if (criticals.length > 0 && !isImportTurn && !greenStopReview) reviewCriticalsUnresolved = criticals.slice();',
      'const criticals = (review?.issues ?? []).filter((i) => i.severity === ',
    ]) {
      expect(route.indexOf(consumer), consumer).toBeGreaterThan(at);
    }
  });
});
