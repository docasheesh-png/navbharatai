import { settledFailure } from '../lib/failedReportEligibility';
import type { Firestore } from 'firebase-admin/firestore';

/** Singleton counter for permanent failed-report numbers. Never age-deleted. */
export const FAILED_REPORT_NUMBER_COLLECTION = 'admin_failed_report_numbers';
export const FAILED_REPORT_NUMBER_DOC = 'counter';

type DiagnosticsSnapshot = { startedAt: number; endedAt?: number; ok?: boolean; buildId?: string; workspaceId?: string };
const knownId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
function terminalReport(value: DiagnosticsSnapshot | undefined): boolean {
  return !!value && validTime(value.startedAt) && typeof value.endedAt === 'number' &&
    Number.isFinite(value.endedAt) && value.endedAt >= value.startedAt;
}

/** The two latest pointers share the same monotonic report boundary as retained history. */
export async function commitLatestDiagnostics(
  db: Firestore,
  collectionName: 'workspace_diagnostics_v3' | 'user_diagnostics_v3',
  id: string,
  report: DiagnosticsSnapshot,
  savedAt: number,
): Promise<void> {
  const ref = db.collection(collectionName).doc(id);
  await db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    const current = previous?.report as DiagnosticsSnapshot | undefined;
    if (validTime(current?.startedAt) && (!validTime(report.startedAt) || current.startedAt > report.startedAt)) return;
    const distinctIdentity = !!current && (
      (knownId(current.buildId) && knownId(report.buildId) && current.buildId !== report.buildId) ||
      (knownId(current.workspaceId) && knownId(report.workspaceId) && current.workspaceId !== report.workspaceId)
    );
    if (current?.startedAt === report.startedAt) {
      // Equal timestamps cannot establish recency between distinct runs. A deterministic
      // identity tie-break avoids arrival-order rollback without mistaking another app
      // for progress on this run. Legacy records lacking distinguishing IDs keep the
      // existing timestamp identity; collision-safe historical IDs are a separate design.
      const key = (r: DiagnosticsSnapshot) => JSON.stringify([r.workspaceId ?? '', r.buildId ?? '']);
      if (distinctIdentity && key(report) < key(current)) return;
      if (!distinctIdentity && terminalReport(current) && !terminalReport(report)) return;
    }
    const metadata = { ...previous };
    // A latest pointer can move to a different run; run-local IDs must not follow it.
    if (current?.startedAt !== report.startedAt || distinctIdentity) {
      delete metadata.reportNumber;
      delete metadata.numberedAt;
      delete metadata.numberingIssue;
    }
    // Replace report as one value (merge:true would retain stale nested report fields).
    tx.set(ref, { ...metadata, report, savedAt });
  });
}

function validReportNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * A Firestore subcollection does not create its parent document. Commit a minimal
 * discovery marker with every history write, so readers enumerating workspace
 * documents can find the report even if the independent latest-report write fails.
 * The merge never replaces the latest report, its timestamp, or other metadata.
 *
 * Settled failures also receive a permanent reportNumber = max+1 (never renumbered).
 * Re-saving the same history id keeps the existing number. In-progress and successful
 * builds are not numbered. A missing or invalid counter preserves the report without
 * allocating a number; only a separately reviewed initialization may establish the counter.
 */
export async function commitDiagnosticsHistory(
  db: Firestore,
  workspaceId: string,
  report: { startedAt: number; endedAt?: number; ok?: boolean },
  savedAt: number,
  inProgress?: boolean,
): Promise<void> {
  const root = db.collection('workspace_diagnostics_v3').doc(workspaceId);
  const historyRef = root.collection('history').doc(String(report.startedAt));
  const progressFields = inProgress === undefined ? {} : { inProgress };

  const counterRef = db.collection(FAILED_REPORT_NUMBER_COLLECTION).doc(FAILED_REPORT_NUMBER_DOC);
  await db.runTransaction(async (tx) => {
    const histSnap = await tx.get(historyRef);
    const previous = histSnap.data();
    const previousReport = previous?.report;
    // An independently retried progress flush must never erase an already settled report.
    if (terminalReport(previousReport) && (!terminalReport(report) || inProgress === true)) return;

    const metadata: Record<string, unknown> = {};
    const existing = previous?.reportNumber;
    if (validReportNumber(existing)) {
      metadata.reportNumber = existing;
      metadata.numberedAt = typeof previous?.numberedAt === 'number' && Number.isFinite(previous.numberedAt) && previous.numberedAt > 0
        ? previous.numberedAt : savedAt;
    }
    if (!inProgress && settledFailure(report)) {
      const counterSnap = await tx.get(counterRef);
      const counter = counterSnap.data();
      const next = counter?.nextNumber;
      let issue: string | undefined;
      if (!counterSnap.exists) issue = 'counter_uninitialized';
      else if (counter?.numberingBlocked === true || !validReportNumber(next)) issue = 'counter_invalid';
      else if (validReportNumber(existing) && next <= existing) issue = 'counter_inconsistent';
      else if (next >= Number.MAX_SAFE_INTEGER) issue = 'counter_exhausted';
      if (issue) {
        // Numbering failure cannot discard the forensic report or silently reuse an ID.
        metadata.numberingIssue = issue;
        if (issue === 'counter_inconsistent') tx.set(counterRef, { numberingBlocked: true }, { merge: true });
      } else if (!validReportNumber(existing)) {
        metadata.reportNumber = next;
        metadata.numberedAt = savedAt;
        tx.set(counterRef, { nextNumber: next + 1, updatedAt: savedAt }, { merge: true });
      }
    }
    tx.set(root, { historyAvailable: true }, { merge: true });
    tx.set(historyRef, { report, savedAt, ...metadata, ...progressFields });
  });
}
