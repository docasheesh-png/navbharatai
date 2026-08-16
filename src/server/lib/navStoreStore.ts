// Where a submitted app and its record actually live.
//
// TWO STORES, on purpose (admin 2026-07-27):
//   • The APK BYTES go to Cloud Storage. An Android app is 5–50 MB and a Firestore document caps at
//     1 MB, so there is no version of this that stores the binary in the database.
//   • The RECORD goes to Firestore: who submitted it, what the inspection found, what the scanner
//     said, and — the field everything hinges on — its status.
//
// THE STATUS IS THE WHOLE SAFETY MODEL. An app is only ever visible to the public when an admin has
// explicitly set it to 'approved'. Nothing in this file, and nothing in the upload path, can move an
// app to 'approved' on its own. A clean scan produces 'pending', not 'approved', because malware
// written for a specific campaign is routinely unknown to every engine on the day it ships — the
// scan informs the reviewer, it does not replace them.
//
// Everything degrades honestly: with no storage bucket configured, `isStorageConfigured()` is false
// and the upload screen says the store is not accepting apps yet, rather than accepting a file it
// cannot keep.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { listEqNewestFirst } from './firestoreIndexSafe';

const COLLECTION = 'nav_store_apps';

/** Where APKs live inside the bucket. Kept flat and hash-named so the same file is never stored twice. */
const APK_PREFIX = 'nav-store/apk';

export type SubmissionStatus =
  | 'pending'    // scanned, waiting for a human. The ONLY state an upload can produce.
  | 'approved'   // an admin looked and published it. The only state the public can see.
  | 'rejected'   // an admin refused it.
  | 'removed';   // taken down after publication.

export interface DeveloperDetails {
  name: string;
  email: string;
  phone?: string;
  website?: string;
}

export interface StoreApp {
  id: string;
  status: SubmissionStatus;
  /** The submitting account. Never taken from the request body. */
  uid: string;
  developer: DeveloperDetails;
  appName: string;
  packageName: string;
  versionName: string;
  shortDescription: string;
  description: string;
  category: string;
  iconDataUrl?: string;
  /** Facts from the structural inspection. */
  sha256: string;
  sizeBytes: number;
  permissions: string[];
  highRisk: Array<{ permission: string; why: string }>;
  inspectionWarnings: string[];
  /** What the malware scanner actually said. */
  scanVerdict: string;
  scanMalicious: number;
  scanEnginesTotal: number;
  scanFlaggedBy: string[];
  scanReportUrl?: string;
  scanReason?: string;
  /** Where the bytes are, inside our bucket. Never handed to a browser directly. */
  storagePath: string;
  downloads: number;
  submittedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  /**
   * Where the binary came from, when we know (publish-from-build).
   *
   * This is real evidence a reviewer can act on — the exact GitHub Actions run of a repo the
   * submitting account owns. It is PROVENANCE, not proof: the build runs in the user's own Actions
   * with their own signing key, so it never substitutes for the scan or for admin approval.
   */
  provenance?: { source: 'navbharatai-build'; repo: string; artifactId: string };
}

/** Public view — everything a downloader needs, and nothing about our internals. */
export type PublicStoreApp = Pick<StoreApp,
  'id' | 'appName' | 'packageName' | 'versionName' | 'shortDescription' | 'description'
  | 'category' | 'iconDataUrl' | 'sizeBytes' | 'permissions' | 'highRisk' | 'downloads' | 'sha256'
> & { developerName: string; publishedAt: number };

export function isStorageConfigured(): boolean {
  return !!(process.env.NAV_STORE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
}

function bucketName(): string {
  return (process.env.NAV_STORE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
}

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

/**
 * Store the APK bytes.
 *
 * Named by hash, so re-uploading the identical file overwrites one object instead of filling the
 * bucket with duplicates. Returns the path; the object itself stays PRIVATE — downloads are always
 * served through our own route so a removed app genuinely stops being downloadable.
 */
export async function putApk(sha256: string, bytes: Buffer): Promise<string> {
  const name = bucketName();
  if (!name) throw new Error('no bucket configured');
  const path = `${APK_PREFIX}/${sha256}.apk`;
  const file = admin.storage().bucket(name).file(path);
  await file.save(bytes, {
    resumable: false,
    contentType: 'application/vnd.android.package-archive',
    metadata: { cacheControl: 'private, max-age=0' },
  });
  return path;
}

/** Read the bytes back for a download. Throws when the object is gone, which the route reports. */
export async function getApk(storagePath: string): Promise<Buffer> {
  const name = bucketName();
  if (!name) throw new Error('no bucket configured');
  const [buf] = await admin.storage().bucket(name).file(storagePath).download();
  return buf;
}

/** Delete the bytes — used when an app is removed, so a takedown is real and not just a flag. */
export async function deleteApk(storagePath: string): Promise<void> {
  const name = bucketName();
  if (!name) return;
  try {
    await admin.storage().bucket(name).file(storagePath).delete({ ignoreNotFound: true });
  } catch {
    /* a failed delete is reported by the caller re-reading; never blocks the status change */
  }
}

export async function saveApp(app: StoreApp): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(app.id).set(app);
}

export async function getApp(id: string): Promise<StoreApp | null> {
  const d = db();
  if (!d) return null;
  const doc = await d.collection(COLLECTION).doc(id).get();
  return doc.exists ? (doc.data() as StoreApp) : null;
}

export async function updateApp(id: string, patch: Partial<StoreApp>): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(id).update(patch);
}

/**
 * Apps in a given state, newest first. Used by both the admin queue and the public listing.
 *
 * Filtered in Firestore, sorted in memory, via `listEqNewestFirst` — a `.where(status).orderBy(
 * submittedAt)` chain needs a composite index that has never been deployed to this project, and
 * would therefore THROW here rather than return rows. See `firestoreIndexSafe.ts`.
 */
export async function listApps(status: SubmissionStatus, limit = 50): Promise<StoreApp[]> {
  const d = db();
  if (!d) return [];
  return listEqNewestFirst<StoreApp>(
    d.collection(COLLECTION), [['status', status]], 'submittedAt', Math.max(1, Math.min(limit, 200)),
  );
}

/** One developer's own submissions, whatever their state, so they can see where each one stands. */
export async function listAppsByUid(uid: string, limit = 50): Promise<StoreApp[]> {
  const d = db();
  if (!d) return [];
  return listEqNewestFirst<StoreApp>(
    d.collection(COLLECTION), [['uid', uid]], 'submittedAt', Math.max(1, Math.min(limit, 200)),
  );
}

/**
 * Strip a record down to what the public may see.
 *
 * Deliberately omits the uploader's email and phone, our storage path, and the raw scanner engine
 * list. The permissions and the high-risk explanations DO go out — a person deciding whether to
 * install something has a right to know it wants to read their text messages.
 */
export function toPublic(app: StoreApp): PublicStoreApp {
  return {
    id: app.id,
    appName: app.appName,
    packageName: app.packageName,
    versionName: app.versionName,
    shortDescription: app.shortDescription,
    description: app.description,
    category: app.category,
    iconDataUrl: app.iconDataUrl,
    sizeBytes: app.sizeBytes,
    permissions: app.permissions,
    highRisk: app.highRisk,
    downloads: app.downloads,
    sha256: app.sha256,
    developerName: app.developer.name,
    publishedAt: app.reviewedAt || app.submittedAt,
  };
}
