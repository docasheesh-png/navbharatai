// A chunked upload that survives Cloud Run's load balancer (admin report 2026-08-10, "161 MB zip
// upload nahi ho rahi" → "Unknown or expired upload").
//
// THE BUG THIS EXISTS FOR. zipUpload.ts kept every in-flight upload in a module-level `Map` and wrote
// the bytes to `os.tmpdir()` — both of which live on ONE Cloud Run instance. A 161 MB archive is ~21
// separate HTTP chunk requests, and Cloud Run routes each request independently, so the moment one
// chunk landed on a different instance than `/begin` did, `pending.get(uploadId)` was undefined and the
// user got a 403 "Unknown or expired upload." Nothing was wrong with their file, the size limit (5 GB),
// or the disk.
//
// And it was worse than random: the burst of chunk requests is itself a scale-up trigger, so a BIG
// upload reliably summons the second instance that then breaks it. Small archives (2-3 chunks) fit
// inside one instance and worked, which is exactly why this looked intermittent instead of structural.
//
// It is the same disease as the E2B sandbox reaper fixed earlier this session: per-instance memory used
// as if it were shared state. The cure is the same — put the state somewhere every instance can see.
// The upload RECORD goes to Firestore and each CHUNK becomes its own object in Cloud Storage, so any
// instance can validate ownership and any instance can assemble the file.
//
// FALLS BACK HONESTLY. With no bucket configured (local dev, CI, a self-hosted run) this reports
// unavailable and zipUpload.ts keeps its original single-instance path, which is correct there because
// there IS only one instance. Nothing here changes behaviour in those environments.

import * as admin from 'firebase-admin';
import * as fs from 'node:fs';
import { getServerDb } from './serverDb';

/** Where a chunk object lives. Exported for testing — the ordering below depends on this shape. */
export function chunkObjectPath(uploadId: string, index: number): string {
  // Zero-padded so a plain lexicographic listing is ALSO numeric order. Without the padding, chunk 10
  // sorts before chunk 2 and the assembled archive is silently corrupt — a bug that would look like
  // "the zip is damaged" rather than like an ordering mistake.
  return `zip-uploads/${uploadId}/${String(index).padStart(6, '0')}.part`;
}

/** The durable record — what /chunk and /commit need, from any instance. */
export interface SharedUploadRecord {
  uploadId: string;
  uid: string;
  fileName: string;
  createdAt: number;
  /** Highest chunk index stored so far + 1, maintained best-effort for progress/diagnostics. */
  chunksSeen?: number;
  bytes?: number;
}

const COLLECTION = 'zip_uploads';

function bucketName(): string {
  return (process.env.NAV_STORE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
}

/**
 * Is the cross-instance path available?
 *
 * Requires a bucket AND a real (non-test) runtime. When false the caller keeps its single-instance
 * behaviour, which is the correct behaviour when there is only one instance.
 */
export function sharedUploadsEnabled(): boolean {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false;
  return !!bucketName();
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

/** Record a new upload so every instance can recognise it. Throws so /begin can refuse honestly. */
export async function beginSharedUpload(rec: SharedUploadRecord): Promise<void> {
  const d = db();
  if (!d) throw new Error('shared upload store unavailable');
  await d.collection(COLLECTION).doc(rec.uploadId).set(rec);
}

/** Look up an upload from ANY instance. Null when unknown — the caller turns that into its 403. */
export async function getSharedUpload(uploadId: string): Promise<SharedUploadRecord | null> {
  const d = db();
  if (!d || !uploadId) return null;
  try {
    const snap = await d.collection(COLLECTION).doc(uploadId).get();
    return snap.exists ? (snap.data() as SharedUploadRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Store one chunk as its own object.
 *
 * One object per chunk rather than an append, because object storage has no append — and because it
 * makes a retried chunk idempotent: re-sending index 7 overwrites index 7 instead of duplicating bytes
 * into the middle of the archive, which is what an append-based design would have done.
 */
export async function putSharedChunk(uploadId: string, index: number, bytes: Buffer): Promise<void> {
  const name = bucketName();
  if (!name) throw new Error('no bucket configured');
  await admin.storage().bucket(name).file(chunkObjectPath(uploadId, index)).save(bytes, {
    resumable: false,
    contentType: 'application/octet-stream',
    metadata: { cacheControl: 'private, max-age=0' },
  });
}

/** Note progress on the durable record. Best-effort — losing this never loses the upload. */
export async function noteSharedProgress(uploadId: string, chunksSeen: number, bytes: number): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    await d.collection(COLLECTION).doc(uploadId).set({ chunksSeen, bytes }, { merge: true });
  } catch { /* progress is telemetry, not the upload */ }
}

/**
 * Stream every chunk, IN ORDER, into one local file — the archive the existing extractor reads.
 *
 * Assembly happens inside the single /commit request, so doing it on local disk is safe: no other
 * instance needs to see the result. Every chunk is verified present first, because a silently missing
 * chunk would produce a corrupt archive and a baffling "damaged zip" error instead of a clear failure.
 */
export async function assembleSharedUpload(uploadId: string, totalChunks: number, destPath: string): Promise<number> {
  const name = bucketName();
  if (!name) throw new Error('no bucket configured');
  const bucket = admin.storage().bucket(name);

  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const [exists] = await bucket.file(chunkObjectPath(uploadId, i)).exists();
    if (!exists) missing.push(i);
  }
  if (missing.length) {
    throw new Error(
      `The upload is incomplete — ${missing.length} of ${totalChunks} parts did not arrive `
      + `(first missing: part ${missing[0] + 1}). Please try the import again.`,
    );
  }

  await fs.promises.writeFile(destPath, Buffer.alloc(0));
  let bytes = 0;
  for (let i = 0; i < totalChunks; i++) {
    const [buf] = await bucket.file(chunkObjectPath(uploadId, i)).download();
    await fs.promises.appendFile(destPath, buf);
    bytes += buf.length;
  }
  return bytes;
}

/**
 * Remove the record and every chunk once the upload is committed or abandoned.
 *
 * Best-effort on purpose: a cleanup failure must never fail an import the user already completed. A
 * bucket lifecycle rule on the `zip-uploads/` prefix is the belt to this braces — worth setting so an
 * upload abandoned mid-flight cannot linger and cost storage forever.
 */
export async function deleteSharedUpload(uploadId: string): Promise<void> {
  const name = bucketName();
  if (name) {
    try {
      await admin.storage().bucket(name).deleteFiles({ prefix: `zip-uploads/${uploadId}/` });
    } catch { /* best-effort */ }
  }
  const d = db();
  if (d) {
    try { await d.collection(COLLECTION).doc(uploadId).delete(); } catch { /* best-effort */ }
  }
}
