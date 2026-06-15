import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Express, Request, Response } from 'express';

/**
 * ZIP import/export routes extracted from the server.ts monolith (Phase 1).
 * Self-contained — uses fs/path/crypto + yauzl (extract) and zip-stream (download).
 * Behavior unchanged.
 *
 * - POST /api/extract-zip  — stream-extract an uploaded ZIP into a file map (SSE)
 * - POST /api/download-zip — package a file map into a downloadable ZIP
 */
export function registerZipRoutes(app: Express): void {
  app.post('/api/extract-zip', async (req: Request, res: Response) => {
    const fileName = req.headers['x-file-name']
      ? decodeURIComponent(String(req.headers['x-file-name']))
      : 'upload.zip';

    const os = await import('os');
    const tmpId = (crypto as any).randomBytes(8).toString('hex');
    const tmpZip = path.join(os.default.tmpdir(), `nbt-${tmpId}.zip`);

    // Assets embedded as base64 data-URLs so the preview can use them directly (images + web fonts)
    const ASSET_MIME: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
      '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
    };
    // True binaries that are NOT editable and NOT useful in a web preview — skipped entirely.
    const BINARY_SKIP = new Set([
      '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.class', '.wasm', '.node', '.pyc',
      '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z', '.bz2', '.xz', '.jar', '.war',
      '.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v',
      '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.wma',
      '.pdf', '.psd', '.ai', '.sketch', '.fig', '.xd', '.blend',
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
      // ── Step 1: Stream raw binary body to disk (no memory limit) ──────────
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(tmpZip);
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });

      const zipSize = fs.statSync(tmpZip).size;
      console.log(`[extract-zip] ${fileName} received: ${(zipSize / 1024 / 1024).toFixed(1)} MB`);

      // ── Step 2: SSE response setup ─────────────────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
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

              // Skip empty paths, directories, and unwanted folders (node_modules/.git/etc.)
              if (!entryPath || entryPath.endsWith('/') || SKIP_RE.test('/' + rawPath)) { next(); return; }

              // Stop accepting more once caps are hit (protects the browser)
              if (fileCount >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { next(); return; }

              const ext = path.extname(entryPath).toLowerCase();
              const assetMime = ASSET_MIME[ext];
              const isAsset = !!assetMime;

              // Skip only true binaries — EVERYTHING else is treated as editable text
              if (!isAsset && BINARY_SKIP.has(ext)) { send({ type: 'skipped', path: entryPath, reason: 'binary' }); next(); return; }

              // Per-file size limits: 8 MB assets, 5 MB text
              const maxBytes = isAsset ? 8 * 1024 * 1024 : 5 * 1024 * 1024;
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
  app.post('/api/download-zip', async (req: Request, res: Response) => {
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
      res.setHeader('Access-Control-Allow-Origin', '*');
      archive.pipe(res);
      const entries = Object.entries(files as Record<string, string>);
      for (const [filename, content] of entries) {
        await new Promise<void>((resolve, reject) => {
          archive.entry(content, { name: filename }, (err: any) => err ? reject(err) : resolve());
        });
      }
      archive.finish();
    } catch (err: any) {
      console.error('[download-zip] Error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
    }
  });
}
