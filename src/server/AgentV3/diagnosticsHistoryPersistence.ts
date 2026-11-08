import type { Firestore } from 'firebase-admin/firestore';
import { applyRegistryPlan, planRegistryWrite, readRegistryForWrite } from '../lib/buildReportRegistry';

/** RETIRED (2026-11-02): the old failures-only counter. Nothing ever created it, so it numbered
 *  nothing; it is kept classified so a document there, if one ever appeared, is never reused. */
export const FAILED_REPORT_NUMBER_COLLECTION = 'admin_failed_report_numbers';

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
 * EVERY report — of every outcome, from its first save — is numbered in the same transaction
 * through the build report registry (`buildReportRegistry.ts`): one permanent number per report,
 * taken once from one counter, never renumbered. Re-saving the same report keeps its number and
 * only updates its outcome. Until the counter is ready (the one-time backfill of older reports),
 * nothing is allocated and the backfill numbers the report instead.
 *
 * The old failures-only `reportNumber` allocator (whose counter nothing ever created) is retired.
 * A legacy `reportNumber` already on a document is carried forward untouched, never reissued.
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

  await db.runTransaction(async (tx) => {
    const histSnap = await tx.get(historyRef);
    const previous = histSnap.data();
    const previousReport = previous?.report;
    // An independently retried progress flush must never erase an already settled report.
    if (terminalReport(previousReport) && (!terminalReport(report) || inProgress === true)) return;
    const registry = validTime(report.startedAt) ? await readRegistryForWrite(tx, db, workspaceId, report.startedAt) : null;

    const metadata: Record<string, unknown> = {};
    const existing = previous?.reportNumber;
    if (validReportNumber(existing)) {
      metadata.reportNumber = existing;
      if (typeof previous?.numberedAt === 'number' && Number.isFinite(previous.numberedAt) && previous.numberedAt > 0) metadata.numberedAt = previous.numberedAt;
    }
    if (registry) {
      applyRegistryPlan(tx, db, workspaceId, report.startedAt, planRegistryWrite(registry.existing, registry.counter, {
        workspaceId, historyId: String(report.startedAt), report, inProgress, savedAt,
      }));
    }
    tx.set(root, { historyAvailable: true }, { merge: true });
    tx.set(historyRef, { report, savedAt, ...metadata, ...progressFields });
  });
}
