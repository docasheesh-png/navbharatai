// Where a finished native .apk / .aab is kept (2026-11-25).
//
// A PRIVATE object in the configured bucket — never public, never a permanent URL. Every download goes
// through the authenticated route, which checks ownership against the job row first, so deleting or
// expiring a build genuinely stops it being downloadable. The object is verified after the write (size
// and SHA-256 read back from storage metadata) before a build is ever reported complete.

import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { nativeArtifactBucket } from './providerRegistry';
import { listJobsForUser, requestCancel } from './nativeBuildStore';
import { isTerminalState, type MobileArtifactKind, type MobileBuildState } from './types';

export interface ArtifactStore {
  put(objectPath: string, bytes: Buffer, kind: MobileArtifactKind): Promise<{ sizeBytes: number; md5Ok: boolean }>;
  stream(objectPath: string): NodeJS.ReadableStream;
  remove(objectPath: string): Promise<void>;
}

export const CONTENT_TYPE: Record<MobileArtifactKind, string> = {
  apk: 'application/vnd.android.package-archive',
  aab: 'application/octet-stream',
};

/** The owner folder of every artifact a user's builds produced: `mobile-builds/<uid-hash>/`. PURE. */
export function artifactOwnerPrefix(userId: string): string {
  return `mobile-builds/${createHash('sha256').update(userId).digest('hex').slice(0, 24)}/`;
}

/** `mobile-builds/<uid-hash>/<buildId>/<file>` — the user id itself never appears in a storage path. */
export function artifactObjectPath(userId: string, buildId: string, fileName: string): string {
  if (!/^nb_[0-9a-f]{32}$/.test(buildId) || !/^[A-Za-z0-9._-]{1,120}$/.test(fileName)) throw new Error('Invalid artifact path');
  return `${artifactOwnerPrefix(userId)}${buildId}/${fileName}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bucket(): ReturnType<ReturnType<typeof admin.storage>['bucket']> {
  const name = nativeArtifactBucket();
  if (!name) throw new Error('No artifact bucket is configured');
  if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
  return admin.storage().bucket(name);
}

export const gcsArtifactStore: ArtifactStore = {
  async put(objectPath, bytes, kind) {
    const file = bucket().file(objectPath);
    const md5 = createHash('md5').update(bytes).digest('base64');
    await file.save(bytes, {
      resumable: false,
      contentType: CONTENT_TYPE[kind],
      // Storage verifies the upload against this hash and rejects a corrupted transfer.
      validation: 'md5',
      metadata: { cacheControl: 'private, max-age=0', md5Hash: md5 },
    });
    const [meta] = await file.getMetadata();
    return { sizeBytes: Number(meta.size ?? -1), md5Ok: meta.md5Hash === md5 };
  },
  stream(objectPath) {
    return bucket().file(objectPath).createReadStream();
  },
  async remove(objectPath) {
    await bucket().file(objectPath).delete({ ignoreNotFound: true }).catch(() => {});
  },
};

// ─────────────────────────────── Account deletion (Q-3614) ───────────────────────────────
//
// The key is already owner-derived, so the eraser needs no record at all: it deletes `mobile-builds/<uid-hash>/` for
// the VERIFIED uid. A build still running could write its file AFTER that delete, so running builds are asked to stop
// FIRST, and any that had not stopped is said, never hidden.

/** What the eraser needs. Production: the job store and the artifact bucket. Tests: a fake. */
export interface NativeArtifactEraseDeps {
  /** Throws when no bucket is configured or the delete fails. */
  deletePrefix(prefix: string): Promise<void>;
  listJobs(uid: string): Promise<Array<{ id: string; userId: string; state: MobileBuildState }>>;
  /** Ask one build to stop; returns its state after the request, or null when it is not this owner's. */
  requestCancel(id: string, uid: string): Promise<{ state: MobileBuildState } | null>;
}

export function liveNativeArtifactEraseDeps(): NativeArtifactEraseDeps {
  return {
    async deletePrefix(prefix) {
      if (!/^mobile-builds\/[0-9a-f]{24}\/$/.test(prefix)) throw new Error('Refusing to delete outside one owner folder');
      await bucket().deleteFiles({ prefix, force: true });
    },
    listJobs: (uid) => listJobsForUser(uid, 1000),
    requestCancel: (id, uid) => requestCancel(id, uid),
  };
}

export interface NativeArtifactEraseReport {
  attempted: boolean;
  /** The owner's whole artifact folder was confirmed deleted and no build of theirs was still running. */
  artifactsRemoved: boolean;
  ownerFolderDeleted: boolean;
  /** Builds that were running and were asked to stop before the folder was deleted. */
  runningBuildsStopped: number;
  failures: string[];
  limitations: string[];
}

export const RUNNING_NATIVE_BUILD_LIMITATION =
  'A phone app build was still finishing when your account was deleted; it was asked to stop, and a file it finishes saving afterwards is deleted as soon as it finds its build record gone.';

/**
 * DELETE /api/profile's step for native .apk/.aab files (Q-3614). `verifiedUid` is the deletion route's VERIFIED
 * identity. Running builds are cancelled first, then `mobile-builds/<uid-hash>/` is deleted. A failure is reported as a
 * failure, never as a removal. Never throws.
 */
export async function eraseUserNativeArtifacts(
  verifiedUid: string,
  deps: NativeArtifactEraseDeps = liveNativeArtifactEraseDeps(),
): Promise<NativeArtifactEraseReport> {
  const report: NativeArtifactEraseReport = { attempted: false, artifactsRemoved: false, ownerFolderDeleted: false, runningBuildsStopped: 0, failures: [], limitations: [] };
  if (!verifiedUid || typeof verifiedUid !== 'string') return { ...report, failures: ['No usable account id: phone app build files could not be selected for removal.'] };
  report.attempted = true;
  try {
    const jobs = await deps.listJobs(verifiedUid);
    let stillRunning = 0;
    for (const job of jobs) {
      if (job.userId !== verifiedUid || isTerminalState(job.state)) continue;
      const after = await deps.requestCancel(job.id, verifiedUid);
      report.runningBuildsStopped++;
      if (!after || !isTerminalState(after.state)) stillRunning++;
    }
    if (stillRunning) report.limitations.push(RUNNING_NATIVE_BUILD_LIMITATION);
  } catch {
    report.failures.push('Your phone app builds could not be checked, so a build still running could not be stopped first.');
  }
  try { await deps.deletePrefix(artifactOwnerPrefix(verifiedUid)); report.ownerFolderDeleted = true; } catch {
    report.failures.push('Your phone app build files (.apk / .aab) could not be confirmed removed.');
  }
  report.artifactsRemoved = report.ownerFolderDeleted && report.failures.length === 0 && report.limitations.length === 0;
  return report;
}
