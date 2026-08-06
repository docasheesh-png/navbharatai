import { describe, it, expect } from 'vitest';
import { buildAdminReportRecord } from './AdminBuildReportStore';


/**
 * "PURA FARZI" — the admin's word for a report that told them nothing (build f323a4db, 2026-08-06).
 *
 * "Report" can be pressed at any moment, and this one was pressed 7 minutes into a build that was still
 * running. A build in flight has no verdict, no cost, no duration and no post-build checks yet, so EVERY
 * meta field came back null — which is indistinguishable from a build that FINISHED and produced
 * nothing. That is the far more alarming reading, and it is the one the admin took: the report looked
 * fabricated. A snapshot of work in progress is useful; presenting it as a finished build with no result
 * is not.
 */
describe('a report sent mid-build says so', () => {
  const ctx = { reportedAt: 1786030906044, userId: 'u1', email: 'a@b.c', name: null, workspaceId: 'ws', buildId: 'b1' };
  const running = { schema: 'navbharatai.v3.build-diagnostics/1', buildId: 'b1', prompt: 'continue', startedAt: 1786030483102, counts: { total: 52, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 }, issues: [], problems: [] } as never;

  it('flags a build with a start and no end as in flight', () => {
    const rec = buildAdminReportRecord(running, ctx);
    expect(rec.meta.inFlight).toBe(true);
    expect(rec.meta.ok).toBeNull();
  });

  it('the summary SAYS it was still running, with how long — not a null that reads as "produced nothing"', () => {
    const rec = buildAdminReportRecord(running, ctx);
    expect(rec.meta.summary).toContain('STILL RUNNING');
    expect(rec.meta.summary).toContain('7m 3s in');
    expect(rec.meta.summary).toContain('no verdict, cost, duration or post-build check yet');
  });

  it('a FINISHED build is never called in flight, and keeps its own summary', () => {
    const done = { ...running, endedAt: 1786030900000, ok: true, summary: 'Built your app.' } as never;
    const rec = buildAdminReportRecord(done, ctx);
    expect(rec.meta.inFlight).toBe(false);
    expect(rec.meta.summary).toBe('Built your app.');
    expect(rec.meta.buildMs).toBeGreaterThan(0);
  });

  it('a build that finished and genuinely FAILED is not softened into "still running"', () => {
    // The whole point is telling the two apart; blurring them the other way would be just as wrong.
    const failed = { ...running, endedAt: 1786030900000, ok: false } as never;
    const rec = buildAdminReportRecord(failed, ctx);
    expect(rec.meta.inFlight).toBe(false);
    expect(rec.meta.ok).toBe(false);
  });

  it('BOTH signals are required — a half-written report cannot claim to be finished', () => {
    // endedAt present but no verdict, or a verdict with no end: neither is a settled build.
    expect(buildAdminReportRecord({ ...running, endedAt: 1786030900000 } as never, ctx).meta.inFlight).toBe(false);
    expect(buildAdminReportRecord({ ...running, ok: true } as never, ctx).meta.inFlight).toBe(false);
  });
});

/**
 * THE SESSION, NOT THE TURN (admin, 2026-08-06). A 58-minute session reported 18.8 minutes because that
 * was the last turn; three workspace wipes appeared in no report because they belonged to earlier turns.
 */
describe('the session view reaches the admin inbox', () => {
  const ctx = { reportedAt: 1786031667042, userId: 'u1', email: 'a@b.c', name: null, workspaceId: 'ws', buildId: 'b1' };
  const base = { schema: 'navbharatai.v3.build-diagnostics/1', buildId: 'b1', prompt: 'continue', startedAt: 1786030483102, endedAt: 1786031611862, ok: true, counts: { total: 1, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 }, issues: [], problems: [] };

  it('carries the sentence and the wipe count into meta', () => {
    const rec = buildAdminReportRecord({ ...base, session: { turns: 3, elapsedMs: 3_480_000, dataLossTotal: 3, failedTurns: 1, truncated: false, line: 'This is turn 3 of this session, which has been running for 58m 0s in total.' } } as never, ctx);
    expect(rec.meta.sessionLine).toContain('58m 0s in total');
    expect(rec.meta.sessionDataLoss).toBe(3);
  });

  it('a first turn carries nothing rather than a hollow line', () => {
    const rec = buildAdminReportRecord({ ...base, session: { turns: 1, elapsedMs: 0, dataLossTotal: 0, failedTurns: 0, truncated: false, line: '' } } as never, ctx);
    expect(rec.meta.sessionLine).toBeNull();
    expect(rec.meta.sessionDataLoss).toBe(0);
  });

  it('an older report with no session block still stores cleanly', () => {
    const rec = buildAdminReportRecord(base as never, ctx);
    expect(rec.meta.sessionLine).toBeNull();
    expect(rec.meta.sessionDataLoss).toBeNull();
  });
});
