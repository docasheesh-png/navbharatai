// AgentV3 — Durable BUILD DIAGNOSTICS persistence (so the "Build report" is never empty).
//
// The diagnostics report was held ONLY in an in-memory Map keyed by userId (lastDiagnostics). On
// Cloud Run that breaks the download: the build runs on instance A, but the "Build report" GET
// load-balances to instance B (or the user reloaded, losing the client copy) → empty report. This
// store persists the final report to Firestore keyed by workspaceId so the download survives
// instance rotation and page reloads.
//
// Pattern mirrors WorkspaceFileStore: firebase-admin, VITEST-skip, best-effort, never throws.

import * as admin from 'firebase-admin';
import { firestoreDatabaseId } from '../lib/firestoreDb';
import type { BuildDiagnosticsReport } from './BuildDiagnostics';

const COLLECTION = 'workspace_diagnostics_v3';
/** Firestore's hard per-document limit is 1 MB; stay well under it after trimming. */
const MAX_DOC_BYTES = 900 * 1024;

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = admin.firestore();
    _db.settings({ databaseId: firestoreDatabaseId() });
    return _db;
  } catch {
    return null;
  }
}

/** Keep the last `n` items of an array (newest), or the whole array if shorter. */
function lastN<T>(arr: T[] | undefined, n: number): T[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.length <= n ? arr : arr.slice(arr.length - n);
}
function cap(s: string | undefined, n: number): string | undefined {
  if (s == null) return s;
  return s.length <= n ? s : `${s.slice(0, n)}…[truncated]`;
}

/**
 * Bound a report so its JSON fits comfortably under the 1 MB Firestore doc limit. Deterministic
 * caps (no size-measuring loop): trims the heavy channels (issues / commands / llm previews /
 * errors) to safe sizes while keeping the most recent, most useful detail. Pure + exported + tested.
 */
export function trimReportForStorage(report: BuildDiagnosticsReport): BuildDiagnosticsReport {
  return {
    ...report,
    issues: (report.issues ?? []).slice(-500),
    commands: lastN(report.commands, 40)?.map((c) => ({ ...c, stdout: cap(c.stdout, 1500) ?? '', stderr: cap(c.stderr, 1500) ?? '' })),
    llmCalls: lastN(report.llmCalls, 40)?.map((c) => ({ ...c, promptPreview: cap(c.promptPreview, 800), responsePreview: cap(c.responsePreview, 800) })),
    errors: lastN(report.errors, 50)?.map((e) => ({ ...e, message: cap(e.message, 2000) ?? '', stack: cap(e.stack, 1500) })),
    // generatedFiles already capped at 20 × 6000 chars by BuildDiagnostics — kept as-is (the bug evidence).
    generatedFiles: report.generatedFiles,
  };
}

/** Persist a workspace's final diagnostics report. Best-effort — never throws. */
export async function saveDiagnostics(workspaceId: string, report: BuildDiagnosticsReport): Promise<void> {
  const db = getDb();
  if (!db || !workspaceId || !report) return;
  try {
    let stored = trimReportForStorage(report);
    // Final safety net: if it is still somehow over the limit, drop the heaviest channels entirely
    // rather than fail the write (an empty-channel report still beats no report at all).
    if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > MAX_DOC_BYTES) {
      stored = { ...stored, commands: undefined, llmCalls: undefined, issues: (stored.issues ?? []).slice(-200) };
    }
    await db.collection(COLLECTION).doc(workspaceId).set({ report: stored, savedAt: Date.now() }, { merge: false });
  } catch {
    /* best-effort — a persistence failure never blocks or breaks a build */
  }
}

/** Load a workspace's last persisted diagnostics report, or null when absent. Never throws. */
export async function loadDiagnostics(workspaceId: string): Promise<BuildDiagnosticsReport | null> {
  const db = getDb();
  if (!db || !workspaceId) return null;
  try {
    const doc = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return (data?.report as BuildDiagnosticsReport) ?? null;
  } catch {
    return null;
  }
}
