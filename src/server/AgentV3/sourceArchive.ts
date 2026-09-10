// The user's app, packed into the one shape Cloud Build accepts (ROADMAP §11, slice 1b).
//
// Cloud Build reads its source from a Cloud Storage object that must be a gzipped tarball. This module
// turns the durable store's `{ path: content }` map into exactly those bytes.
//
// WHY A TAR WRITER RATHER THAN A DEPENDENCY. The project already carries three ZIP libraries and no
// tar one, and Cloud Build's storageSource is documented as a `.tar.gz`. Guessing that it would accept
// a zip is the kind of assumption that fails in production and nowhere else. The ustar format is 512-
// byte headers and padded content — small enough to write exactly, and pure, so every rule below is
// tested against real bytes rather than trusted.
//
// 🔒 A FILE THAT CANNOT BE PACKED IS REPORTED, NEVER DROPPED. A source file missing from the archive
// produces a build that fails for a reason nobody can see — the compiler complains about an import
// whose target "does not exist" while the file sits safely in the store. So `skipped` is part of the
// result and the caller is expected to refuse rather than ship a mystery.

import * as zlib from 'zlib';

const BLOCK = 512;

/**
 * Directories that must never reach the builder.
 *
 * `node_modules` is the important one: buildpacks run the install themselves, and shipping a local
 * copy would upload hundreds of megabytes to produce a WORSE image (the wrong platform's native
 * binaries). The rest are build output and version-control noise — bytes with no effect on the result.
 */
export const ARCHIVE_EXCLUDES: readonly string[] = [
  'node_modules/', '.git/', 'dist/', 'build/', '.next/', '.nuxt/', 'out/', 'coverage/',
  '.venv/', 'venv/', '__pycache__/', '.cache/', '.turbo/', '.vercel/', '.netlify/',
];

/** Is this path one we deliberately do not ship to the builder? PURE. */
export function isExcludedFromArchive(path: string): boolean {
  const p = String(path ?? '').replace(/^\.\//, '');
  return ARCHIVE_EXCLUDES.some((ex) => p === ex.slice(0, -1) || p.startsWith(ex) || p.includes(`/${ex}`));
}

/**
 * A path safe to place in an archive: relative, no `..`, no leading slash.
 *
 * The same guard the workspace path helper applies elsewhere in this codebase, for the same reason —
 * an archive entry named `../../etc/x` is a path-traversal write on whatever unpacks it. Returns ''
 * for anything it will not vouch for, and '' is refused by the caller. PURE.
 */
export function safeArchivePath(path: string): string {
  const p = String(path ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.includes('\0')) return '';
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return '';
  return p;
}

/** Left-pad an octal field the way tar expects: digits, then a NUL. PURE. */
function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

/**
 * Split a path across ustar's `name` (100) and `prefix` (155) fields.
 *
 * Returns null when the path cannot be represented at all — which the caller reports rather than
 * silently truncating, because a truncated name is a file the build cannot find. PURE.
 */
export function splitTarName(path: string): { name: string; prefix: string } | null {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    const name = parts.slice(i).join('/');
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
  }
  return null;
}

/** One ustar header block for a regular file. PURE. */
function header(path: string, size: number, mtime: number): Buffer | null {
  const split = splitTarName(path);
  if (!split) return null;
  const h = Buffer.alloc(BLOCK, 0);
  h.write(split.name, 0, 100, 'utf8');
  h.write(octal(0o644, 8), 100, 8, 'ascii');       // mode
  h.write(octal(0, 8), 108, 8, 'ascii');           // uid
  h.write(octal(0, 8), 116, 8, 'ascii');           // gid
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtime, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');            // checksum placeholder: eight spaces
  h.write('0', 156, 1, 'ascii');                   // typeflag: regular file
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(split.prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

export interface ArchiveResult {
  /** The gzipped tarball Cloud Build reads. */
  data: Buffer;
  /** Paths actually packed. */
  packed: string[];
  /**
   * Paths that could NOT be packed, with the reason. Never empty-and-ignored: the caller refuses the
   * build rather than producing an image missing a source file.
   */
  skipped: Array<{ path: string; reason: 'unsafe-path' | 'name-too-long' | 'not-text' }>;
  /** Paths deliberately left out (node_modules, build output). Not a problem — reported for clarity. */
  excluded: number;
}

/**
 * A FIXED timestamp, on purpose.
 *
 * The same source must produce the same archive bytes: it makes these tests exact, and it means a
 * rebuild of unchanged code can be recognised as unchanged instead of looking new because the clock
 * moved. Cloud Build does not care what the value is.
 */
export const ARCHIVE_MTIME = 0;

/**
 * Pack a workspace into a gzipped tarball for Cloud Build.
 *
 * Deterministic: entries are sorted, timestamps fixed, so identical input yields identical bytes.
 */
export function packWorkspaceArchive(files: Record<string, string>): ArchiveResult {
  const chunks: Buffer[] = [];
  const packed: string[] = [];
  const skipped: ArchiveResult['skipped'] = [];
  let excluded = 0;

  for (const path of Object.keys(files ?? {}).sort()) {
    const content = files[path];
    if (isExcludedFromArchive(path)) { excluded += 1; continue; }
    if (typeof content !== 'string') { skipped.push({ path, reason: 'not-text' }); continue; }
    const safe = safeArchivePath(path);
    if (!safe) { skipped.push({ path, reason: 'unsafe-path' }); continue; }
    const body = Buffer.from(content, 'utf8');
    const head = header(safe, body.length, ARCHIVE_MTIME);
    if (!head) { skipped.push({ path, reason: 'name-too-long' }); continue; }
    chunks.push(head, body);
    const remainder = body.length % BLOCK;
    if (remainder !== 0) chunks.push(Buffer.alloc(BLOCK - remainder, 0));
    packed.push(safe);
  }
  // Two zero blocks close a tar archive.
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return { data: zlib.gzipSync(Buffer.concat(chunks), { level: 6 }), packed, skipped, excluded };
}

/**
 * Read an archive back — used only by tests, and that is the point: a writer nobody can read is a
 * writer nobody can check. Returns `{ path: content }` for regular file entries. PURE.
 */
export function readArchive(data: Buffer): Record<string, string> {
  const buf = zlib.gunzipSync(data);
  const out: Record<string, string> = {};
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const head = buf.subarray(off, off + BLOCK);
    const name = head.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;                                   // the closing zero block
    const prefix = head.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(head.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0;
    off += BLOCK;
    out[prefix ? `${prefix}/${name}` : name] = buf.subarray(off, off + size).toString('utf8');
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
