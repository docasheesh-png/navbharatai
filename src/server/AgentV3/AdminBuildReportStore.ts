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
import { getServerDb } from '../lib/serverDb';
import { audit } from '../lib/audit';
import { trimReportForStorage } from './DiagnosticsStore';
import type { BuildDiagnosticsReport } from './BuildDiagnostics';

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
  report: BuildDiagnosticsReport;
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
export function buildAdminReportRecord(report: BuildDiagnosticsReport, ctx: AdminBuildReportContext): AdminBuildReportRecord {
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
    },
    report: trimmed,
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
