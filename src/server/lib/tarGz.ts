/**
 * tarGz — minimal, dependency-free ustar tarball writer (+ gzip) for Cloud Build source uploads.
 *
 * WHY HAND-ROLLED: Cloud Build's `storageSource` wants a gzipped tarball; the repo has zip tooling
 * (@zip.js) but no tar, and pulling `tar`/`tar-stream` in for one write-only, in-memory use adds a
 * supply-chain surface for ~80 lines of stable, 1988-vintage format (POSIX ustar). Same reasoning as
 * export.ts choosing exceljs deliberately — dependencies are chosen, not defaulted.
 *
 * Scope is EXACTLY what a source upload needs and nothing more: regular files with utf8 contents,
 * paths ≤ 255 bytes via the ustar prefix field, 0644 mode, epoch mtime for determinism (same input
 * → byte-identical tarball → testable). No symlinks, no dirs (tar readers create parents), no
 * ownership. PURE.
 */

import { gzipSync } from 'zlib';

const BLOCK = 512;

function octal(value: number, width: number): Buffer {
  // ustar numeric fields: zero-padded octal, NUL-terminated.
  const s = value.toString(8).padStart(width - 1, '0');
  return Buffer.from(s + '\0', 'ascii');
}

/** Split a path into ustar (prefix, name) halves: name ≤ 100 bytes, prefix ≤ 155, joined by '/'. */
export function splitUstarPath(path: string): { prefix: string; name: string } | null {
  const p = path.replace(/^\/+/, '');
  if (Buffer.byteLength(p) <= 100) return { prefix: '', name: p };
  // Walk split points from the right so `name` keeps the longest tail that fits.
  const parts = p.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('/');
    const name = parts.slice(i).join('/');
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { prefix, name };
  }
  return null; // no legal split — caller must reject the path honestly
}

function headerFor(path: string, size: number): Buffer {
  const split = splitUstarPath(path);
  if (!split) throw new Error(`tarGz: path too long for ustar: ${path}`);
  const h = Buffer.alloc(BLOCK, 0);
  h.write(split.name, 0, 100, 'utf8');            // name
  octal(0o644, 8).copy(h, 100);                   // mode
  octal(0, 8).copy(h, 108);                       // uid
  octal(0, 8).copy(h, 116);                       // gid
  octal(size, 12).copy(h, 124);                   // size
  octal(0, 12).copy(h, 136);                      // mtime (epoch — deterministic output)
  h.write('        ', 148, 8, 'ascii');           // chksum placeholder (spaces while summing)
  h.write('0', 156, 1, 'ascii');                  // typeflag: regular file
  h.write('ustar\0', 257, 6, 'ascii');            // magic
  h.write('00', 263, 2, 'ascii');                 // version
  h.write(split.prefix, 345, 155, 'utf8');        // prefix
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  octal(sum, 8).copy(h, 148);                     // real checksum
  return h;
}

/** Build a .tar buffer from path → utf8 content. Deterministic: entries sorted by path. Pure. */
export function tarFromFiles(files: Readonly<Record<string, string>>): Buffer {
  const chunks: Buffer[] = [];
  for (const path of Object.keys(files).sort()) {
    const body = Buffer.from(files[path] ?? '', 'utf8');
    chunks.push(headerFor(path, body.length));
    chunks.push(body);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0)); // end-of-archive: two zero blocks
  return Buffer.concat(chunks);
}

/** The .tar.gz Cloud Build expects. Deterministic (gzip level 9, no OS-varying header fields kept). */
export function tarGzFromFiles(files: Readonly<Record<string, string>>): Buffer {
  return gzipSync(tarFromFiles(files), { level: 9 });
}
