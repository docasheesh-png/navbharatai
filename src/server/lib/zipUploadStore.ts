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
  // Starting an upload is also when abandoned ones are reaped (Q-3613), at most once per interval per instance.
  maybeSweepAbandonedZipUploads();
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
    // An UPDATE, never a merge-set: progress on an upload that does not exist must not MINT an upload
    // record with no owner (the DeploymentStore.setStatus class, 2026-09-18).
    await d.collection(COLLECTION).doc(uploadId).update({ chunksSeen, bytes });
  } catch { /* progress is telemetry, not the upload */ }
}

/**
 * Is this assembly inside the 5 GB ceiling?
 *
 * Two checks, both on ACTUAL numbers rather than the client's claim:
 *  - `totalChunks` cannot exceed `ceil(maxBytes / chunkBytes)` (640 parts at the real constants).
 *  - the sum of the part sizes cannot exceed `maxBytes`. A retried index is one part, so the sum
 *    does not double-count it — the caller passes one size per index.
 *
 * PURE.
 */
export function sharedAssemblyAllowed(
  totalChunks: number,
  partSizes: number[],
  maxBytes: number,
  chunkBytes: number,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(totalChunks) || totalChunks <= 0) return { ok: false, reason: 'bad total' };
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isFinite(chunkBytes) || chunkBytes <= 0) {
    return { ok: false, reason: 'bad ceiling' };
  }
  if (totalChunks > Math.ceil(maxBytes / chunkBytes)) return { ok: false, reason: 'too many parts' };
  let sum = 0;
  for (const n of partSizes) {
    if (!Number.isFinite(n) || n < 0) return { ok: false, reason: 'bad size' };
    sum += n;
  }
  if (sum > maxBytes) return { ok: false, reason: 'too big' };
  return { ok: true };
}

/**
 * Stream every chunk, IN ORDER, into one local file — the archive the existing extractor reads.
 *
 * Assembly happens inside the single /commit request, so doing it on local disk is safe: no other
 * instance needs to see the result. Every chunk is verified present first, because a silently missing
 * chunk would produce a corrupt archive and a baffling "damaged zip" error instead of a clear failure.
 *
 * The 5 GB ceiling is enforced HERE, from the objects' actual sizes, not from the progress counter
 * (which a retried chunk would inflate). `limits` defaults to the same 5 GB / 8 MB constants the
 * route exports, so a caller that forgets them still cannot assemble past the ceiling.
 */
export async function assembleSharedUpload(
  uploadId: string,
  totalChunks: number,
  destPath: string,
  limits?: { maxBytes: number; chunkBytes: number },
): Promise<number> {
  const name = bucketName();
  if (!name) throw new Error('no bucket configured');
  const bucket = admin.storage().bucket(name);
  const maxBytes = limits?.maxBytes ?? 5 * 1024 * 1024 * 1024;
  const chunkBytes = limits?.chunkBytes ?? 8 * 1024 * 1024;

  const missing: number[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const file = bucket.file(chunkObjectPath(uploadId, i));
    const [exists] = await file.exists();
    if (!exists) missing.push(i);
    else {
      const [meta] = await file.getMetadata();
      sizes.push(Number(meta.size ?? 0));
    }
  }
  if (missing.length) {
    throw new Error(
      `The upload is incomplete — ${missing.length} of ${totalChunks} parts did not arrive `
      + `(first missing: part ${missing[0] + 1}). Please try the import again.`,
    );
  }
  const verdict = sharedAssemblyAllowed(totalChunks, sizes, maxBytes, chunkBytes);
  if (!verdict.ok) {
    throw new Error(`This project is larger than the ${Math.round(maxBytes / (1024 ** 3))} GB import limit.`);
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

// ─────────────────────── Account deletion and the abandoned-upload sweep (Q-3613) ───────────────────────
//
// 🔴 THE CLASS (Q-3410's): chunks are keyed by the upload id, not by their owner, so the ONLY thing that can find a
// user's chunks is their `zip_uploads` record — and account deletion erases that record (`deleteUserData`, by `uid`).
// An upload abandoned mid-flight therefore outlived its owner's account for ever. Two layers close it:
//   1. `eraseUserZipUploadChunks` runs BEFORE the records are erased and deletes each record's chunk folder first,
//      then the record — the pointer goes only after the bytes it points at.
//   2. `sweepAbandonedZipUploads` is the backstop for whatever layer 1 could not confirm (and for uploads abandoned
//      by people who keep their account): a chunk folder whose record is gone, or whose record is older than
//      ZIP_UPLOAD_ABANDONED_MS, is deleted. A chunk can never precede its record (/begin writes the record before it
//      returns the upload id), so a folder without a record is never an upload in flight.

/** A real upload id (`randomUUID()` in /begin). Anything else is never turned into a delete prefix. */
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isZipUploadId(v: unknown): v is string { return typeof v === 'string' && UPLOAD_ID.test(v); }

/** An upload older than this is abandoned: no import legitimately spans two days between /begin and /commit. */
export const ZIP_UPLOAD_ABANDONED_MS = 48 * 60 * 60 * 1000;

/** What the eraser and the sweep need. firebase-admin in production; a fake in tests. Every method THROWS on failure. */
export interface ZipUploadCleanupDeps {
  /** The `zip_uploads` records with `uid == uid`. */
  listOwnedUploads(uid: string): Promise<SharedUploadRecord[]>;
  /** The record for one upload id, or null when it does not exist. Throws when the store could not answer. */
  getRecord(uploadId: string): Promise<SharedUploadRecord | null>;
  /** The upload ids that have a chunk folder (`zip-uploads/<id>/`). */
  listChunkFolders(): Promise<string[]>;
  deleteChunks(uploadId: string): Promise<void>;
  deleteRecord(uploadId: string): Promise<void>;
}

/** The production dependencies, or null when the bucket or Firestore is not configured. */
export function liveZipUploadCleanupDeps(): ZipUploadCleanupDeps | null {
  const name = bucketName();
  const d = db();
  if (!name || !d) return null;
  const bucket = () => admin.storage().bucket(name);
  return {
    async listOwnedUploads(uid) {
      const snap = await d.collection(COLLECTION).where('uid', '==', uid).get();
      return snap.docs.map((doc) => ({ ...(doc.data() as SharedUploadRecord), uploadId: doc.id }));
    },
    async getRecord(uploadId) {
      const snap = await d.collection(COLLECTION).doc(uploadId).get();
      return snap.exists ? ({ ...(snap.data() as SharedUploadRecord), uploadId }) : null;
    },
    async listChunkFolders() {
      const [, , api] = await bucket().getFiles({ prefix: 'zip-uploads/', delimiter: '/', autoPaginate: false, maxResults: 1000 });
      const prefixes = (api as { prefixes?: unknown } | undefined)?.prefixes;
      return Array.isArray(prefixes)
        ? prefixes.filter((p): p is string => typeof p === 'string').map((p) => p.slice('zip-uploads/'.length).replace(/\/$/, ''))
        : [];
    },
    async deleteChunks(uploadId) {
      if (!isZipUploadId(uploadId)) throw new Error('Refusing to delete outside one upload folder');
      await bucket().deleteFiles({ prefix: `zip-uploads/${uploadId}/`, force: true });
    },
    async deleteRecord(uploadId) { await d.collection(COLLECTION).doc(uploadId).delete(); },
  };
}

export interface ZipUploadEraseReport {
  attempted: boolean;
  /** Every upload of this owner had its chunks confirmed deleted. */
  chunksRemoved: boolean;
  /** Uploads whose chunk folder was deleted (their record was then deleted too). */
  uploadsCleared: number;
  failures: string[];
}

/**
 * DELETE /api/profile's step for zip-upload chunks (Q-3613). MUST run BEFORE `deleteUserData` erases the `zip_uploads`
 * records: each record is the only pointer to its chunks. For every record owned by `verifiedUid` (the deletion
 * route's VERIFIED identity, re-checked on the record): delete the chunk folder, then the record. A failure is
 * reported as a failure, never as a removal; its folder is left for the abandoned-upload sweep. Never throws.
 */
export async function eraseUserZipUploadChunks(
  verifiedUid: string,
  deps: ZipUploadCleanupDeps | null = liveZipUploadCleanupDeps(),
): Promise<ZipUploadEraseReport> {
  const report: ZipUploadEraseReport = { attempted: false, chunksRemoved: false, uploadsCleared: 0, failures: [] };
  if (!verifiedUid || typeof verifiedUid !== 'string') return { ...report, failures: ['No usable account id: zip uploads could not be selected for removal.'] };
  if (!deps) return { ...report, failures: ['Zip upload storage is not configured; removal of unfinished uploads could not be confirmed.'] };
  let uploads: SharedUploadRecord[];
  try { uploads = await deps.listOwnedUploads(verifiedUid); } catch {
    return { ...report, attempted: true, failures: ['Your unfinished zip uploads could not be listed; their removal could not be confirmed.'] };
  }
  report.attempted = true;
  let failed = 0;
  let refused = 0;
  for (const rec of uploads) {
    if (rec.uid !== verifiedUid) continue;
    if (!isZipUploadId(rec.uploadId)) { refused++; continue; }
    try {
      await deps.deleteChunks(rec.uploadId);
    } catch { failed++; continue; }
    report.uploadsCleared++;
    // The bytes are gone; the record that pointed at them may go now. If this fails, `deleteUserData` still erases it.
    try { await deps.deleteRecord(rec.uploadId); } catch { /* the record holds no bytes any more */ }
  }
  if (failed) report.failures.push(`${failed} unfinished zip upload(s) could not be confirmed removed; a later cleanup deletes parts whose upload record is gone.`);
  if (refused) report.failures.push(`${refused} zip upload record(s) had an id that is not a real upload id; their parts were not touched and need review.`);
  report.chunksRemoved = report.failures.length === 0;
  return report;
}

/**
 * Delete every chunk folder that no live upload owns: its record is gone (committed, cleaned up, or erased with an
 * account) or older than ZIP_UPLOAD_ABANDONED_MS. A record that cannot be read is NOT treated as gone. Returns the
 * upload ids whose chunks were deleted. Never throws.
 */
export async function sweepAbandonedZipUploads(deps: ZipUploadCleanupDeps, nowMs = Date.now()): Promise<string[]> {
  let folders: string[];
  try { folders = await deps.listChunkFolders(); } catch { return []; }
  const swept: string[] = [];
  for (const id of folders) {
    if (!isZipUploadId(id)) continue;
    let rec: SharedUploadRecord | null;
    try { rec = await deps.getRecord(id); } catch { continue; }
    if (rec && !(Number.isFinite(rec.createdAt) && nowMs - rec.createdAt > ZIP_UPLOAD_ABANDONED_MS)) continue;
    try {
      await deps.deleteChunks(id);
      if (rec) await deps.deleteRecord(id);
      swept.push(id);
    } catch { /* the next sweep tries again */ }
  }
  return swept;
}

const SWEEP_EVERY_MS = 60 * 60 * 1000;
let lastZipSweepAt = 0;
/** The sweep, at most once per hour on this instance, in the background. Never throws. */
export function maybeSweepAbandonedZipUploads(
  deps: ZipUploadCleanupDeps | null = liveZipUploadCleanupDeps(),
  nowMs = Date.now(),
): boolean {
  if (!deps || nowMs - lastZipSweepAt < SWEEP_EVERY_MS) return false;
  lastZipSweepAt = nowMs;
  void sweepAbandonedZipUploads(deps, nowMs).catch(() => { lastZipSweepAt = 0; });
  return true;
}
export function __resetZipUploadSweepForTests(): void { lastZipSweepAt = 0; }
