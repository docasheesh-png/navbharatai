// AgentV3 — STREAMING project extraction: the same import pipeline, from DISK, in bounded memory.
//
// WHY (admin 2026-08-04, verbatim): "5gb tak ki file import hote hi preview chal jaye… real VSC me jo
// hota hai, vaise kuch bana do! real working." The honest audit that preceded this found the deeper
// problem: the chunked upload advertised 1 GB, but its commit step did `fs.readFileSync(zip)` and
// handed the WHOLE archive to jszip — which holds every entry in memory. A 1 GB archive needed ~2–3 GB
// of RAM at commit; 5 GB was impossible no matter what any limit constant said. The ceiling was never
// the transport — it was buffering the archive.
//
// This module is what VS Code-style handling actually means on a server: the archive stays ON DISK and
// is read entry-by-entry with yauzl (the zip's central directory gives every entry's path + declared
// size WITHOUT decompressing anything), and only the entries worth keeping are ever inflated — bounded
// by the same per-file/total caps the buffer extractor enforces. Peak memory is a few MB regardless of
// whether the archive is 40 MB or 5 GB, because a 5 GB app zip is node_modules, media and .git history:
// the source that actually lands obeys the same budgets as before.
//
// PARITY, NOT A FORK (rule 4): every decision — skip dirs, junk, secrets, asset tiers, lockfile tiers,
// per-file/total budgets, root-strip, monorepo re-root, zip-slip — is the SAME rule set, imported from
// ProjectImport.ts, never re-implemented. A parity test extracts the same archive through both and
// asserts identical results. The ONE deliberate difference: the buffer path rejects any archive that
// DECLARES >300 MB uncompressed (there it protects memory); here that guard is unnecessary — streaming
// never inflates what it does not keep — so a 5 GB archive with 60 MB of real source imports instead of
// being refused as a "bomb". Bombs stay bounded by the entry-count cap and per-entry read-abort guards.
//
// Three sequential passes over the file (metadata is cheap; content is read once, selectively):
//   1. SCAN     — central directory only: classify every path, count drops, gather keep-candidates.
//   2. PKG READ — only when monorepo re-rooting must be decided: read the ≤20 candidate package.json.
//   3. CONTENT  — read exactly the planned entries, applying the runtime budgets.

import * as fs from 'node:fs';
import {
  SKIP_DIR_RE, JUNK_FILE_RE, SECRET_FILE_RE, BINARY_EXT_RE,
  IMPORT_MAX_FILES, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_TOTAL_BYTES,
  IMPORT_MAX_LOCKFILE_BYTES, IMPORT_MAX_ASSET_BYTES, IMPORT_MAX_ASSETS, IMPORT_MAX_ASSET_TOTAL_BYTES,
  IMPORT_MAX_SANDBOX_ASSET_BYTES, IMPORT_MAX_SANDBOX_ASSET_TOTAL_BYTES,
  assetMimeFor, safeImportPath, chooseMonorepoAppRoot,
  type ExtractedProject,
} from './ProjectImport';

/**
 * Entry-count ceiling for the STREAMING path. Far above the buffer path's 60k because a real 5 GB app
 * zip routinely carries >100k node_modules entries — here each costs only a central-directory record,
 * so the cap guards TIME, not memory. Still finite: an archive claiming more than this is hostile.
 */
export const STREAM_MAX_ENTRIES = 1_500_000;
/**
 * How many keep-CANDIDATE paths the scan will hold in memory (skipped dirs are counted, never stored).
 * Real projects have thousands; only a hostile million-tiny-files-at-root archive approaches this, and
 * it degrades honestly (counted as over-cap) instead of exhausting memory.
 */
export const STREAM_MAX_CANDIDATES = 120_000;

const LOCKFILE_RE = /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

interface ScanCandidate {
  /** The entry name as it appears in the archive — the key for reading it back in later passes. */
  rawName: string;
  /** The sanitized path (pre root-strip). */
  path: string;
  declaredBytes: number;
}

interface YauzlEntry { fileName: string; uncompressedSize?: number }
interface YauzlZipFile {
  readEntry(): void;
  openReadStream(entry: YauzlEntry, cb: (err: Error | null, stream?: NodeJS.ReadableStream) => void): void;
  on(event: 'entry', cb: (entry: YauzlEntry) => void): void;
  on(event: 'end' | 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
}

function openZip(filePath: string): Promise<YauzlZipFile> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yauzl = require('yauzl');
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err: Error | null, zip?: YauzlZipFile) => {
      if (err || !zip) reject(err ?? new Error('Could not open the archive.'));
      else resolve(zip);
    });
  });
}

/**
 * Iterate every entry's METADATA (no decompression), invoking `onEntry` for each file entry.
 *
 * A throw from `onEntry` REJECTS the scan and stops iterating — that is how the entry-count bomb guard
 * aborts a hostile archive early instead of walking all 1.5M records. (An earlier draft swallowed
 * per-entry throws "for robustness", which would have silently disabled exactly that guard; onEntry is
 * pure path/counter logic, so there is nothing legitimate for a swallow to protect.)
 */
function scanEntries(filePath: string, onEntry: (e: YauzlEntry) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    openZip(filePath).then((zip) => {
      let stopped = false;
      zip.on('entry', (entry) => {
        if (stopped) return;
        try {
          if (!String(entry.fileName || '').endsWith('/')) onEntry(entry);
        } catch (e) {
          stopped = true;
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        zip.readEntry();
      });
      zip.on('end', () => { if (!stopped) resolve(); });
      zip.on('error', (e) => { if (!stopped) { stopped = true; reject(e); } });
      zip.readEntry();
    }, reject);
  });
}

/**
 * Read ONE entry's bytes with a hard abort cap — the guard against an entry whose central-directory
 * size LIES (declares 1 KB, inflates to 1 GB). Returns null when the cap is crossed or the stream fails.
 */
function readEntryCapped(zip: YauzlZipFile, entry: YauzlEntry, capBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) { resolve(null); return; }
      const chunks: Buffer[] = [];
      let received = 0;
      let done = false;
      const finish = (value: Buffer | null) => { if (!done) { done = true; resolve(value); } };
      stream.on('data', (c: Buffer) => {
        received += c.length;
        if (received > capBytes) {
          try { (stream as unknown as { destroy(): void }).destroy(); } catch { /* stream already gone */ }
          finish(null);
          return;
        }
        chunks.push(c);
      });
      stream.on('end', () => finish(Buffer.concat(chunks)));
      stream.on('error', () => finish(null));
    });
  });
}

/** Read a specific set of entries (by raw name) from the archive, each capped. */
async function readEntrySet(
  filePath: string,
  wanted: Map<string, number /* cap */>,
  onContent: (rawName: string, buf: Buffer) => void,
): Promise<void> {
  if (wanted.size === 0) return;
  await new Promise<void>((resolve, reject) => {
    openZip(filePath).then((zip) => {
      let remaining = wanted.size;
      zip.on('entry', (entry) => {
        const cap = wanted.get(entry.fileName);
        if (cap === undefined) { zip.readEntry(); return; }
        readEntryCapped(zip, entry, cap).then((buf) => {
          if (buf) {
            try { onContent(entry.fileName, buf); } catch { /* consumer error — skip this entry */ }
          }
          remaining -= 1;
          if (remaining === 0) resolve(); // everything wanted has been read — stop iterating early
          else zip.readEntry();
        });
      });
      zip.on('end', resolve);
      zip.on('error', reject);
      zip.readEntry();
    }, reject);
  });
}

/**
 * Extract a project from a zip ON DISK — same decisions and same result shape as `extractZipProject`,
 * with peak memory bounded by the kept-content budgets rather than the archive size.
 */
export async function extractZipProjectFromDisk(filePath: string, opts?: { maxFiles?: number }): Promise<ExtractedProject> {
  const maxFiles = opts?.maxFiles ?? IMPORT_MAX_FILES;
  const dropped = { dir: 0, junk: 0, secret: 0, binary: 0, tooLarge: 0, unsafe: 0, overCap: 0, outsideAppRoot: 0 };

  // ── Pass 1: SCAN the central directory ──
  const candidates: ScanCandidate[] = [];
  const firstSegs = new Set<string>();
  let everyPathNested = true;
  let totalEntries = 0;
  await scanEntries(filePath, (entry) => {
    totalEntries += 1;
    if (totalEntries > STREAM_MAX_ENTRIES) {
      throw new Error(`Refusing to import this archive: it contains over ${STREAM_MAX_ENTRIES.toLocaleString()} entries.`);
    }
    const safe = safeImportPath(String(entry.fileName || ''));
    if (!safe) { dropped.unsafe += 1; return; }
    firstSegs.add(safe.split('/')[0]);
    if (!safe.includes('/')) everyPathNested = false;
    // These three rules are position-independent (`(^|\/)` anchors), so testing the PRE-strip path here
    // gives the same verdict the buffer extractor reaches post-strip — and lets a node_modules-heavy
    // archive be COUNTED without its hundred thousand paths ever being stored.
    if (SKIP_DIR_RE.test(safe)) { dropped.dir += 1; return; }
    if (JUNK_FILE_RE.test(safe)) { dropped.junk += 1; return; }
    if (SECRET_FILE_RE.test(safe)) { dropped.secret += 1; return; }
    if (candidates.length >= STREAM_MAX_CANDIDATES) { dropped.overCap += 1; return; }
    candidates.push({
      rawName: String(entry.fileName),
      path: safe,
      declaredBytes: typeof entry.uncompressedSize === 'number' && entry.uncompressedSize > 0 ? entry.uncompressedSize : 0,
    });
  });

  // ── Root strip: same rule as the buffer path, decided from EVERY safe entry's first segment ──
  let strippedRoot: string | null = null;
  if (totalEntries - dropped.unsafe > 1 && firstSegs.size === 1 && everyPathNested) {
    strippedRoot = [...firstSegs][0];
    for (const c of candidates) c.path = c.path.slice(strippedRoot.length + 1);
  }

  // ── Pass 2 (conditional): monorepo re-root, from the candidate package.json contents ──
  let appRoot: string | null = null;
  if (!candidates.some((c) => c.path === 'package.json')) {
    const pkgCandidates = candidates.filter((c) => /(^|\/)package\.json$/.test(c.path)).slice(0, 20);
    const wanted = new Map(pkgCandidates.map((c) => [c.rawName, IMPORT_MAX_LOCKFILE_BYTES]));
    const contents: Array<{ path: string; content: string }> = [];
    const byRaw = new Map(pkgCandidates.map((c) => [c.rawName, c.path]));
    await readEntrySet(filePath, wanted, (rawName, buf) => {
      const p = byRaw.get(rawName);
      if (p) contents.push({ path: p, content: buf.toString('utf8') });
    });
    appRoot = chooseMonorepoAppRoot(contents);
    if (appRoot) {
      const prefix = `${appRoot}/`;
      for (const c of candidates) {
        if (c.path.startsWith(prefix)) c.path = c.path.slice(prefix.length);
        else { c.path = ''; dropped.outsideAppRoot += 1; }
      }
    }
  }

  // ── Plan: decide from metadata alone what is worth READING at all ──
  const files: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const sandboxAssets: Record<string, string> = {};
  const sandboxOnly: Record<string, string> = {};
  const plans = new Map<string, { path: string; kind: 'text' | 'asset'; mime?: string; cap: number }>();
  for (const c of candidates) {
    if (!c.path) continue; // re-rooted away (already counted)
    if (BINARY_EXT_RE.test(c.path)) {
      const mime = assetMimeFor(c.path);
      if (mime && !(c.declaredBytes > IMPORT_MAX_SANDBOX_ASSET_BYTES)) {
        plans.set(c.rawName, { path: c.path, kind: 'asset', mime, cap: IMPORT_MAX_SANDBOX_ASSET_BYTES + 1024 });
      } else {
        dropped.binary += 1;
      }
      continue;
    }
    if (c.declaredBytes > IMPORT_MAX_LOCKFILE_BYTES && !LOCKFILE_RE.test(c.path)) { dropped.tooLarge += 1; continue; }
    plans.set(c.rawName, { path: c.path, kind: 'text', cap: IMPORT_MAX_LOCKFILE_BYTES + 1024 });
  }

  // ── Pass 3: CONTENT — read exactly the planned entries, applying the runtime budgets ──
  let totalBytes = 0;
  let assetBytes = 0;
  let sandboxAssetBytes = 0;
  const wanted = new Map([...plans].map(([raw, p]) => [raw, p.cap]));
  await readEntrySet(filePath, wanted, (rawName, buf) => {
    const plan = plans.get(rawName);
    if (!plan) return;
    if (plan.kind === 'asset') {
      const rawBytes = buf.length;
      const dataUri = `data:${plan.mime};base64,${buf.toString('base64')}`;
      if (rawBytes <= IMPORT_MAX_ASSET_BYTES && Object.keys(assets).length < IMPORT_MAX_ASSETS
          && assetBytes + rawBytes <= IMPORT_MAX_ASSET_TOTAL_BYTES) {
        assets[plan.path] = dataUri;
        assetBytes += rawBytes;
      } else if (rawBytes <= IMPORT_MAX_SANDBOX_ASSET_BYTES
          && sandboxAssetBytes + rawBytes <= IMPORT_MAX_SANDBOX_ASSET_TOTAL_BYTES) {
        sandboxAssets[plan.path] = dataUri;
        sandboxAssetBytes += rawBytes;
      } else {
        dropped.binary += 1;
      }
      return;
    }
    if (Object.keys(files).length >= maxFiles) { dropped.overCap += 1; return; }
    const content = buf.toString('utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > IMPORT_MAX_FILE_BYTES) {
      if (LOCKFILE_RE.test(plan.path) && bytes <= IMPORT_MAX_LOCKFILE_BYTES) { sandboxOnly[plan.path] = content; return; }
      dropped.tooLarge += 1;
      return;
    }
    if (totalBytes + bytes > IMPORT_MAX_TOTAL_BYTES) { dropped.overCap += 1; return; }
    totalBytes += bytes;
    files[plan.path] = content;
  });

  return { files, assets, sandboxAssets, sandboxOnly, dropped, totalEntries, strippedRoot, appRoot };
}

/** Free bytes available on the filesystem holding `dir`, or null when the platform cannot say. */
export function freeDiskBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

/**
 * Headroom the preflight requires BEYOND the file itself, scaled to the upload.
 *
 * ROOT CAUSE (admin report 2026-08-04, ".zip file upload hi nahi ho rahi"): the first version used a
 * FIXED 512 MB headroom. On Cloud Run, /tmp is RAM-backed and routinely has only a few hundred MB
 * free — so the fixed constant made the preflight refuse EVERY upload, including a 10 MB zip that
 * would have sailed through. The guard built to stop a 5 GB upload wedging the instance instead
 * blocked all imports the moment it deployed. Headroom must be PROPORTIONAL to the risk: a small
 * upload needs only a small safety margin (64 MB); only genuinely big uploads need big margins
 * (25% of the file, capped at 512 MB). PURE, exported for the regression tests.
 */
export function uploadHeadroomBytes(declaredBytes: number): number {
  const MIN = 64 * 1024 * 1024;        // never less — the instance must keep functioning
  const MAX = 512 * 1024 * 1024;       // never more — beyond this the margin stops buying safety
  if (!Number.isFinite(declaredBytes) || declaredBytes <= 0) return MIN;
  return Math.max(MIN, Math.min(MAX, Math.floor(declaredBytes / 4)));
}

/**
 * Should an upload of `declaredBytes` be accepted, given `freeBytes` on the temp filesystem?
 * Pure. Requires headroom beyond the file itself so an import can never wedge the instance by filling
 * the disk to the last byte — and answers true when free space is UNKNOWN (null), because refusing
 * every upload on a platform that cannot report free space would be a worse failure than trying.
 */
export function hasSpaceForUpload(freeBytes: number | null, declaredBytes: number, headroomBytes?: number): boolean {
  if (freeBytes === null) return true;
  if (!Number.isFinite(declaredBytes) || declaredBytes < 0) return true;
  return freeBytes >= declaredBytes + (headroomBytes ?? uploadHeadroomBytes(declaredBytes));
}
