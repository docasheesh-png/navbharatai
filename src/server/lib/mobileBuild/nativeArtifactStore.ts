// Where a finished native .apk / .aab is kept (2026-11-25).
//
// A PRIVATE object in the configured bucket — never public, never a permanent URL. Every download goes
// through the authenticated route, which checks ownership against the job row first, so deleting or
// expiring a build genuinely stops it being downloadable. The object is verified after the write (size
// and SHA-256 read back from storage metadata) before a build is ever reported complete.

import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { nativeArtifactBucket } from './providerRegistry';
import type { MobileArtifactKind } from './types';

export interface ArtifactStore {
  put(objectPath: string, bytes: Buffer, kind: MobileArtifactKind): Promise<{ sizeBytes: number; md5Ok: boolean }>;
  stream(objectPath: string): NodeJS.ReadableStream;
  remove(objectPath: string): Promise<void>;
}

export const CONTENT_TYPE: Record<MobileArtifactKind, string> = {
  apk: 'application/vnd.android.package-archive',
  aab: 'application/octet-stream',
};

/** `mobile-builds/<uid-hash>/<buildId>/<file>` — the user id itself never appears in a storage path. */
export function artifactObjectPath(userId: string, buildId: string, fileName: string): string {
  const owner = createHash('sha256').update(userId).digest('hex').slice(0, 24);
  if (!/^nb_[0-9a-f]{32}$/.test(buildId) || !/^[A-Za-z0-9._-]{1,120}$/.test(fileName)) throw new Error('Invalid artifact path');
  return `mobile-builds/${owner}/${buildId}/${fileName}`;
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
