// Admin-only build-report inbox (admin 2026-07-29).
//
// The user no longer downloads/copies their build report — a single "Report" button submits it to
// the ADMIN. This store is that admin inbox: when a user clicks Report, the server snapshots the
// resolved build report + light metadata into the `admin_build_reports` collection, retrievable ONLY
// through the admin dashboard (verifyAdminToken). The report is stored already-trimmed + secret- and
// (for the user's own view) never surfaced — so nothing leaks to the user, and the admin gets the
// full detail (real provider/model names included — this is an admin-only surface, White-Label §3).
//
// Pattern mirrors DiagnosticsStore: firebase-admin, VITEST-skip, best-effort, never throws.

import * as admin from 'firebase-admin';
import { applyReportMark, type ReportTriage } from './reportTriage';
import { getServerDb } from '../lib/serverDb';
import { audit } from '../lib/audit';
import { trimReportForStorage } from './DiagnosticsStore';
import { type BuildDiagnosticsReport } from './BuildDiagnostics';

const COLLECTION = 'admin_build_reports';
/** Keep the inbox bounded on read; the collection itself is admin-managed. */
export const ADMIN_REPORTS_DEFAULT_LIMIT = 100;

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Who/what reported a build — resolved server-side from the verified identity, never client input. */
export interface AdminBuildReportContext {
  userId: string | null;
  email: string | null;
  /** The reporter's account display name (Firebase displayName), resolved server-side. */
  name?: string | null;
  workspaceId: string | null;
  buildId?: string | null;
  reportedAt: number;
}

/** A simplified paid/free classification of the build's billing tier, for admin filtering. */
export type ReportTier = 'paid' | 'free' | 'admin' | 'unknown';

/** Lightweight row for the admin list (no full payload, so listing stays cheap). */
export interface AdminBuildReportMeta {
  id: string;
  reportedAt: number;
  userId: string | null;
  email: string | null;
  /** The reporter's account display name (may be null if the account has none). */
  name: string | null;
  workspaceId: string | null;
  buildId: string | null;
  ok: boolean | null;
  /**
   * Was the build STILL RUNNING when the report was sent?
   *
   * WHY THIS EXISTS (admin report f323a4db, 2026-08-06). "Report" can be pressed at any moment, and a
   * build in flight has no verdict, no cost, no duration and no post-build checks yet — so EVERY meta
   * field came back null. That is indistinguishable from a build that finished and produced nothing,
   * which is the far more alarming reading, and it is the one the admin took: the report looked
   * fabricated. A snapshot of work in progress is a perfectly useful thing; presenting it as a finished
   * build with no result is not. So the record now SAYS which one it is.
   */
  inFlight: boolean;
  /**
   * What the user lived through across the WHOLE session, when there is more than one turn.
   *
   * The per-turn `buildMs` is honest about what it measures and useless for the question actually being
   * asked — "how long did this take me?". A 58-minute session reported 18.8 minutes because that was
   * the last turn. See sessionSummary.
   */
  sessionLine: string | null;
  /** Workspace wipes repaired across the session — zero unless the guardian had to restore. */
  sessionDataLoss: number | null;
  /**
   * How many builds (parts) this report carries — 1 when only the focused build was available.
   * In meta so the inbox list can say "5 parts" without loading the full document.
   */
  sessionParts?: number;
  /** A short, human label for the app — the first line of the build prompt. */
  appLabel: string;
  /** The raw billing tier string from the build (admin-only detail). */
  userTier: string | null;
  /** Simplified paid/free/admin classification, derived from userTier — the admin "free/paid" column. */
  tier: ReportTier;
  /** How much the user was actually charged for this build, in ₹ (0 for a free/failed build; null if unknown). */
  billedInr: number | null;
  /** The same charge in USD (admin-only cross-check). */
  billedUsd: number | null;
  /** How long the build took, in milliseconds (endedAt − startedAt); null when unknown — the speed signal. */
  buildMs: number | null;
  rootCause: string | null;
  summary: string | null;
  /**
   * FIRST-PASS QUALITY (ROADMAP #1 Phase 0.2) — how many defects the engine had to repair in its OWN
   * output, and how many it left unresolved. Projected into the meta at write time so the admin list
   * can compute the clean-first-pass rate WITHOUT fetching every full report.
   *
   * `undefined` means "this record predates the field", NOT zero — a legacy row must be excluded from
   * the rate, never counted as a clean build (that would silently inflate the one number we use to
   * judge whether the engine is improving). See firstPassStatsFromMeta.
   */
  healCount?: number;
  unresolvedCount?: number;
  /**
   * TRIAGE (admin request 2026-08-12) — has this report been downloaded, and has the work been done?
   *
   * Two marks, not one, and see reportTriage.ts for why: the admin asked for a "fixed" tag on download,
   * but downloading is when the work STARTS. This session is the proof — one report downloaded on
   * 2026-08-12 took TEN merged PRs to resolve, and a one-state design would have shown it "fixed" from
   * the first minute while nine of its ten defects were still shipping.
   *
   * `undefined` means "this row predates the field", which reads as 'new' — never as fixed.
   */
  downloadedAt?: number | null;
  fixedAt?: number | null;
  fixedNote?: string | null;
}

/**
 * Classify a build's raw billing-tier string into paid / free / admin / unknown for the admin list's
 * "free or paid user" column. PURE + exported so the exact mapping is unit-tested. The raw strings come
 * from the billing record (`isAgentV3FreeUser` → 'free-list (admin/tester)', welcome-bonus → 'free …',
 * a real paying user → 'paid', billing disabled → 'billing-off …').
 */
export function classifyReportTier(userTier: string | null | undefined): ReportTier {
  const t = String(userTier ?? '').toLowerCase().trim();
  if (!t) return 'unknown';
  if (t.includes('free-list') || t.includes('admin') || t.includes('tester')) return 'admin';
  if (t.startsWith('paid') || t.includes('opus') || t.includes('billed')) return 'paid';
  if (t.includes('free')) return 'free';
  if (t.includes('billing-off') || t.includes('no charge')) return 'free';
  return 'unknown';
}

/** The full stored record: metadata + the trimmed report snapshot. */
export interface AdminBuildReportRecord {
  meta: AdminBuildReportMeta;
  /**
   * The build the user was LOOKING AT when they pressed Report — the one they are complaining about.
   * Kept as the top-level `report` so every existing reader (admin UI, download) is unchanged.
   */
  report: BuildDiagnosticsReport;
  /**
   * THE WHOLE SESSION — every build/edit of this workspace, oldest → newest (admin 2026-08-09:
   * "jab koi user app bana kar report kare, to puri report, sabhi edit sath 0 to 100 admin ko send ho").
   *
   * WHY: one turn is never the story. A user builds, then edits five times; the failure they report is
   * usually explained by an EARLIER turn, which the single-report record threw away. The admin then
   * debugged with a quarter of the evidence. Absent (undefined) when only one build exists or the
   * session could not be gathered — never a fake empty session.
   */
  session?: {
    builds: BuildDiagnosticsReport[];
    /** How many builds the session really has — `builds.length` may be smaller (size cap). */
    count: number;
    /** Oldest builds dropped to stay inside the document size limit. Honest, never hidden. */
    omittedBuilds: number;
  };
}

/**
 * Firestore's HARD per-document limit. A document one byte over is REJECTED — the write fails and
 * the whole report is lost, including the focused build that used to arrive fine.
 */
export const FIRESTORE_DOC_LIMIT_BYTES = 1_048_576;
/**
 * Headroom between our JSON byte count and Firestore's own accounting. Firestore charges for field
 * NAMES, per-field overhead and UTF-8 expansion of non-ASCII text, none of which `JSON.stringify`
 * length reflects — a report full of Devanagari can be materially larger on their side than ours.
 */
export const ADMIN_RECORD_SAFETY_BYTES = 96 * 1024;

/**
 * Fit the session into whatever the document has left, dropping OLDEST first.
 *
 * ⚠️ This is deliberately NOT `capSessionReports`. That one keeps the newest build "even if huge",
 * which is right for an HTTP response (a big download still works) and WRONG here: this sink has a
 * hard limit, so one oversized build must yield an empty-but-honest session rather than a rejected
 * write. The report itself is never at risk — only the session is trimmed, and every drop is counted.
 * PURE.
 */
export function fitSessionToDocument<T>(builds: readonly T[], budgetBytes: number): { kept: T[]; omitted: number } {
  const kept: T[] = [];
  let used = 0;
  for (let i = builds.length - 1; i >= 0; i--) {
    let size = 0;
    try { size = JSON.stringify(builds[i])?.length ?? Number.MAX_SAFE_INTEGER; } catch { size = Number.MAX_SAFE_INTEGER; }
    if (used + size > budgetBytes) break; // oldest-first drop: stop as soon as one no longer fits
    kept.unshift(builds[i]);
    used += size;
  }
  return { kept, omitted: builds.length - kept.length };
}

function cap(s: string | undefined | null, n: number): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

/** First non-empty line of the prompt, capped — a readable app label for the admin list. */
export function appLabelFromPrompt(prompt: string | undefined | null): string {
  const firstLine = String(prompt ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return cap(firstLine, 120) ?? 'Untitled build';
}

/**
 * Build the admin-inbox record (metadata + trimmed report snapshot) from a resolved build report and
 * the verified context. PURE + exported + unit-tested — no Firestore, so the metadata extraction can
 * be asserted directly. The report is run through `trimReportForStorage` so the snapshot is already
 * secret-redacted and byte-bounded, exactly like every other durable copy.
 */
export function buildAdminReportRecord(
  report: BuildDiagnosticsReport,
  ctx: AdminBuildReportContext,
  /**
   * Every build of the session, oldest → newest (admin 2026-08-09). Pass it and the record carries the
   * WHOLE story; omit it and the record is exactly what it was before. Each build is trimmed the same
   * way the focused one is — secret-redacted and byte-bounded — and the set is capped so one enormous
   * session can never exceed the document limit, with the omitted count reported honestly.
   */
  sessionBuilds?: readonly BuildDiagnosticsReport[],
): AdminBuildReportRecord {
  const trimmed = trimReportForStorage(report);
  const id = `${ctx.reportedAt}_${(ctx.workspaceId ?? 'nows').replace(/[^A-Za-z0-9_-]/g, '')}`;
  const userTier = cap(trimmed.billing?.userTier, 80);
  const buildMs =
    typeof trimmed.startedAt === 'number' && typeof trimmed.endedAt === 'number' && trimmed.endedAt >= trimmed.startedAt
      ? trimmed.endedAt - trimmed.startedAt
      : null;
  // A build with a start and no end had not finished. `ok` is set only when the build settles, so its
  // absence is the same fact from the other side; requiring BOTH keeps a half-written report honest.
  const inFlight = typeof trimmed.startedAt === 'number'
    && typeof trimmed.endedAt !== 'number'
    && typeof trimmed.ok !== 'boolean';
  const runningFor = inFlight && typeof trimmed.startedAt === 'number'
    ? Math.max(0, Math.round((ctx.reportedAt - trimmed.startedAt) / 1000))
    : 0;
  // THE WHOLE SESSION (admin 2026-08-09): trim every build exactly like the focused one, then fit the
  // set into whatever the DOCUMENT has left. A single-build session adds nothing new, so it is left
  // absent rather than duplicating the focused report.
  //
  // THE BUDGET IS DERIVED, NOT GUESSED. The session shares one Firestore document with `meta` and the
  // focused `report`, so its allowance is the limit MINUS what those already spend, minus headroom for
  // Firestore's own accounting. Reusing a fixed cap sized for a different sink is exactly how a change
  // like this turns "the admin now gets more" into "the admin now gets NOTHING", because an oversized
  // document is rejected outright and the report never lands.
  const trimmedSession = (sessionBuilds ?? []).map((b) => trimReportForStorage(b));
  let fittedSession: { kept: BuildDiagnosticsReport[]; omitted: number } | null = null;
  if (trimmedSession.length > 1) {
    let overhead = ADMIN_RECORD_SAFETY_BYTES;
    try { overhead += JSON.stringify(trimmed)?.length ?? 0; } catch { overhead += FIRESTORE_DOC_LIMIT_BYTES; }
    const budget = FIRESTORE_DOC_LIMIT_BYTES - overhead;
    fittedSession = budget > 0
      ? fitSessionToDocument(trimmedSession, budget)
      : { kept: [], omitted: trimmedSession.length }; // focused report alone already fills the doc
  }

  return {
    meta: {
      id,
      reportedAt: ctx.reportedAt,
      userId: ctx.userId ?? null,
      email: ctx.email ?? null,
      name: cap(ctx.name, 80),
      workspaceId: ctx.workspaceId ?? null,
      buildId: ctx.buildId ?? trimmed.buildId ?? null,
      ok: typeof trimmed.ok === 'boolean' ? trimmed.ok : null,
      inFlight,
      sessionLine: trimmed.session?.line ? cap(trimmed.session.line, 400) : null,
      sessionDataLoss: typeof trimmed.session?.dataLossTotal === 'number' ? trimmed.session.dataLossTotal : null,
      appLabel: appLabelFromPrompt(trimmed.prompt),
      userTier,
      tier: classifyReportTier(userTier),
      billedInr: typeof trimmed.billing?.billedInr === 'number' ? trimmed.billing.billedInr : null,
      billedUsd: typeof trimmed.billing?.billedUsd === 'number' ? trimmed.billing.billedUsd : null,
      buildMs,
      rootCause: cap(trimmed.rootCause, 400),
      // SAY THE OBVIOUS THING. A null summary on an unfinished build reads as "the build produced
      // nothing"; the truth is "the build had not got there yet". One sentence is the whole difference
      // between a report that looks fabricated and one that is simply an early snapshot.
      summary: inFlight && !trimmed.summary
        ? `Reported while the build was STILL RUNNING (${Math.floor(runningFor / 60)}m ${runningFor % 60}s in). There is no verdict, cost, duration or post-build check yet — those are written when the build finishes. Everything below is a snapshot of the work in progress.`
        : cap(trimmed.summary, 400),
      // counts.autoResolved already EXCLUDES observations (advisory notes about the user's own code),
      // which is what keeps the self-heal tally from inflating itself — see BuildDiagnostics.
      healCount: typeof trimmed.counts?.autoResolved === 'number' ? trimmed.counts.autoResolved : undefined,
      unresolvedCount: typeof trimmed.counts?.unresolved === 'number' ? trimmed.counts.unresolved : undefined,
      // 1 part = just the focused build; more when the whole session came with it. A session that did
      // not fit stores 0 builds — the focused report is still there, so the record still has 1 part.
      sessionParts: fittedSession && fittedSession.kept.length > 0 ? fittedSession.kept.length : 1,
    },
    report: trimmed,
    // Kept even when `builds` ends up EMPTY: the omitted count is the only place the admin learns that
    // earlier builds existed and could not be stored. Dropping the block would hide that silently.
    ...(fittedSession
      ? { session: { builds: fittedSession.kept, count: trimmedSession.length, omittedBuilds: fittedSession.omitted } }
      : {}),
  };
}

/** Persist one reported build into the admin inbox. Best-effort; never throws; no-op under VITEST. */
export async function saveAdminBuildReport(record: AdminBuildReportRecord): Promise<boolean> {
  if (!record?.meta?.id) return false;
  if (process.env.VITEST) return false;
  const db = getDb();
  if (!db) return false;
  try {
    await db.collection(COLLECTION).doc(record.meta.id).set({ ...record, savedAt: Date.now() }, { merge: false });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ADMIN_BUILD_REPORT] SAVE FAILED (${record.meta.id}): ${message}`);
    try { audit('ADMIN_BUILD_REPORT_SAVE_FAILED', { id: record.meta.id, error: message.slice(0, 300) }); } catch { /* honesty layer must never throw */ }
    return false;
  }
}

/** List reported builds, newest first, metadata only. Never throws — [] on any failure. */
export async function listAdminBuildReports(limit = ADMIN_REPORTS_DEFAULT_LIMIT): Promise<AdminBuildReportMeta[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(COLLECTION).orderBy('meta.reportedAt', 'desc').limit(Math.max(1, limit)).get();
    return snap.docs.map((d) => (d.data() as AdminBuildReportRecord).meta).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Set the triage marks on ONE report (admin request 2026-08-12). Returns the merged marks, or null when
 * the report is absent or the write failed — the caller reports that honestly rather than showing a
 * badge for a mark that never persisted.
 *
 * Writes ONLY the three meta fields (a merge, not a set), so a mark can never damage the report payload
 * it is annotating.
 */
export async function markAdminBuildReport(
  id: string,
  mark: { downloaded?: boolean; fixed?: boolean; note?: string | null },
  now: number = Date.now(),
): Promise<ReportTriage | null> {
  const db = getDb();
  if (!db || !id) return null;
  try {
    const ref = db.collection(COLLECTION).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const meta = ((doc.data() as AdminBuildReportRecord)?.meta ?? {}) as AdminBuildReportMeta;
    const next = applyReportMark(meta, mark, now);
    await ref.set({ meta: next }, { merge: true });
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ADMIN_BUILD_REPORT] MARK FAILED (${id}): ${message}`);
    return null;
  }
}

/** Load ONE reported build's full record by id. Null on any failure/absence. */
export async function getAdminBuildReport(id: string): Promise<AdminBuildReportRecord | null> {
  const db = getDb();
  if (!db || !id) return null;
  try {
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return (doc.data() as AdminBuildReportRecord) ?? null;
  } catch {
    return null;
  }
}

/**
 * Delete ONE reported build from the inbox (admin 2026-08-16: "build report delete karne ka option do —
 * agar space kha rahi ho"). Each record can be up to ~1 MB (it carries the whole session), so a handled
 * report is pure stored cost once its bug is fixed. Returns true only when the doc genuinely went away.
 * Never throws.
 */
export async function deleteAdminBuildReport(id: string): Promise<boolean> {
  const db = getDb();
  if (!db || !id) return false;
  try {
    await db.collection(COLLECTION).doc(id).delete();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ADMIN_BUILD_REPORT] DELETE FAILED (${id}): ${message}`);
    return false;
  }
}

/**
 * Clear the WHOLE inbox — every reported build (admin 2026-08-16). For reclaiming space in one action
 * when many handled reports have piled up; one-by-one is impractical at scale. Deletes in batches so a
 * large inbox cannot exceed Firestore's 500-writes-per-batch limit, and is bounded by a hard guard so a
 * pathological loop can never run away. Returns how many were deleted. Never throws.
 */
export async function deleteAllAdminBuildReports(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  let deleted = 0;
  try {
    for (let guard = 0; guard < 10000; guard++) {
      const snap = await db.collection(COLLECTION).limit(300).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 300) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ADMIN_BUILD_REPORT] CLEAR FAILED after ${deleted} deleted: ${message}`);
  }
  return deleted;
}
