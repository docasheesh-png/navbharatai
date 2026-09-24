// Serve the build's ready-made `.br` / `.gz` copies (compression audit, 2026-09-24).
//
// `scripts/precompress.mjs` (run by the Dockerfile) writes a brotli-11 and a gzip-9 copy beside each
// built JS/CSS asset. This middleware, mounted BEFORE `express.static`, streams the best copy the
// browser accepts — so the per-request compressor never runs for those files, and what reaches the
// phone is ~10–15% smaller than the quality-4 brotli the middleware can afford per request.
//
// 🔒 IT CAN ONLY EVER FALL THROUGH. No copy on disk (a local build, the mobile build, a file too small
// to be worth it), an encoding the browser did not offer, a path outside the three asset directories,
// anything odd in the path — every one of these calls `next()`, and the request is served exactly as
// it was before this file existed. The per-request compressor stays mounted as the safety net.
//
// 🔒 `Content-Encoding` is set here, which is exactly the header the `compression` middleware reads to
// decide "already encoded — leave it", so a response can never be compressed twice.

import { stat } from 'fs/promises';
import { join, normalize, sep, extname } from 'path';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { cacheControlFor } from './staticCache';

/** Only these URL prefixes have precompressed copies; everything else is not our business. */
const PREFIXES = ['/assets/', '/monaco/', '/vendor/'];

export type PrecompressedEncoding = 'br' | 'gzip';

/**
 * Which ready-made copy to serve for an `Accept-Encoding` header. PURE — exported for tests.
 * Brotli first (smaller), then gzip. An explicit `q=0` is a refusal and is honoured.
 */
export function pickEncoding(acceptEncoding: string | undefined): PrecompressedEncoding | null {
  if (!acceptEncoding) return null;
  const offered = new Map<string, number>();
  for (const part of acceptEncoding.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    offered.set(name.trim(), Number.isFinite(q) ? q : 0);
  }
  const ok = (e: string) => (offered.get(e) ?? offered.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

/**
 * The on-disk path of the original asset for a URL path, or null when the URL is not one we serve
 * this way. PURE — exported for tests. Refuses traversal and anything outside the three directories.
 */
export function assetPathFor(distPath: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (!PREFIXES.some((p) => decoded.startsWith(p))) return null;
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return null;
  const abs = normalize(join(distPath, decoded));
  const root = normalize(distPath + sep);
  return abs.startsWith(root) ? abs : null;
}

/** `stat` results, so a hot asset costs one disk lookup per process, not one per request. Bounded. */
const exists = new Map<string, number | null>();
const MAX_REMEMBERED = 5_000;
async function sizeOf(p: string): Promise<number | null> {
  if (exists.has(p)) return exists.get(p) ?? null;
  let size: number | null = null;
  try { const st = await stat(p); size = st.isFile() ? st.size : null; } catch { size = null; }
  if (exists.size >= MAX_REMEMBERED) exists.clear();
  exists.set(p, size);
  return size;
}

/** `STATIC_PRECOMPRESSED=off` — the no-deploy revert to per-request compression for every file. */
export function precompressedStaticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.STATIC_PRECOMPRESSED ?? '').trim().toLowerCase() !== 'off';
}

export function precompressedStatic(distPath: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!precompressedStaticEnabled()) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const original = assetPathFor(distPath, req.path);
    if (!original) return next();
    const enc = pickEncoding(req.headers['accept-encoding'] as string | undefined);
    if (!enc) return next();
    const copy = `${original}.${enc === 'br' ? 'br' : 'gz'}`;
    if ((await sizeOf(copy)) == null) return next();

    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Encoding', enc);
    res.type(extname(original) || 'application/octet-stream');
    const cc = cacheControlFor(original);
    if (cc) res.setHeader('Cache-Control', cc);
    res.sendFile(copy, { cacheControl: false, acceptRanges: false, dotfiles: 'deny' }, (err) => {
      if (!err) return;
      // Nothing was sent yet ⇒ undo our headers and let the ordinary path serve the file.
      if (!res.headersSent) {
        res.removeHeader('Content-Encoding');
        res.removeHeader('Vary');
        res.removeHeader('Content-Type');
        exists.delete(copy);
        next();
      }
    });
  };
}
