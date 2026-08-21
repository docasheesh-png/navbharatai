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
import type { ReportContext, ReportStatus, ReportTarget, UserReport } from '../../lib/userReport';

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
  message: string;
  hasScreenshot: boolean;
  context: ReportContext;
  now?: number;
}): UserReport {
  return {
    id: newReportId(),
    reporterUid: input.reporterUid,
    target: input.target,
    message: input.message,
    hasScreenshot: input.hasScreenshot,
    context: input.context,
    at: input.now ?? Date.now(),
    status: 'open',
  };
}
