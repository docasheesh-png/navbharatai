import type { Firestore } from 'firebase-admin/firestore';

/**
 * A Firestore subcollection does not create its parent document. Commit a minimal
 * discovery marker with every history write, so readers enumerating workspace
 * documents can find the report even if the independent latest-report write fails.
 * The merge never replaces the latest report, its timestamp, or other metadata.
 */
export async function commitDiagnosticsHistory(
  db: Firestore,
  workspaceId: string,
  report: { startedAt: number },
  savedAt: number,
  inProgress?: boolean,
): Promise<void> {
  const root = db.collection('workspace_diagnostics_v3').doc(workspaceId);
  const batch = db.batch();
  batch.set(root, { historyAvailable: true }, { merge: true });
  batch.set(root.collection('history').doc(String(report.startedAt)), {
    report,
    savedAt,
    ...(inProgress === undefined ? {} : { inProgress }),
  });
  await batch.commit();
}
