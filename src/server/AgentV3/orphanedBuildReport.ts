// A BUILD THAT DIES ALWAYS GETS AN HONEST END ON ITS REPORT (failedbr #2497, 2026-11-22).
//
// 🔴 THE DEFECT. Build #2497 ("ek bahut bada map par bubg jaisa game banao!!") laid down the game kit, made one model
// call, recorded its one-minute heartbeat — and nothing after. Its server stopped without running any JS (no catch,
// no finally, no deploy drain), so the only saves it ever made were the throttled in-progress ones. Two minutes later
// a second build was admitted into the same workspace, which is only possible once the first build's lease had lapsed
// — the platform's own proof that #2497 was gone. Yet #2497's report stayed "unfinished" with no end, forever, and
// read in the report list as "This build was STILL RUNNING when this report was taken".
//
// 🔑 THE INVARIANT THAT SETTLES IT. A build only starts after it holds the workspace lease (workspaceBuildLease.ts),
// and a lease is only claimable when no build is heartbeating on it. So the moment a new build is admitted, every
// OLDER in-progress report of that workspace belongs to a build that is no longer running anywhere. Settling them
// then needs no timer, no sweep and no guess: the admission itself is the evidence.
//
// ⚠️ A late save from a build that was only presumed dead (a zombie whose final save lands afterwards) still wins: a
// settled report accepts a terminal overwrite, and refuses only a further in-progress one (diagnosticsHistoryPersistence).

/** The issue code recorded on a report whose build ended without recording its own end. */
export const BUILD_ENDED_UNRECORDED_CODE = 'BUILD_ENDED_UNRECORDED';

interface IssueLike { ts?: unknown; code?: unknown; severity?: unknown }
interface ReportLike {
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  issues?: readonly IssueLike[];
  problems?: readonly IssueLike[];
  counts?: { total?: number; errors?: number; unresolved?: number };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The last moment this report proves the build was alive: its newest recorded issue, or its start. PURE. */
export function lastSignOfLife(report: ReportLike): number {
  let last = finite(report.startedAt) ? report.startedAt : 0;
  for (const issue of Array.isArray(report.issues) ? report.issues : []) {
    if (issue && finite(issue.ts) && issue.ts > last) last = issue.ts;
  }
  return last;
}

/** Should this stored report be settled now that a newer build holds its workspace? PURE. */
export function isOrphanedReport(report: ReportLike | null | undefined, newBuildStartedAt: number): boolean {
  if (!report || !finite(report.startedAt) || report.startedAt <= 0) return false;
  if (finite(report.endedAt) && report.endedAt >= report.startedAt) return false;
  return finite(newBuildStartedAt) && report.startedAt < newBuildStartedAt;
}

/**
 * The same report, ended honestly: failed, ended at its last sign of life, with one error that says what is known
 * (the build stopped answering at that moment; a later build found it gone) and nothing that is not. PURE.
 */
export function settleOrphanedReport<T extends ReportLike>(report: T, opts: { newBuildStartedAt: number }): T {
  const endedAt = Math.max(report.startedAt, lastSignOfLife(report));
  const silentFor = Math.max(0, Math.round((opts.newBuildStartedAt - endedAt) / 1000));
  const message = 'This build stopped without recording an end — the server running it was lost (no work was recorded after '
    + `${Math.round((endedAt - report.startedAt) / 1000)} s). It was found when the next build for this app started, ${silentFor} s later. `
    + 'Nothing after that moment ran, and the build was not finished.';
  const issue = { ts: endedAt, phase: 'build', severity: 'error', code: BUILD_ENDED_UNRECORDED_CODE, autoResolved: false, message };
  const counts = { ...(report.counts ?? {}) };
  counts.total = (finite(counts.total) ? counts.total : 0) + 1;
  counts.errors = (finite(counts.errors) ? counts.errors : 0) + 1;
  counts.unresolved = (finite(counts.unresolved) ? counts.unresolved : 0) + 1;
  return {
    ...report,
    endedAt,
    ok: false,
    summary: message,
    rootCause: message,
    issues: [...(Array.isArray(report.issues) ? report.issues : []), issue],
    problems: [...(Array.isArray(report.problems) ? report.problems : []), issue],
    counts,
  };
}
