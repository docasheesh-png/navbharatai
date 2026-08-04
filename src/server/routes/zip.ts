import fs from 'fs';
import { setCorsHeaders } from '../lib/cors';
// LARGE-FILE SOURCE (admin 2026-08-04): this route's yauzl extraction already STREAMS from a temp file
// — its only ceiling was the transport, because the archive arrived as ONE request body and the
// platform caps any single request at ~32 MB. With X-Upload-Id the client first moves the file through
// the chunked uploader (every request well under the cap, up to 5 GB), and this route CLAIMS the
// assembled temp file instead of reading a body. Same extraction, same SSE stream — the ceiling gone.
import { claimUpload } from './zipUpload';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import path from 'path';
import crypto from 'crypto';
import type { Express, Request, Response, RequestHandler } from 'express';

/** No-op middleware used when no rate limiter is injected (e.g. unit tests). */
const passthrough: RequestHandler = (_req, _res, next) => next();

/**
 * SECURITY — true when a zip entry path escapes the extraction root: an absolute path (`/etc/…`), a
 * Windows drive path (`C:\…`), or any `..` segment (`../../etc/passwd`). Backslashes are normalised
 * first so `..\..\` is caught too. Pure + unit-tested. (Same rule as ProjectImport.safeImportPath,
 * inlined to keep this yauzl route free of the jszip import chain.)
 */
export function isTraversalPath(p: string): boolean {
  const s = String(p || '').replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return true;
  return s.split('/').some((seg) => seg === '..');
}

/**
 * ZIP import/export routes extracted from the server.ts monolith (Phase 1).
 * Self-contained — uses fs/path/crypto + yauzl (extract) and zip-stream (download).
 * Behavior unchanged.
 *
 * - POST /api/extract-zip  — stream-extract an uploaded ZIP into a file map (SSE)
 * - POST /api/download-zip — package a file map into a downloadable ZIP
 */
export function registerZipRoutes(app: Express, limiter: RequestHandler = passthrough): void {
  app.post('/api/extract-zip', limiter, async (req: Request, res: Response) => {
    const fileName = req.headers['x-file-name']
      ? decodeURIComponent(String(req.headers['x-file-name']))
      : 'upload.zip';

    const os = await import('os');
    const tmpId = (crypto as any).randomBytes(8).toString('hex');
    let tmpZip = path.join(os.default.tmpdir(), `nbt-${tmpId}.zip`);

    // ── Chunk-uploaded source? Claim the assembled file instead of reading a request body. ──
    // Ownership is enforced by claimUpload (the VERIFIED uid must be the uploader), so a large import
    // requires sign-in; the direct-body path below stays available to small anonymous uploads.
    const uploadId = String(req.headers['x-upload-id'] || '');
    let claimedSource = false;
    if (uploadId) {
      const uid = await verifyFirebaseToken(req);
      const claimed = claimUpload(uploadId, uid);
      if (!claimed) {
        res.status(403).json({ error: 'Unknown or expired upload — please retry the import.' });
        return;
      }
      tmpZip = claimed.filePath;
      claimedSource = true;
    }

    // Assets embedded as base64 data-URLs so the preview can use them directly (images + web fonts)
    const ASSET_MIME: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
      '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
      // Media + documents the universal preview viewer can render natively (within size caps).
      '.pdf': 'application/pdf',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
      '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
    };
    // True binaries that are NOT editable and NOT renderable in a browser preview — skipped.
    // (PDF/audio/video are handled as renderable assets above, not skipped.)
    const BINARY_SKIP = new Set([
      '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.wasm', '.node', '.pyc',
      '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2', '.xz', '.jar', '.war',
      '.avi', '.flv', '.wmv', '.wma',
      '.psd', '.ai', '.sketch', '.fig', '.xd', '.blend',
      '.db', '.sqlite', '.sqlite3', '.mdb', '.dat',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    ]);
    // Skip dependency/build-cache/VCS/IDE dirs (generated, not user source). Keep dist/build/out
    // so a user can upload a built static site and preview it.
    const SKIP_RE = /(?:^|\/)(node_modules|\.git|\.svn|\.hg|\.next|\.nuxt|\.svelte-kit|__pycache__|\.cache|\.turbo|\.parcel-cache|\.pytest_cache|\.gradle|\.idea|\.vscode|\.DS_Store|Thumbs\.db)(?:\/|$)/i;
    // Caps to protect the browser from runaway imports (still high enough to load whole apps)
    const MAX_FILES = 4000;
    const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // 120 MB of decoded content
    let totalBytes = 0;

    try {
      // ── Step 1: Stream raw binary body to disk — skipped when the file arrived via chunks ──────
      if (!claimedSource) {
        await new Promise<void>((resolve, reject) => {
          const ws = fs.createWriteStream(tmpZip);
          req.pipe(ws);
          ws.on('finish', resolve);
          ws.on('error', reject);
          req.on('error', reject);
        });
      }

      const zipSize = fs.statSync(tmpZip).size;
      console.log(`[extract-zip] ${fileName} received: ${(zipSize / 1024 / 1024).toFixed(1)} MB`);

      // ── Step 2: SSE response setup ─────────────────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      setCorsHeaders(req, res);
      res.flushHeaders();
      const send = (data: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

      send({ type: 'progress', stage: `Scanning ZIP (${(zipSize / 1024 / 1024).toFixed(1)} MB)...`, percent: 5 });

      // ── Step 3: yauzl streaming extraction ─────────────────────────────────
      const yauzl = require('yauzl');
      let fileCount = 0;
      let htmlContent = '';
      let prefixToStrip = '';   // auto-detect single root folder
      let prefixChecked = false;

      await new Promise<void>((resolve, reject) => {
        yauzl.open(tmpZip, { lazyEntries: true, autoClose: true }, (err: any, zipfile: any) => {
          if (err) return reject(new Error(`Invalid ZIP: ${err.message}`));

          // Continue to the next entry — wrapped so a readEntry() throw can't kill the stream
          const next = () => { try { zipfile.readEntry(); } catch { resolve(); } };

          zipfile.readEntry();

          zipfile.on('entry', (entry: any) => {
            // Per-entry crash isolation: ONE bad file must never abort the whole import
            try {
              const rawPath = String(entry.fileName || '').replace(/\\/g, '/');

              // Auto-detect and strip single root folder (e.g., myapp-main/ from GitHub)
              if (!prefixChecked) {
                prefixChecked = true;
                const firstSlash = rawPath.indexOf('/');
                if (firstSlash > 0 && !rawPath.slice(0, firstSlash).includes('.')) {
                  prefixToStrip = rawPath.slice(0, firstSlash + 1);
                }
              }

              const entryPath = (prefixToStrip && rawPath.startsWith(prefixToStrip))
                ? rawPath.slice(prefixToStrip.length) : rawPath;

              // SECURITY (SEC Phase 5 — traversal rejection at the source): refuse any entry whose
              // path escapes the extraction root — a `..` segment or an absolute/drive path
              // (`../../etc/passwd`, `/etc/passwd`, `C:\…`). Downstream sinks already re-sanitize, but
              // this route emitted the raw traversal path to the client; rejecting it here means the
              // hostile path never leaves the parser. Mirrors safeImportPath's rule (kept inline to
              // avoid importing the jszip-heavy ProjectImport module into this yauzl route).
              if (isTraversalPath(entryPath)) { send({ type: 'skipped', path: entryPath, reason: 'unsafe path' }); next(); return; }

              // Skip empty paths, directories, and unwanted folders (node_modules/.git/etc.)
              if (!entryPath || entryPath.endsWith('/') || SKIP_RE.test('/' + rawPath)) { next(); return; }

              // Stop accepting more once caps are hit (protects the browser)
              if (fileCount >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { next(); return; }

              const ext = path.extname(entryPath).toLowerCase();
              const assetMime = ASSET_MIME[ext];
              const isAsset = !!assetMime;

              // Skip only true binaries — EVERYTHING else is treated as editable text
              if (!isAsset && BINARY_SKIP.has(ext)) { send({ type: 'skipped', path: entryPath, reason: 'binary' }); next(); return; }

              // Per-file size limits: 16 MB assets (images/media/pdf), 5 MB text. Caps keep the
              // browser preview safe — a single inlined data-URL beyond this would risk a crash.
              const maxBytes = isAsset ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
              if (typeof entry.uncompressedSize === 'number' && entry.uncompressedSize > maxBytes) {
                send({ type: 'skipped', path: entryPath, reason: 'too large' });
                next();
                return;
              }

              zipfile.openReadStream(entry, (streamErr: any, readStream: any) => {
                if (streamErr || !readStream) { next(); return; }
                const chunks: Buffer[] = [];
                let aborted = false;
                readStream.on('data', (c: Buffer) => {
                  chunks.push(c);
                  // Guard against lying uncompressedSize — abort if a single file blows the limit
                  if (!aborted && chunks.reduce((n, b) => n + b.length, 0) > maxBytes) {
                    aborted = true;
                    try { readStream.destroy(); } catch { /* ignore */ }
                    send({ type: 'skipped', path: entryPath, reason: 'too large' });
                    next();
                  }
                });
                readStream.on('error', () => { if (!aborted) { aborted = true; next(); } });
                readStream.on('end', () => {
                  if (aborted) return;
                  try {
                    const buf = Buffer.concat(chunks);
                    // Binary-sniff: if a non-asset file is actually binary (has NUL bytes), embed as data-URL instead of garbled text
                    let content: string;
                    if (isAsset) {
                      content = `data:${assetMime};base64,${buf.toString('base64')}`;
                    } else if (buf.includes(0)) {
                      content = `data:application/octet-stream;base64,${buf.toString('base64')}`;
                    } else {
                      content = buf.toString('utf8');
                    }

                    totalBytes += content.length;
                    if (entryPath === 'index.html' || entryPath === 'index.htm') htmlContent = content;

                    send({ type: 'file', path: entryPath, content });
                    fileCount++;

                    if (fileCount % 10 === 0)
                      send({ type: 'progress', stage: `Loaded ${fileCount} files...`, percent: Math.min(90, 10 + Math.floor(fileCount / 2)) });
                  } catch (e: any) {
                    send({ type: 'skipped', path: entryPath, reason: 'read error' });
                  }
                  next();
                });
              });
            } catch (entryErr: any) {
              console.warn('[extract-zip] entry error:', entryErr?.message);
              next();
            }
          });

          zipfile.on('end', resolve);
          zipfile.on('error', (ze: any) => {
            // Don't reject — resolve with whatever we got so partial imports still work
            console.warn('[extract-zip] zipfile error:', ze?.message);
            resolve();
          });
        });
      });

      const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
      const appName = titleMatch?.[1]?.trim() || fileName.replace(/\.zip$/i, '');
      console.log(`[extract-zip] Done: ${fileCount} files, appName="${appName}"`);
      send({ type: 'complete', fileCount, appName });

    } catch (err: any) {
      console.error('[extract-zip] Error:', err.message);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      }
    } finally {
      if (!res.writableEnded) res.end();
      try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
    }
  });

  // ── One-click download: package app files as ZIP ─────────────────────────────
  app.post('/api/download-zip', limiter, async (req: Request, res: Response) => {
    const { files, appName } = req.body;
    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    const safeName = (appName || 'navbharat-app').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 40);
    try {
      const ZipStream = require('zip-stream');
      const archive = new ZipStream({ level: 6 });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
      setCorsHeaders(req, res);
      archive.pipe(res);
      const entries = Object.entries(files as Record<string, string>);
      for (const [filename, content] of entries) {
        // Sanitize the entry name so the produced archive can never carry a zip-slip path
        // (e.g. "../../etc/passwd") that escapes the extraction dir on the consumer's machine.
        const safeEntry = String(filename)
          .replace(/\\/g, '/')
          .split('/')
          .filter(seg => seg && seg !== '.' && seg !== '..')
          .join('/');
        if (!safeEntry) continue;
        await new Promise<void>((resolve, reject) => {
          archive.entry(content, { name: safeEntry }, (err: any) => err ? reject(err) : resolve());
        });
      }
      archive.finish();
    } catch (err: any) {
      console.error('[download-zip] Error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
    }
  });
}
