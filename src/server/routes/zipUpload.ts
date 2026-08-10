// CHUNKED ZIP UPLOAD — how a project bigger than one HTTP request gets in.
//
// ROOT CAUSE (admin report 2026-07-27, "161 MB zip upload nahi ho rahi"): every path that carried a
// zip to the server put the WHOLE archive in ONE request — the v5.0 chat attach base64-encodes it into
// the build JSON (18 MB guard), and `/api/extract-zip` streams it as a single octet-stream body. Cloud
// Run caps ANY single HTTP/1 request at ~32 MB, so a 161 MB zip was unreachable by construction: no
// encoding, no streaming, and no amount of chunking the RESPONSE could ever help. The earlier fix made
// that failure HONEST (a clear message instead of a silent drop) but it did not make the upload WORK.
//
// This route removes the ceiling instead of explaining it: the browser slices the file into small
// chunks, each of which is a normal, well-under-the-cap request; the server appends them to one temp
// file and, on commit, runs the SAME proven `extractZipProject` → `writeWorkspaceFiles` +
// `mergeWorkspaceFiles` pipeline the GitHub import already uses. No new extraction logic, no new
// storage infrastructure, and no IAM/bucket/CORS setup that could be blocked outside this repo.
//
// The uploaded project lands in the WORKSPACE (Files/IDE + the durable store). It deliberately never
// becomes a chat attachment: a project is something you import, not context you hand to a model.

import type { Express, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyFirebaseToken, workspaceRateLimiter, zipChunkRateLimiter } from '../lib/authMiddleware';
// STREAMING extraction (admin 2026-08-04, "5 GB, real VS Code jaisa"): the archive is read from DISK
// entry-by-entry — never `readFileSync` + jszip, which held the WHOLE archive in memory and made even
// the old 1 GB cap partly fiction (a 1 GB commit needed ~2-3 GB of RAM). Peak memory is now bounded by
// the kept-content budgets, not the archive size — which is what makes a 5 GB limit REAL.
import { extractZipProjectFromDisk, freeDiskBytes, hasSpaceForUpload } from '../AgentV3/ProjectImportStream';
import { writeWorkspaceFiles } from '../AgentV3/WorkspaceFiles';
import { mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';

import { importDropSummary } from '../../lib/importDropReport';
// CROSS-INSTANCE upload state — the fix for "Unknown or expired upload" on a big archive.
// See zipUploadStore.ts: the record lives in Firestore and each chunk is its own object, so a
// chunk that lands on a different Cloud Run instance than /begin still finds its upload.
import {
  sharedUploadsEnabled, beginSharedUpload, getSharedUpload, putSharedChunk,
  noteSharedProgress, assembleSharedUpload, deleteSharedUpload,
} from '../lib/zipUploadStore';
import { ownedByVerifiedUid } from '../lib/workspaceIdentity';

/** One chunk stays far under Cloud Run's ~32 MB request cap even with protocol overhead. */
export const ZIP_CHUNK_BYTES = 8 * 1024 * 1024;
/**
 * Total assembled archive ceiling. 5 GB (admin 2026-08-04) — real because commit streams from disk
 * instead of buffering the archive. The begin-time preflight below checks the temp filesystem actually
 * HAS this much room and refuses honestly when it does not, so a big upload fails in one second with a
 * real reason instead of dying at 90% — or worse, wedging the instance by filling its disk.
 */
export const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
/** An abandoned upload is swept after this long. */
const UPLOAD_TTL_MS = 30 * 60 * 1000;

interface PendingUpload {
  uid: string;
  filePath: string;
  bytes: number;
  createdAt: number;
  fileName: string;
}

const pending = new Map<string, PendingUpload>();

/** An upload id is ours, well-formed, and owned by this caller. PURE (given the map). */
export function uploadOwnedBy(u: PendingUpload | undefined, uid: string | null): u is PendingUpload {
  return !!u && !!uid && u.uid === uid;
}

/** Chunk index/count sanity — rejects NaN, negatives, and absurd counts. PURE. */
export function validChunkMeta(index: number, total: number): boolean {
  return Number.isInteger(index) && Number.isInteger(total)
    && total > 0 && total <= 100_000 && index >= 0 && index < total;
}

function sweepExpired(now: number): void {
  for (const [id, u] of pending) {
    if (now - u.createdAt > UPLOAD_TTL_MS) {
      try { fs.unlinkSync(u.filePath); } catch { /* already gone */ }
      pending.delete(id);
    }
  }
}

function discard(id: string): void {
  const u = pending.get(id);
  if (!u) return;
  try { fs.unlinkSync(u.filePath); } catch { /* already gone */ }
  pending.delete(id);
}

/**
 * Hand an assembled upload to another route that wants the RAW BYTES (rather than a zip extraction).
 *
 * ROOT CAUSE this exists for (2026-07-28): the Nav App Store advertises a 150 MB APK limit
 * (`MAX_APK_BYTES`, surfaced to users as `maxSizeMb`) but ships the file as `apkBase64` inside a JSON
 * body — so ~24 MB is the real ceiling and everything above it dies against the platform cap BEFORE
 * the route's own honest 413 can run. The advertised number was fiction. Rather than duplicate the
 * chunked transport, the store now claims the assembled file here.
 *
 * Claiming REMOVES the upload from the pending map: the caller owns the temp file and must delete it.
 * Returns null when the id is unknown/expired or the caller is not its uploader.
 */
export function claimUpload(uploadId: string, uid: string | null): { filePath: string; fileName: string; bytes: number } | null {
  const u = pending.get(uploadId);
  if (!uploadOwnedBy(u, uid)) return null;
  pending.delete(uploadId); // ownership transfers to the caller (which deletes it)
  return { filePath: u.filePath, fileName: u.fileName, bytes: u.bytes };
}

export function registerZipUploadRoutes(app: Express): void {
  // ── 1. Begin: mint an upload id + temp file ────────────────────────────────────────────────
  app.post('/api/zip-upload/begin', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in to import a project.' }); return; }
    sweepExpired(Date.now());
    const rawName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'project.zip';
    const fileName = rawName.replace(/[^\w.\- ]/g, '').slice(0, 120) || 'project.zip';
    // DECLARED size, when the client sends it: lets the ceiling and the disk preflight run BEFORE any
    // bytes move. A client that omits it still gets the mid-stream ceiling enforcement on every chunk.
    const declaredBytes = Number(req.body?.fileSize);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_ARCHIVE_BYTES) {
      res.status(413).json({ error: `This file is ${(declaredBytes / (1024 ** 3)).toFixed(1)} GB — larger than the ${Math.round(MAX_ARCHIVE_BYTES / (1024 ** 3))} GB import limit. Remove node_modules/build folders and media from the zip; the source itself is never this big.` });
      return;
    }
    if (Number.isFinite(declaredBytes) && declaredBytes > 0) {
      const free = freeDiskBytes(os.tmpdir());
      if (!hasSpaceForUpload(free, declaredBytes)) {
        // Admin-visible evidence (Cloud Run logs): the refusal with its REAL numbers, so a "uploads
        // are failing" report is diagnosable without guessing which branch fired.
        console.warn(`[zip-upload] begin REFUSED: declared ${(declaredBytes / (1024 ** 2)).toFixed(1)} MB, free tmp ${free !== null ? (free / (1024 ** 2)).toFixed(1) : '?'} MB`);
        const mb = declaredBytes / (1024 ** 2);
        // With scaled headroom a refusal means the disk genuinely lacks room for THIS file. For a big
        // archive, shrinking it is real advice; for a small one it is not — say what is actually wrong.
        res.status(507).json({ error: mb > 512
          ? `The server does not have enough free space for a ${(mb / 1024).toFixed(1)} GB upload right now (${free !== null ? (free / (1024 ** 3)).toFixed(1) : '?'} GB free). Removing node_modules, build output and media from the zip usually shrinks it dramatically.`
          : `The server is temporarily low on working space and cannot receive a ${mb.toFixed(0)} MB upload right now. Please try again in a minute.` });
        return;
      }
    }
    const uploadId = randomUUID();
    const filePath = path.join(os.tmpdir(), `nbai-zip-${uploadId}.zip`);
    try {
      fs.writeFileSync(filePath, Buffer.alloc(0));
    } catch {
      res.status(503).json({ error: 'Could not start the upload. Please try again.' });
      return;
    }
    pending.set(uploadId, { uid, filePath, bytes: 0, createdAt: Date.now(), fileName });
    // ALSO record it where every instance can see it. Cloud Run routes each of the ~21 chunk requests
    // of a 161 MB upload independently, so the in-memory map above is only ever a fast local cache —
    // it is this record that makes a chunk landing on another instance work instead of 403-ing.
    if (sharedUploadsEnabled()) {
      try {
        await beginSharedUpload({ uploadId, uid, fileName, createdAt: Date.now(), chunksSeen: 0, bytes: 0 });
      } catch {
        // No shared store ⇒ we would be back to the single-instance behaviour that fails at random on
        // a big file. Refusing here is honest; silently continuing would look like it worked until the
        // upload died at 40%.
        res.status(503).json({ error: 'Could not start the upload right now. Please try again in a moment.' });
        return;
      }
    }
    res.json({ uploadId, chunkBytes: ZIP_CHUNK_BYTES });
  });

  // ── 2. Chunk: append raw bytes (octet-stream — express.json never parses this) ─────────────
  // zipChunkRateLimiter, NOT workspaceRateLimiter: a 5 GB import is 640 chunk requests and the shared
  // 60/hr workspace bucket capped it at ~470 MB (see ZIP_CHUNK_RATE for the full root cause).
  app.post('/api/zip-upload/chunk', zipChunkRateLimiter(), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    const uploadId = String(req.header('X-Upload-Id') || '');
    const index = Number(req.header('X-Chunk-Index'));
    const total = Number(req.header('X-Total-Chunks'));
    if (!validChunkMeta(index, total)) { res.status(400).json({ error: 'Bad chunk metadata.' }); return; }

    // SHARED PATH — the one that makes a multi-chunk upload work at all on Cloud Run. The chunk is
    // buffered and written to its own object, so it does not matter which instance served /begin.
    if (sharedUploadsEnabled()) {
      const rec = await getSharedUpload(uploadId);
      if (!rec || !uid || rec.uid !== uid) { res.status(403).json({ error: 'Unknown or expired upload.' }); return; }
      try {
        const parts: Buffer[] = [];
        let received = 0;
        let tooBig = false;
        await new Promise<void>((resolve, reject) => {
          req.on('data', (d: Buffer) => {
            received += d.length;
            // One chunk is bounded by the client's slice size; this only guards a malformed caller.
            if (!tooBig && received > ZIP_CHUNK_BYTES * 4) { tooBig = true; req.destroy(); return; }
            parts.push(d);
          });
          req.on('end', resolve);
          req.on('error', reject);
        });
        if (tooBig) { res.status(413).json({ error: 'That chunk is larger than the upload protocol allows.' }); return; }
        const soFar = (rec.bytes ?? 0) + received;
        if (soFar > MAX_ARCHIVE_BYTES) {
          await deleteSharedUpload(uploadId);
          res.status(413).json({ error: `This project is larger than the ${Math.round(MAX_ARCHIVE_BYTES / (1024 ** 3))} GB import limit.` });
          return;
        }
        await putSharedChunk(uploadId, index, Buffer.concat(parts));
        // Re-sending a chunk overwrites the same object, so `bytes` is a progress signal rather than a
        // ledger — the authoritative total is measured at assembly time.
        await noteSharedProgress(uploadId, Math.max(rec.chunksSeen ?? 0, index + 1), soFar);
        res.json({ ok: true, received: soFar });
      } catch {
        res.status(500).json({ error: 'Chunk upload failed. Please try the import again.' });
      }
      return;
    }

    const u = pending.get(uploadId);
    if (!uploadOwnedBy(u, uid)) { res.status(403).json({ error: 'Unknown or expired upload.' }); return; }
    try {
      const ws = fs.createWriteStream(u.filePath, { flags: 'a' });
      let received = 0;
      let aborted = false;
      await new Promise<void>((resolve, reject) => {
        req.on('data', (d: Buffer) => {
          received += d.length;
          // Enforce the ceiling MID-STREAM so a runaway upload can't fill the disk first.
          if (!aborted && u.bytes + received > MAX_ARCHIVE_BYTES) { aborted = true; req.destroy(); }
        });
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });
      if (aborted) {
        discard(uploadId);
        res.status(413).json({ error: `This project is larger than the ${Math.round(MAX_ARCHIVE_BYTES / (1024 ** 3))} GB import limit.` });
        return;
      }
      u.bytes += received;
      res.json({ ok: true, received: u.bytes });
    } catch {
      discard(uploadId);
      res.status(500).json({ error: 'Chunk upload failed. Please try the import again.' });
    }
  });

  // ── 3. Commit: extract + land into the workspace (the proven import pipeline) ──────────────
  //
  // Landing happens SERVER-SIDE on purpose. Returning a 161 MB project's file map to the browser so
  // it could POST it back would re-create the very ceiling this route exists to remove — the response
  // and the follow-up request are both capped the same way. So commit writes straight into the
  // sandbox + durable store (exactly what /api/agentv3/import-files does) and returns only counts and
  // paths, which stay small for any project.
  app.post('/api/zip-upload/commit', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : '';
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    // Resolve the upload from whichever store owns it. In shared mode the record is durable, so this
    // works on any instance; otherwise it is the original in-memory map.
    const shared = sharedUploadsEnabled() ? await getSharedUpload(uploadId) : null;
    const u = pending.get(uploadId);
    const ownsShared = !!shared && !!uid && shared.uid === uid;
    if (!ownsShared && !uploadOwnedBy(u, uid)) { res.status(403).json({ error: 'Unknown or expired upload.' }); return; }
    // Same strict ownership rule the other file-writing routes use: the VERIFIED uid must own this
    // workspace. An import writes files, so it is never reachable by merely knowing a workspace id.
    if (!ownedByVerifiedUid(uid, workspaceId)) {
      discard(uploadId);
      if (ownsShared) await deleteSharedUpload(uploadId);
      res.status(403).json({ error: 'This workspace does not belong to you.' });
      return;
    }
    // Assemble the chunk objects into one local archive — in index order, with every part verified
    // present first, so a lost chunk fails with a clear reason instead of producing a corrupt zip.
    let archivePath = u?.filePath ?? '';
    if (ownsShared) {
      const totalChunks = Number(req.body?.totalChunks);
      if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
        res.status(400).json({ error: 'The import is missing its part count. Please try again.' });
        return;
      }
      archivePath = path.join(os.tmpdir(), `nbai-zip-${uploadId}.zip`);
      try {
        await assembleSharedUpload(uploadId, totalChunks, archivePath);
      } catch (err) {
        await deleteSharedUpload(uploadId);
        try { fs.unlinkSync(archivePath); } catch { /* best-effort */ }
        res.status(422).json({ error: err instanceof Error ? err.message : 'The upload could not be assembled. Please try again.' });
        return;
      }
    }
    try {
      // From DISK, streaming — never readFileSync: buffering the archive is what made big imports
      // impossible regardless of the advertised cap (see the module comment on ProjectImportStream).
      const extracted = await extractZipProjectFromDisk(archivePath);
      const files = extracted.files;
      const fileCount = Object.keys(files).length;
      if (fileCount === 0) {
        res.status(422).json({
          error: 'No source files were found in that zip. If it only contains node_modules or build output, zip your source folder instead.',
        });
        return;
      }
      // LAZY, and deliberately so (2026-08-06). The actuator classes pull the sandbox SDKs, ~1.5s of
      // import work that this route needs only when someone actually finishes an upload. Loading it at
      // module scope charged that to every server boot on a path that has nothing to do with building.
      // Same module, so still the same process-wide singleton — a second instance would hand a
      // session's next message a cold, empty sandbox.
      const { buildActuator } = await import('./actuatorFactory');
      const actuator = buildActuator();
      // 'import' type starts the sandbox EMPTY so the user's app never gets scaffold files mixed in.
      try { await actuator.ensureWorkspace(workspaceId, 'import'); } catch { /* reuse existing sandbox */ }
      const { written, skipped } = await writeWorkspaceFiles(actuator, workspaceId, files);
      // Durable persist — without this the import lives only in an ephemeral sandbox and vanishes.
      try { await mergeWorkspaceFiles(workspaceId, files); } catch { /* best-effort, mirrors import-files */ }
      // HONEST OUTCOME (admin 2026-08-04). The extractor already counts every refusal in eight labelled
      // categories, and this response used to discard all of it — so a media-heavy 1 GB project reported
      // a green "Imported 400 files" while 3,600 were silently gone. The counts and the archive's real
      // entry total now travel to the client, which states them. `writeWorkspaceFiles`' own `skipped` is
      // folded in under `overCap` (a file that extracted fine but could not be landed is still a file the
      // user does not have).
      const dropped = { ...extracted.dropped, overCap: (extracted.dropped?.overCap ?? 0) + skipped.length };
      res.json({
        ok: true,
        fileName: shared?.fileName ?? u?.fileName ?? 'project.zip',
        fileCount,
        imported: written.length,
        skipped: skipped.length,
        dropped,
        totalEntries: extracted.totalEntries,
        summary: importDropSummary({ kept: written.length, totalEntries: extracted.totalEntries, dropped }),
        paths: written.slice(0, 5000),
      });
    } catch (err: any) {
      res.status(422).json({ error: err?.message || 'That file could not be read as a zip archive.' });
    } finally {
      discard(uploadId); // the temp archive is never kept past a commit attempt
      if (ownsShared) {
        // The chunk objects have done their job. Best-effort: a cleanup failure must never fail an
        // import the user already completed — a bucket lifecycle rule on `zip-uploads/` is the backstop.
        await deleteSharedUpload(uploadId);
        try { fs.unlinkSync(archivePath); } catch { /* best-effort */ }
      }
    }
  });

  // ── 4. Abort: let the client clean up a cancelled import immediately ───────────────────────
  app.post('/api/zip-upload/abort', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : '';
    const u = pending.get(uploadId);
    if (uploadOwnedBy(u, uid)) discard(uploadId);
    // A cancelled upload must also release its chunk objects, or an abandoned 161 MB import would sit
    // in the bucket costing storage until a lifecycle rule swept it.
    if (sharedUploadsEnabled()) {
      const rec = await getSharedUpload(uploadId);
      if (rec && uid && rec.uid === uid) await deleteSharedUpload(uploadId);
    }
    res.json({ ok: true });
  });
}
