// AgentV3 — BULK LANDING: put a whole imported project into the sandbox in TWO round trips
// instead of one per file.
//
// ROOT CAUSE (self-import autopsy 2026-08-03): landing a 2573-file repo took 109s, vs 49s for a
// 316-file one — ~26ms of pure latency per extra file. `writeWorkspaceFiles` was already parallelised
// (concurrency 12) after an earlier 648-second incident, but parallelism only divides the problem:
// every file is still its own network round trip to the sandbox, so cost stays LINEAR in file count.
// 2540 files ÷ 12 ≈ 212 sequential rounds — the dominant cost of a large import, and the reason a big
// repo felt broken while a small one felt instant.
//
// The fix is to stop sending files one at a time: build ONE gzipped tar in memory, upload it as a
// single binary, and let the sandbox expand it with `tar -xzf`. That is O(1) round trips regardless of
// file count. `tar -xzf … --overwrite` is ALREADY the proven checkpoint-restore path in the E2B
// actuator, so the binary's availability is not a new assumption.
//
// Everything here is PURE (Buffer in → Buffer out) so the archive format is unit-tested without a
// sandbox; the impure orchestration + verification lives in WorkspaceFiles.ts.

import { gzipSync } from 'zlib';

/** tar's fixed block size. Every header and every file's data is padded to a multiple of this. */
const BLOCK = 512;

/**
 * The ustar name/prefix split for a path.
 *
 * tar stores a name in 100 bytes, with an optional 155-byte `prefix` joined back as `prefix/name`.
 * Returns null when the path cannot be represented (too long, unsafe, or absolute) — the caller then
 * falls back to a per-file write for that entry rather than silently dropping it.
 */
export function ustarNameSplit(path: string): { name: string; prefix: string } | null {
  const p = String(path || '').replace(/^\.\//, '');
  if (!p || p.length > 255) return null;
  if (p.startsWith('/') || p.includes('\0')) return null;
  if (p.split('/').some((seg) => seg === '..')) return null; // never let an archive escape the root
  if (Buffer.byteLength(p, 'utf8') !== p.length) {
    // Non-ASCII names need more bytes than characters; ustar counts BYTES. Keep it simple and honest:
    // only plain-ASCII paths take the bulk path, the rest fall back to a per-file write.
    return null;
  }
  if (p.length <= 100) return { name: p, prefix: '' };
  // Split at a '/' so that name ≤ 100 AND prefix ≤ 155. A LARGER index means a shorter name and a
  // longer prefix, so the only valid window is [len-101 … 155] — scan it UPWARD and take the first
  // slash in it. (Scanning downward from len-101 only ever visits indices whose name is > 100, which
  // is why a long-but-perfectly-valid path was being rejected until a test caught it.)
  const lo = Math.max(0, p.length - 101);
  const hi = Math.min(155, p.length - 2);
  for (let i = lo; i <= hi; i++) {
    if (p[i] !== '/') continue;
    const prefix = p.slice(0, i);
    const name = p.slice(i + 1);
    if (name.length <= 100 && prefix.length <= 155) return { name, prefix };
  }
  return null;
}

/** Write `value` into `buf` at `offset`, NUL-padded to `len`. */
function writeField(buf: Buffer, value: string, offset: number, len: number): void {
  buf.write(value.slice(0, len), offset, len, 'ascii');
}

/** Octal field: `size` in octal, zero-padded, NUL-terminated (the classic tar encoding). */
function writeOctal(buf: Buffer, value: number, offset: number, len: number): void {
  const oct = Math.floor(Math.max(0, value)).toString(8);
  writeField(buf, oct.padStart(len - 1, '0') + '\0', offset, len);
}

/**
 * One 512-byte ustar header for a regular file. `mtime` is a fixed constant so the same input always
 * produces byte-identical output (deterministic ⇒ testable, and no spurious diffs).
 */
export function tarHeader(name: string, prefix: string, size: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  writeField(h, name, 0, 100);
  writeOctal(h, 0o644, 100, 8);   // mode
  writeOctal(h, 0, 108, 8);       // uid
  writeOctal(h, 0, 116, 8);       // gid
  writeOctal(h, size, 124, 12);   // size
  writeOctal(h, 0, 136, 12);      // mtime (fixed → deterministic)
  h.write('        ', 148, 8, 'ascii'); // checksum placeholder = 8 spaces
  h.write('0', 156, 1, 'ascii');  // typeflag '0' = regular file
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  writeField(h, prefix, 345, 155);
  // Checksum = unsigned sum of every header byte, with the checksum field read as spaces.
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  writeField(h, sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

export interface TarBuildResult {
  /** The gzipped tar — upload this as ONE binary. */
  gz: Buffer;
  /** Paths included in the archive. */
  included: string[];
  /** Paths the archive format cannot carry (too long / non-ASCII / unsafe) — write these individually. */
  excluded: string[];
}

/**
 * Build a gzipped tar of `files`. Never throws on a odd path: anything the format cannot represent is
 * returned in `excluded` so the caller writes it the slow way — the import stays COMPLETE either way,
 * which is the whole point (a faster landing must never mean a partial one).
 */
export function buildTarGz(files: Record<string, string>): TarBuildResult {
  const chunks: Buffer[] = [];
  const included: string[] = [];
  const excluded: string[] = [];
  for (const [path, content] of Object.entries(files || {})) {
    if (typeof content !== 'string') { excluded.push(path); continue; }
    const split = ustarNameSplit(path);
    if (!split) { excluded.push(path); continue; }
    const data = Buffer.from(content, 'utf8');
    chunks.push(tarHeader(split.name, split.prefix, data.length));
    chunks.push(data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
    included.push(path);
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0)); // two zero blocks = end of archive
  return { gz: gzipSync(Buffer.concat(chunks)), included, excluded };
}

/**
 * Is bulk landing worth it for this many files? Below the threshold the two extra round trips (upload
 * + extract) cost more than they save, so small imports keep the simple per-file path unchanged.
 */
export function shouldBulkLand(fileCount: number): boolean {
  const min = Number(process.env.AGENTV3_BULK_LAND_MIN_FILES);
  const threshold = Number.isFinite(min) && min > 0 ? min : 40;
  return fileCount >= threshold;
}

/** Bulk landing kill switch — set AGENTV3_BULK_LAND=off to force the per-file path everywhere. */
export function bulkLandEnabled(): boolean {
  return process.env.AGENTV3_BULK_LAND !== 'off';
}
