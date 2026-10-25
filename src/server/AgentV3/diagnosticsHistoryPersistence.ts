import type { Firestore } from 'firebase-admin/firestore';

/** Singleton counter for permanent failed-report numbers. Never age-deleted. */
export const FAILED_REPORT_NUMBER_COLLECTION = 'admin_failed_report_numbers';
export const FAILED_REPORT_NUMBER_DOC = 'counter';

function isSettledFailure(report: { startedAt: number } & Record<string, unknown>, inProgress?: boolean): boolean {
  if (inProgress) return false;
  const endedAt = report.endedAt;
  return report.ok === false && typeof report.startedAt === 'number' && Number.isFinite(report.startedAt) && report.startedAt > 0 &&
    typeof endedAt === 'number' && Number.isFinite(endedAt) && endedAt >= report.startedAt;
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
 * builds are not numbered.
 */
export async function commitDiagnosticsHistory(
  db: Firestore,
  workspaceId: string,
  report: { startedAt: number } & Record<string, unknown>,
  savedAt: number,
  inProgress?: boolean,
): Promise<void> {
  const root = db.collection('workspace_diagnostics_v3').doc(workspaceId);
  const historyRef = root.collection('history').doc(String(report.startedAt));
  const progressFields = inProgress === undefined ? {} : { inProgress };

  if (!isSettledFailure(report, inProgress)) {
    const batch = db.batch();
    batch.set(root, { historyAvailable: true }, { merge: true });
    batch.set(historyRef, { report, savedAt, ...progressFields });
    await batch.commit();
    return;
  }

  const counterRef = db.collection(FAILED_REPORT_NUMBER_COLLECTION).doc(FAILED_REPORT_NUMBER_DOC);
  await db.runTransaction(async (tx) => {
    const [histSnap, counterSnap] = await Promise.all([tx.get(historyRef), tx.get(counterRef)]);
    const existing = histSnap.data()?.reportNumber;
    let reportNumber: number;
    let numberedAt: number;
    if (validReportNumber(existing)) {
      reportNumber = existing;
      numberedAt = validReportNumber(histSnap.data()?.numberedAt) ? histSnap.data()!.numberedAt as number : savedAt;
    } else {
      const rawNext = counterSnap.data()?.nextNumber;
      const next = validReportNumber(rawNext) ? rawNext : 1;
      reportNumber = next;
      numberedAt = savedAt;
      tx.set(counterRef, { nextNumber: next + 1, updatedAt: savedAt }, { merge: true });
    }
    tx.set(root, { historyAvailable: true }, { merge: true });
    tx.set(historyRef, { report, savedAt, reportNumber, numberedAt, ...progressFields });
  });
}
