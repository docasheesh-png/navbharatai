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
import { verifyFirebaseToken, workspaceRateLimiter } from '../lib/authMiddleware';
// STREAMING extraction (admin 2026-08-04, "5 GB, real VS Code jaisa"): the archive is read from DISK
// entry-by-entry — never `readFileSync` + jszip, which held the WHOLE archive in memory and made even
// the old 1 GB cap partly fiction (a 1 GB commit needed ~2-3 GB of RAM). Peak memory is now bounded by
// the kept-content budgets, not the archive size — which is what makes a 5 GB limit REAL.
import { extractZipProjectFromDisk, freeDiskBytes, hasSpaceForUpload } from '../AgentV3/ProjectImportStream';
import { writeWorkspaceFiles } from '../AgentV3/WorkspaceFiles';
import { mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { buildActuator } from './agentv3';
import { importDropSummary } from '../../lib/importDropReport';

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
    res.json({ uploadId, chunkBytes: ZIP_CHUNK_BYTES });
  });

  // ── 2. Chunk: append raw bytes (octet-stream — express.json never parses this) ─────────────
  app.post('/api/zip-upload/chunk', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    const uploadId = String(req.header('X-Upload-Id') || '');
    const index = Number(req.header('X-Chunk-Index'));
    const total = Number(req.header('X-Total-Chunks'));
    const u = pending.get(uploadId);
    if (!uploadOwnedBy(u, uid)) { res.status(403).json({ error: 'Unknown or expired upload.' }); return; }
    if (!validChunkMeta(index, total)) { res.status(400).json({ error: 'Bad chunk metadata.' }); return; }
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
    const u = pending.get(uploadId);
    if (!uploadOwnedBy(u, uid)) { res.status(403).json({ error: 'Unknown or expired upload.' }); return; }
    // Same strict ownership rule the other file-writing routes use: the VERIFIED uid must own this
    // workspace. An import writes files, so it is never reachable by merely knowing a workspace id.
    if (!workspaceId || !workspaceId.startsWith(`agentv3-${uid}-`)) {
      discard(uploadId);
      res.status(403).json({ error: 'This workspace does not belong to you.' });
      return;
    }
    try {
      // From DISK, streaming — never readFileSync: buffering the archive is what made big imports
      // impossible regardless of the advertised cap (see the module comment on ProjectImportStream).
      const extracted = await extractZipProjectFromDisk(u.filePath);
      const files = extracted.files;
      const fileCount = Object.keys(files).length;
      if (fileCount === 0) {
        res.status(422).json({
          error: 'No source files were found in that zip. If it only contains node_modules or build output, zip your source folder instead.',
        });
        return;
      }
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
        fileName: u.fileName,
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
    }
  });

  // ── 4. Abort: let the client clean up a cancelled import immediately ───────────────────────
  app.post('/api/zip-upload/abort', workspaceRateLimiter(), async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : '';
    const u = pending.get(uploadId);
    if (uploadOwnedBy(u, uid)) discard(uploadId);
    res.json({ ok: true });
  });
}
