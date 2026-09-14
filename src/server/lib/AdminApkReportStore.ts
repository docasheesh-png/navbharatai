// Admin-only APK/AAB/iOS build-FAILURE inbox (admin 2026-09-14: "apk bane nahi, fail ho jaye, to puri
// failed apk ki detailed build report — jo admin ko fix karne ke liye chahiye woh sab — admin panel me
// automatically send ho jaye").
//
// A SEPARATE inbox from AdminBuildReportStore.ts on purpose — same reasoning the 2026-08-21 "User
// Reports" split already established in this codebase: one is the in-house AgentV3 engine's OWN build
// report, submitted only when a user presses "Report"; this is the "your app is built on your own
// GitHub" pipeline (mobileShip.ts / StoreBuildPanel.tsx), and it is written AUTOMATICALLY the moment
// the server observes a build fail — no user action required. Mixing the two inboxes would bury one
// kind of failure inside a screen built for the other's fields.
//
// WHAT MAKES THIS "DETAILED ENOUGH TO FIX" WITHOUT DUPLICATING WHAT GITHUB ALREADY HOLDS: the record
// carries the SAME classified diagnosis, step list and log excerpt the user's own downloadable report
// shows (buildMobileBuildReport in mobileBuildReport.ts — one builder, so the admin and the user can
// never be told two different stories about the same run) PLUS a direct link to the GitHub Actions run,
// where the complete, unbounded log already lives for 90 days. Duplicating megabytes of log text into
// Firestore would be the fragile choice; the excerpt plus the link is the honest one.
//
// Collection: `admin_apk_reports`  ·  Doc ID: deterministic on (owner, repo, runId) — see `apkReportId`.
// That determinism IS the idempotency guard: a build's status is polled repeatedly while it runs, so
// the caller MUST NOT create a second row for the same failed run just because it was observed twice.
// `.create()` (never `.set()`) makes a duplicate attempt a no-op by construction, not by a race-prone
// "check then write".
//
// Pattern mirrors AppBuildStore.ts / AdminBuildReportStore.ts: firebase-admin, VITEST-skip, best-effort,
// never throws — a failure here must never affect the response the user's own build-status poll is
// waiting on.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import type { BuildReportStep } from './mobileBuildReport';

export interface ApkFailureReport {
  /** Deterministic — see `apkReportId`. */
  id: string;
  reportedAt: number;
  userId: string;
  email: string | null;
  owner: string;
  repo: string;
  /** The build workflow file, e.g. `android-apk.yml`. */
  workflow: string;
  /** What this build was producing, in plain words (e.g. "Installable Android app (.apk)"). */
  building: string;
  runId: string;
  /** Direct link to the GitHub Actions run — the full, unbounded log lives here. */
  runUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  steps: BuildReportStep[];
  failure: {
    whatStopped: string;
    stage: string | null;
    why: string;
    navbharatCanFixItself: boolean;
    detail: Record<string, string> | null;
    logExcerpt: string[];
  };
  /** Simple triage, mirroring the AgentV3 inbox's own pattern — set only by an admin action. */
  fixed?: boolean;
  fixedAt?: number | null;
  fixedNote?: string | null;
}

const COLLECTION = 'admin_apk_reports';
/** Keep the inbox bounded on read; the collection itself is admin-managed (delete / clear below). */
export const APK_REPORTS_DEFAULT_LIMIT = 200;

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/**
 * The doc id for one FAILED RUN.
 *
 * Deterministic and run-specific (unlike AppBuildStore's per-APP id) — a report is about one attempt,
 * and a user who fixes their code and rebuilds should get a SECOND report if that rebuild also fails,
 * not have the first one silently overwritten. Sanitised because these values become a Firestore
 * document id — a slash in a repo name would otherwise create a nested path.
 */
export function apkReportId(owner: string, repo: string, runId: string): string {
  const safe = (s: string) => String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  return [safe(owner), safe(repo), safe(runId)].join('_');
}

/**
 * Save a failure report — but ONLY the first time this exact run is reported. Returns `true` when a
 * new row was written, `false` when one already existed (the common case: the client polls a failed
 * build's status several times before it stops) or the store is unavailable.
 */
export async function saveApkFailureReport(rec: Omit<ApkFailureReport, 'id' | 'reportedAt'>): Promise<boolean> {
  const db = getDb();
  if (!db || !rec.userId || !rec.owner || !rec.repo || !rec.runId) return false;
  try {
    const id = apkReportId(rec.owner, rec.repo, rec.runId);
    await db.collection(COLLECTION).doc(id).create({ ...rec, id, reportedAt: Date.now() });
    return true;
  } catch {
    // ALREADY_EXISTS on a repeat poll is the expected, silent case; any other failure is also
    // best-effort here — the build the user is watching must never wait on this write.
    return false;
  }
}

/** The inbox, newest first. */
export async function listApkReports(limit = APK_REPORTS_DEFAULT_LIMIT): Promise<ApkFailureReport[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(COLLECTION).orderBy('reportedAt', 'desc').limit(limit).get();
    const out: ApkFailureReport[] = [];
    snap.forEach((doc) => out.push(doc.data() as ApkFailureReport));
    return out;
  } catch {
    return [];
  }
}

/** One report in full. */
export async function getApkReport(id: string): Promise<ApkFailureReport | null> {
  const db = getDb();
  if (!db || !id) return null;
  try {
    const doc = await db.collection(COLLECTION).doc(id).get();
    return doc.exists ? (doc.data() as ApkFailureReport) : null;
  } catch {
    return null;
  }
}

/** Mark (or unmark) a report as fixed, with an optional note — the admin's own record of what happened. */
export async function markApkReportFixed(
  id: string, fixed: boolean, note?: string | null,
): Promise<boolean> {
  const db = getDb();
  if (!db || !id) return false;
  try {
    await db.collection(COLLECTION).doc(id).set({
      fixed, fixedAt: fixed ? Date.now() : null, fixedNote: note ?? null,
    }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export async function deleteApkReport(id: string): Promise<boolean> {
  const db = getDb();
  if (!db || !id) return false;
  try {
    const ref = db.collection(COLLECTION).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  } catch {
    return false;
  }
}

/** Wipe the whole inbox. Irreversible — the caller (the admin route) gates this behind explicit confirm. */
export async function deleteAllApkReports(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const snap = await db.collection(COLLECTION).get();
    const batchSize = 400; // stay under Firestore's 500-write batch limit
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + batchSize)) batch.delete(doc.ref);
      await batch.commit();
    }
    return docs.length;
  } catch {
    return 0;
  }
}
