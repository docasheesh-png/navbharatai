// Where a user's report lives, and how an admin gets it back.
//
// ADMIN 2026-08-21. The store already had an app-report route that wrote to Firestore and that NOTHING
// EVER READ — no admin screen, no query, nothing. The reporter was told "a person reviews every
// report" and no person could. That is the failure this module exists to make impossible: the write
// and the read are defined together, here, so a report that cannot be read cannot be written.
//
// TWO STRUCTURAL DECISIONS:
//
//   1. THE SCREENSHOT LIVES IN ITS OWN DOCUMENT. A Firestore document is capped at 1 MiB, and a
//      compressed screenshot is a large fraction of that. Putting it in the report record would make
//      the admin LIST — which fetches many records — drag megabytes of images nobody is looking at
//      yet, and would risk a report failing to save because the picture was big. The record carries
//      `hasScreenshot`; the bytes are fetched only when an admin opens that one report.
//   2. NO COMPOSITE INDEXES. Listing is a single-field equality plus an in-memory sort, through the
//      shared index-safe helper — the same rule that already cost this repo a live publish outage.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { listEqNewestFirst, newestFirstBy } from './firestoreIndexSafe';
import {
  appendReportMessage, isShotId, THREAD_MAX,
  type ProblemKind, type ReportContext, type ReportMessage, type ReportStatus, type ReportTarget,
  type UserReport,
} from '../../lib/userReport';

const COLLECTION = 'user_reports';
const SHOT_SUB = 'shot';
const SHOT_DOC = 'image';

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

export function newReportId(): string {
  return `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Save a report (and its screenshot, when there is one). Throws so the route can answer honestly. */
export async function saveReport(
  report: UserReport,
  screenshotDataUrl?: string,
): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(report.id).set(report);
  if (screenshotDataUrl) {
    await d.collection(COLLECTION).doc(report.id).collection(SHOT_SUB).doc(SHOT_DOC)
      .set({ dataUrl: screenshotDataUrl, at: Date.now() });
  }
}

/** The screenshot for one report, or null. Fetched only when an admin opens it. */
export async function getReportScreenshot(id: string): Promise<string | null> {
  const d = db();
  if (!d) return null;
  try {
    const snap = await d.collection(COLLECTION).doc(id).collection(SHOT_SUB).doc(SHOT_DOC).get();
    const url = snap.exists ? (snap.data() as { dataUrl?: string })?.dataUrl : '';
    return typeof url === 'string' && url.startsWith('data:image/') ? url : null;
  } catch {
    return null;
  }
}

export async function getReport(id: string): Promise<UserReport | null> {
  const d = db();
  if (!d) return null;
  try {
    const snap = await d.collection(COLLECTION).doc(id).get();
    return snap.exists ? ({ ...(snap.data() as UserReport), id: snap.id }) : null;
  } catch {
    return null;
  }
}

/**
 * Reports for the admin screen, newest first.
 *
 * `status` filters through a single equality (index-free); with no filter the collection is read and
 * sorted in memory, bounded by `limit`.
 */
export async function listReports(opts: { status?: ReportStatus; limit?: number } = {}): Promise<UserReport[]> {
  const d = db();
  if (!d) return [];
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  try {
    if (opts.status) {
      return await listEqNewestFirst<UserReport>(
        d.collection(COLLECTION), [['status', opts.status]], 'at', limit,
        undefined,
        (id, data) => ({ ...(data as UserReport), id }),
      );
    }
    const snap = await d.collection(COLLECTION).limit(500).get();
    const rows = snap.docs.map((doc) => ({ ...(doc.data() as UserReport), id: doc.id }));
    return newestFirstBy(rows, 'at').slice(0, limit);
  } catch {
    return [];
  }
}

/** How many reports name this user as the subject — the number an admin actually acts on. */
export async function countReportsAgainst(uid: string): Promise<number> {
  const d = db();
  if (!d || !uid) return 0;
  try {
    const snap = await d.collection(COLLECTION).where('target.ownerUid', '==', uid).limit(200).get();
    return snap.size;
  } catch {
    return 0;
  }
}

/** Mark a report handled. `adminNote` is what the admin wrote — kept, so a decision has a record. */
export async function setReportStatus(id: string, status: ReportStatus, adminNote?: string): Promise<boolean> {
  const d = db();
  if (!d) return false;
  try {
    await d.collection(COLLECTION).doc(id).set(
      { status, handledAt: Date.now(), ...(adminNote ? { adminNote: adminNote.slice(0, 1000) } : {}) },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

/** Build the record. Pure apart from the id, so the route stays about HTTP. */
export function buildReport(input: {
  reporterUid: string;
  target: ReportTarget;
  problemKind?: ProblemKind;
  message: string;
  hasScreenshot: boolean;
  context: ReportContext;
  now?: number;
}): UserReport {
  return {
    id: newReportId(),
    reporterUid: input.reporterUid,
    target: input.target,
    ...(input.problemKind ? { problemKind: input.problemKind } : {}),
    message: input.message,
    hasScreenshot: input.hasScreenshot,
    context: input.context,
    at: input.now ?? Date.now(),
    status: 'open',
  };
}

/**
 * The reports this person filed themselves, newest first.
 *
 * 🔒 SCOPED BY THE CALLER'S OWN uid, WHICH THE ROUTE TAKES FROM THE VERIFIED TOKEN — never from a
 * query parameter. A report contains somebody's device details and whatever they typed while upset;
 * a list endpoint that accepted a uid would hand all of that to anyone who could guess one.
 *
 * Single-field equality plus an in-memory sort, through the shared index-safe helper — the same rule
 * that already cost this repo a live publish outage.
 */
export async function listReportsByReporter(uid: string, limit = 20): Promise<UserReport[]> {
  const d = db();
  if (!d || !uid) return [];
  try {
    return await listEqNewestFirst<UserReport>(
      d.collection(COLLECTION), [['reporterUid', uid]], 'at', Math.max(1, Math.min(50, limit)),
      undefined,
      (id, data) => ({ ...(data as UserReport), id }),
    );
  } catch {
    return [];
  }
}

/**
 * Add one message to a report's conversation.
 *
 * ⚠️ A TRANSACTION, AND IT HAS TO BE. Read-modify-write on an array is exactly where a lost update
 * hides: the admin answering while the user is typing would otherwise overwrite one of the two
 * messages, and neither person would ever know a message had vanished.
 *
 * Returns the new thread, or null when the report does not exist or the write failed — so a caller
 * can tell the user honestly instead of showing a message that was never stored.
 */
export async function addReportMessage(
  id: string,
  message: ReportMessage,
  opts: { expectReporterUid?: string; reopen?: boolean } = {},
): Promise<ReportMessage[] | null> {
  const d = db();
  if (!d || !id) return null;
  const ref = d.collection(COLLECTION).doc(id);
  try {
    return await d.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const report = snap.data() as UserReport;
      // 🔒 The ownership check lives INSIDE the transaction, against the stored document — not
      // against a copy the route read a moment earlier. Checking outside would leave a window, and
      // the thing on the other side of that window is somebody else's conversation.
      if (opts.expectReporterUid && report.reporterUid !== opts.expectReporterUid) return null;
      const messages = appendReportMessage(report.messages, message, THREAD_MAX);
      tx.set(ref, { messages, ...(opts.reopen ? { status: 'open' as ReportStatus } : {}) }, { merge: true });
      return messages;
    });
  } catch {
    return null;
  }
}

/**
 * A screenshot attached to one MESSAGE, in its own document beside the report's original one.
 *
 * 🔒 THE ID IS RE-VALIDATED HERE, not merely where it entered. This value becomes a Firestore
 * document path segment, and a store function is reachable from any future caller — a check that
 * lives only in today's route is a check the next route will not have.
 */
export async function saveReportMessageShot(reportId: string, shotId: string, dataUrl: string): Promise<boolean> {
  const d = db();
  if (!d || !reportId || !isShotId(shotId) || !dataUrl.startsWith('data:image/')) return false;
  try {
    await d.collection(COLLECTION).doc(reportId).collection(SHOT_SUB).doc(shotId)
      .set({ dataUrl, at: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** One message's screenshot, or null. Fetched only when somebody actually looks at that message. */
export async function getReportMessageShot(reportId: string, shotId: string): Promise<string | null> {
  const d = db();
  if (!d || !reportId || !isShotId(shotId)) return null;
  try {
    const snap = await d.collection(COLLECTION).doc(reportId).collection(SHOT_SUB).doc(shotId).get();
    const url = snap.exists ? (snap.data() as { dataUrl?: string })?.dataUrl : '';
    return typeof url === 'string' && url.startsWith('data:image/') ? url : null;
  } catch {
    return null;
  }
}
