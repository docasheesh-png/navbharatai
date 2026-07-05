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
import { capProblems, type BuildDiagnosticsReport } from './BuildDiagnostics';

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
  const trimmedIssues = (report.issues ?? []).slice(-500);
  return {
    ...report,
    issues: trimmedIssues,
    // RECOMPUTE from the TRIMMED issues (not a pass-through of report.problems) so `problems` can
    // never reference an entry that just fell out of the stored `issues` timeline, and can never
    // itself bypass this function's byte-budget trimming with an unbounded list of its own.
    problems: capProblems(trimmedIssues.filter((i) => i.severity !== 'info')),
    commands: lastN(report.commands, 40)?.map((c) => ({ ...c, stdout: cap(c.stdout, 1500) ?? '', stderr: cap(c.stderr, 1500) ?? '' })),
    llmCalls: lastN(report.llmCalls, 40)?.map((c) => ({ ...c, promptPreview: cap(c.promptPreview, 800), responsePreview: cap(c.responsePreview, 800) })),
    errors: lastN(report.errors, 50)?.map((e) => ({ ...e, message: cap(e.message, 2000) ?? '', stack: cap(e.stack, 1500) })),
    // generatedFiles already capped at 20 × 6000 chars by BuildDiagnostics — kept as-is (the bug evidence).
    generatedFiles: report.generatedFiles,
  };
}

/** How many issue-timeline lines to keep in the report EMBEDDED in the durable conversation record.
 *  Tighter than storage: the embedded copy rides inside the conversation doc (saved in the SAME place
 *  as the chat), so it must stay small — the heavy forensic channels remain in the separate
 *  workspace_diagnostics_v3 doc for the deep "AI Diagnosis Bundle" download. */
const EMBED_MAX_ISSUES = 120;

/**
 * A COMPACT build report for embedding INSIDE the durable conversation record, so the "Build report"
 * is saved in the same place as the chat and ALWAYS returns on reopen — never a separate best-effort
 * doc that can 404 after a long / killed build (admin report, 2026-07-05: "build report save nahi
 * huyi … hamesa ke liye wahin save honi chahiye").
 *
 * Keeps the user-facing essentials — readiness/root-cause/summary/counts/problems + a bounded issues
 * tail + a few preview errors + the reviewer's findings — and DROPS the heavy forensic channels
 * (sandbox command logs, LLM I/O, full error stacks, generated-file bodies), which stay in the
 * workspace-keyed forensic report. Pure + exported + unit-tested.
 */
export function compactReportForRecord(report: BuildDiagnosticsReport): BuildDiagnosticsReport {
  const issues = (report.issues ?? []).slice(-EMBED_MAX_ISSUES).map((i) => ({ ...i, message: cap(i.message, 400) ?? '' }));
  return {
    schema: report.schema,
    sessionId: report.sessionId,
    workspaceId: report.workspaceId,
    framework: report.framework,
    model: report.model,
    prompt: cap(report.prompt, 2000),
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    ok: report.ok,
    summary: cap(report.summary, 4000),
    rootCause: cap(report.rootCause, 2000),
    counts: report.counts,
    issues,
    // RECOMPUTE from the trimmed issues so `problems` can never reference an entry that fell out.
    problems: capProblems(issues.filter((i) => i.severity !== 'info')),
    previewErrors: lastN(report.previewErrors, 10),
    providerDelivery: report.providerDelivery,
    review: cap(report.review, 4000),
    // Heavy forensic channels deliberately omitted — they stay in workspace_diagnostics_v3 (retrievable
    // by workspaceId) for the deep bundle; the record only needs the always-available essential report.
    commands: undefined,
    llmCalls: undefined,
    errors: undefined,
    generatedFiles: undefined,
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
      const furtherTrimmedIssues = (stored.issues ?? []).slice(-200);
      stored = {
        ...stored,
        commands: undefined,
        llmCalls: undefined,
        issues: furtherTrimmedIssues,
        problems: capProblems(furtherTrimmedIssues.filter((i) => i.severity !== 'info')),
      };
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

// ── Durable per-USER "latest report" (P-REPORT.5 — "the report vanishes on every message/reload") ──
//
// saveDiagnostics()/loadDiagnostics() key ONLY by workspaceId. The only per-USER fallback in the route
// was the IN-MEMORY `lastDiagnostics` map — which is wiped on every Cloud Run cold start (min-instances
// =0) AND is per-instance. Combined with "a fresh session mints a new workspaceId", the client would
// fetch a workspaceId that has no saved report and fall through to that empty in-memory map → the
// "No build report yet" the user saw right after a real build. This durable per-user doc is the fix:
// the user's LAST settled build report is always retrievable by userId alone, across cold starts,
// instance rotation, reloads and new sessions — until the next build overwrites it. Best-effort.
const USER_COLLECTION = 'user_diagnostics_v3';

/**
 * The per-user durable-report doc id, or null when there is NO real user identity.
 *
 * PRIVACY: this must NEVER collapse anonymous callers into a single shared `'anon'` doc. It used to
 * (`userId || 'anon'`), so every anonymous build overwrote one global doc and any other anonymous
 * caller reading the per-user fallback got the LAST anon build's full report — its generated SOURCE,
 * errors and command output. Anonymous sessions are still served their own report via the
 * unguessable workspace-keyed path (`agentv3-anon-{sessionId}`); the per-user durable fallback simply
 * does not apply to them. Pure + unit-testable.
 */
export function perUserDiagnosticsDocId(userId: string | null | undefined): string | null {
  const id = (userId ?? '').trim();
  return id ? id : null;
}

/** Persist the user's LATEST settled build report, retrievable by userId alone. Best-effort. */
export async function saveLatestForUser(userId: string | null, report: BuildDiagnosticsReport): Promise<void> {
  const db = getDb();
  const uid = perUserDiagnosticsDocId(userId);
  if (!db || !report || !uid) return; // no real user → no shared 'anon' bucket (privacy)
  try {
    let stored = trimReportForStorage(report);
    if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > MAX_DOC_BYTES) {
      const furtherTrimmedIssues = (stored.issues ?? []).slice(-200);
      stored = { ...stored, commands: undefined, llmCalls: undefined, issues: furtherTrimmedIssues, problems: capProblems(furtherTrimmedIssues.filter((i) => i.severity !== 'info')) };
    }
    await db.collection(USER_COLLECTION).doc(uid).set({ report: stored, savedAt: Date.now() }, { merge: false });
  } catch {
    /* best-effort — never blocks or breaks a build */
  }
}

/** Load the user's LATEST settled build report (durable, cold-start-proof), or null. Never throws. */
export async function loadLatestForUser(userId: string | null): Promise<BuildDiagnosticsReport | null> {
  const db = getDb();
  const uid = perUserDiagnosticsDocId(userId);
  if (!db || !uid) return null; // no real user → never read the shared 'anon' bucket (would leak another anon's report)
  try {
    const doc = await db.collection(USER_COLLECTION).doc(uid).get();
    if (!doc.exists) return null;
    return (doc.data()?.report as BuildDiagnosticsReport) ?? null;
  } catch {
    return null;
  }
}

// ── History (P-REPORT.4 — "the report disappears the moment the next build starts") ────────────
//
// saveDiagnostics()/loadDiagnostics() above keep only ONE doc per workspace: the LATEST settled
// build's report. As soon as the next message's build also settles — even a tiny one that produced
// almost nothing — it fully overwrites that doc, and the previous (possibly much richer) report is
// gone with no way back. This subcollection keeps a bounded history of every SETTLED build's report
// so a small/quick build never destroys access to a prior, more useful one.

const HISTORY_SUBCOLLECTION = 'history';
/** How many past builds' reports to keep visible in the history list. */
const MAX_HISTORY_ITEMS = 20;

/** Lightweight metadata for one history entry — no full payload, so listing stays cheap. */
export interface DiagnosticsHistoryEntry {
  id: string;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  summary?: string;
  rootCause?: string;
  counts: BuildDiagnosticsReport['counts'];
}

/**
 * Persist a SETTLED build's report into the workspace's bounded history. No-op for a report that
 * hasn't actually finished yet (`endedAt` unset) — only a build that genuinely ended gets a history
 * entry, so an in-progress build never pollutes the list. Best-effort — never throws.
 */
export async function saveDiagnosticsHistory(workspaceId: string, report: BuildDiagnosticsReport): Promise<void> {
  const db = getDb();
  if (!db || !workspaceId || !report || report.endedAt === undefined) return;
  try {
    let stored = trimReportForStorage(report);
    // Same final safety net as saveDiagnostics — a history entry that fails to write because it's
    // over budget is worse than a lighter one that succeeds.
    if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > MAX_DOC_BYTES) {
      const furtherTrimmedIssues = (stored.issues ?? []).slice(-200);
      stored = {
        ...stored,
        commands: undefined,
        llmCalls: undefined,
        issues: furtherTrimmedIssues,
        problems: capProblems(furtherTrimmedIssues.filter((i) => i.severity !== 'info')),
      };
    }
    await db
      .collection(COLLECTION)
      .doc(workspaceId)
      .collection(HISTORY_SUBCOLLECTION)
      .doc(String(report.startedAt))
      .set({ report: stored, savedAt: Date.now() }, { merge: false });
  } catch {
    /* best-effort — history is a convenience, never blocks or breaks a build */
  }
}

/**
 * List a workspace's past builds, most-recent-first, metadata only (cheap for a picker/list UI).
 * Ordered by document id (the stringified `startedAt` epoch-ms — lexicographic order matches numeric
 * order for same-length epoch-ms strings) so no composite index on a nested field is ever needed.
 * Never throws — returns [] on any failure or when nothing has been recorded yet.
 */
export async function listDiagnosticsHistory(workspaceId: string, limit = MAX_HISTORY_ITEMS): Promise<DiagnosticsHistoryEntry[]> {
  const db = getDb();
  if (!db || !workspaceId) return [];
  try {
    const snap = await db
      .collection(COLLECTION)
      .doc(workspaceId)
      .collection(HISTORY_SUBCOLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
      .limit(Math.max(0, limit))
      .get();
    return snap.docs.map((d) => {
      const r = d.data().report as BuildDiagnosticsReport;
      return { id: d.id, startedAt: r.startedAt, endedAt: r.endedAt, ok: r.ok, summary: r.summary, rootCause: r.rootCause, counts: r.counts };
    });
  } catch {
    return [];
  }
}

/** Load ONE specific historical report by id (an entry's `id` from listDiagnosticsHistory). Null on any failure/absence. */
export async function getDiagnosticsHistoryItem(workspaceId: string, id: string): Promise<BuildDiagnosticsReport | null> {
  const db = getDb();
  if (!db || !workspaceId || !id) return null;
  try {
    const doc = await db.collection(COLLECTION).doc(workspaceId).collection(HISTORY_SUBCOLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return (doc.data()?.report as BuildDiagnosticsReport) ?? null;
  } catch {
    return null;
  }
}
