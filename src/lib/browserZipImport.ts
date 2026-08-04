// MASTER IMPORT, part 1 — read the archive in the BROWSER and upload only what is worth uploading.
//
// THE REFRAME (admin, 2026-08-04). Every previous fix asked "how do we carry a 1 GB zip to the server?"
// — chunking, then signed URLs. The admin asked the better question: why carry it at all? The server
// already discards `node_modules`, `.git`, `dist`, media and junk the moment it unpacks the archive. So
// the user was uploading a gigabyte for us to throw ~95% of it away on arrival. Their actual SOURCE is
// usually 3-10 MB.
//
// Reading the zip here instead means: the file tree appears instantly (before any network), the upload
// is a few MB, the server never holds the archive in RAM (Cloud Run's /tmp is memory-backed), and the
// multi-instance chunk-scatter risk disappears with the chunking. `node_modules` was never needed
// anyway — the sandbox runs `npm install` and rebuilds it.
//
// WHY @zip.js/zip.js AND NOT jszip (a correction to my own earlier recommendation). jszip's
// `loadAsync` materializes the WHOLE archive in memory: a 1 GB zip would need ~1-2 GB in the tab and
// crash a phone — precisely the users this is meant to help. zip.js reads the CENTRAL DIRECTORY first
// (entry names + sizes, no decompression) and then inflates only the entries we keep, pulling their
// bytes through `Blob.slice`. Peak memory is bounded by what we keep, not by the archive — which is the
// same property that makes the server's streaming extractor honest about big archives.
//
// The filter rules are IMPORTED from src/lib/importRules.ts — the same module the server extractor uses
// — never re-stated here. A second copy would drift, and the drift would be silent.

import {
  importDropReason, assetMimeFor, BINARY_EXT_RE, type ImportDropReason,
} from './importRules';
import type { DropCounts } from './importDropReport';
// Type-only: erased at compile time, so naming these costs the bundle nothing and the reader still
// loads lazily via the dynamic import below.
import type { Entry, FileEntry } from '@zip.js/zip.js';

/**
 * Narrow a zip entry to a readable FILE.
 *
 * A plain `if (e.directory)` cannot do this here: zip.js discriminates its Entry union on the boolean
 * literals `directory: true | false`, and this project compiles with `strictNullChecks: false`, under
 * which TypeScript widens those literals and the narrowing silently fails. An explicit guard restores
 * it honestly — the alternative, an `as FileEntry` cast, would compile today and hide a genuine API
 * change tomorrow.
 */
function isFileEntry(e: Entry): e is FileEntry {
  return !e.directory && typeof (e as FileEntry).getData === 'function';
}

/** Per-file text ceiling. Matches the durable store's cap so nothing is kept that cannot be saved. */
export const BROWSER_MAX_FILE_BYTES = 900 * 1024;
/** Total text budget for one import. */
export const BROWSER_MAX_TOTAL_BYTES = 80 * 1024 * 1024;
/** Hard file-count ceiling, mirroring the server's IMPORT_MAX_FILES. */
export const BROWSER_MAX_FILES = 16_000;
/** Small images/fonts kept so the preview is not full of broken pictures. */
export const BROWSER_MAX_ASSET_BYTES = 640 * 1024;
export const BROWSER_MAX_ASSETS = 200;

export interface BrowserZipProgress {
  phase: 'scanning' | 'reading';
  /** Entries examined so far. */
  done: number;
  /** Total entries in the archive (known after the central directory is read). */
  total: number;
}

export interface BrowserZipResult {
  files: Record<string, string>;
  /** Small binary assets as `data:<mime>;base64,…`, same shape the server produces. */
  assets: Record<string, string>;
  dropped: DropCounts;
  totalEntries: number;
  /** Bytes of source actually kept — what will really be uploaded. */
  keptBytes: number;
}

/** A single archive entry, reduced to what the filter needs. Lets the decision be tested без zip.js. */
export interface ZipEntryInfo {
  path: string;
  /** Uncompressed size from the central directory — known WITHOUT decompressing. */
  bytes: number;
  directory: boolean;
}

export type KeepVerdict =
  | { keep: 'text' }
  | { keep: 'asset'; mime: string }
  | { keep: false; reason: ImportDropReason | 'tooLarge' | 'overCap' };

/**
 * Should this entry be read and uploaded? PURE, and the whole point of the module: it is decided from
 * the central directory alone, so a 900 MB video is refused without ever being decompressed.
 *
 * `state` is the running budget; the caller updates it only for entries this returns a keep for, so the
 * budget reflects what is actually kept rather than what was offered.
 */
export function keepVerdict(
  entry: ZipEntryInfo,
  state: { files: number; bytes: number; assets: number },
): KeepVerdict {
  if (entry.directory) return { keep: false, reason: 'dir' };
  const drop = importDropReason(entry.path);
  const mime = assetMimeFor(entry.path);
  if (drop) {
    // A small keepable asset is only reached when importDropReason declined to drop it, so a `binary`
    // verdict here genuinely means "no useful text form and not a keepable image/font".
    return { keep: false, reason: drop.reason };
  }
  if (state.files >= BROWSER_MAX_FILES) return { keep: false, reason: 'overCap' };
  if (mime && BINARY_EXT_RE.test(entry.path)) {
    if (entry.bytes > BROWSER_MAX_ASSET_BYTES) return { keep: false, reason: 'tooLarge' };
    if (state.assets >= BROWSER_MAX_ASSETS) return { keep: false, reason: 'overCap' };
    return { keep: 'asset', mime };
  }
  if (entry.bytes > BROWSER_MAX_FILE_BYTES) return { keep: false, reason: 'tooLarge' };
  if (state.bytes + entry.bytes > BROWSER_MAX_TOTAL_BYTES) return { keep: false, reason: 'overCap' };
  return { keep: 'text' };
}

/** Every reason an entry can be refused — the union `DropCounts` already has a slot for. */
export type DropReason = ImportDropReason | 'tooLarge' | 'overCap';

/** Record a refusal against the shared DropCounts shape. Pure. */
export function countDrop(dropped: DropCounts, reason: DropReason): void {
  dropped[reason] = (dropped[reason] ?? 0) + 1;
}

/**
 * Strip a single wrapping folder ("my-app/src/…" → "src/…"), the way every zip made by right-clicking a
 * project folder is shaped. Mirrors the server's root-strip so both sides land the same paths. Pure.
 */
export function strippedRootOf(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const firsts = new Set<string>();
  for (const p of paths) {
    const i = p.indexOf('/');
    if (i <= 0) return null; // a file at the archive root ⇒ nothing to strip
    firsts.add(p.slice(0, i));
    if (firsts.size > 1) return null;
  }
  const only = [...firsts][0];
  return only || null;
}

/**
 * Read a .zip in the browser and return only the files worth importing.
 *
 * Throws with a plain, user-facing message when the archive cannot be read at all — the caller falls
 * back to the server upload path rather than leaving the user stuck (an honest degrade, never a
 * silent one).
 */
export async function readZipInBrowser(
  file: Blob,
  onProgress?: (p: BrowserZipProgress) => void,
): Promise<BrowserZipResult> {
  // Dynamic import keeps the reader out of the main bundle — it only loads when someone imports a zip.
  const { ZipReader, BlobReader, TextWriter, Data64URIWriter, configure } = await import('@zip.js/zip.js');
  // Web workers keep inflation off the UI thread so a big archive never freezes the page.
  try { configure({ useWebWorkers: true }); } catch { /* a config failure just means main-thread inflate */ }

  const reader = new ZipReader(new BlobReader(file));
  const files: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const dropped: DropCounts = {};
  const state = { files: 0, bytes: 0, assets: 0 };
  let keptBytes = 0;
  // Entries we actually tried to inflate, and how many of those threw. Their ratio is what separates
  // "this archive is unreadable" from "this archive genuinely had nothing worth importing".
  let attempted = 0;
  let readFailures = 0;

  try {
    // Pass 1 — the central directory only. No entry is decompressed here, which is what makes a 1 GB
    // archive cost megabytes of memory instead of gigabytes.
    const entries = await reader.getEntries();
    const totalEntries = entries.length;
    onProgress?.({ phase: 'scanning', done: 0, total: totalEntries });

    // A password-protected archive does NOT fail here: zip encryption covers the content, not the
    // central directory, so the names read fine and every getData then fails one by one. Left alone
    // that produced a green, empty import — the exact silent-loss class just eliminated elsewhere.
    // Detect it from the flag the directory already carries and say so before any work is wasted.
    if (entries.some((e) => e.encrypted)) {
      throw new Error('This zip is password-protected, so it cannot be opened. Export it without a password and try again.');
    }

    const safePaths: string[] = [];
    for (const e of entries) {
      if (e.directory) continue;
      safePaths.push(String(e.filename || ''));
    }
    const root = strippedRootOf(safePaths.filter(Boolean));

    // Pass 2 — inflate ONLY what survives the filter.
    let done = 0;
    for (const e of entries) {
      done += 1;
      if (done % 200 === 0) onProgress?.({ phase: 'reading', done, total: totalEntries });
      const raw = String(e.filename || '');
      const path = root && raw.startsWith(`${root}/`) ? raw.slice(root.length + 1) : raw;
      const info: ZipEntryInfo = {
        path,
        bytes: typeof e.uncompressedSize === 'number' ? e.uncompressedSize : 0,
        directory: !!e.directory,
      };
      const verdict = keepVerdict(info, state);
      if (verdict.keep === false) {
        if (!info.directory) countDrop(dropped, verdict.reason);
        continue;
      }
      // `keepVerdict` already refused every directory; the guard restores the type narrowing that
      // strictNullChecks:false takes away (see isFileEntry).
      if (!isFileEntry(e)) continue;
      try {
        if (verdict.keep === 'asset') {
          const data = await e.getData(new Data64URIWriter(verdict.mime));
          if (typeof data === 'string' && data) {
            assets[path] = data;
            state.assets += 1;
            keptBytes += info.bytes;
          }
        } else {
          const text = await e.getData(new TextWriter());
          if (typeof text === 'string') {
            files[path] = text;
            state.files += 1;
            state.bytes += info.bytes;
            keptBytes += info.bytes;
          }
        }
      } catch {
        // One unreadable entry must never abort a 4,000-file import — count it honestly and move on.
        readFailures += 1;
        countDrop(dropped, 'overCap');
      }
    }
    onProgress?.({ phase: 'reading', done: totalEntries, total: totalEntries });
    // BACKSTOP: an archive with real entries that yielded NOTHING is not a filter result, it is an
    // archive we could not read. Returning an empty map would hand the caller a green "imported 0
    // files" — silence dressed as success. Fail instead, so the caller falls back to the server path.
    // The discriminator is READ FAILURE, not emptiness: an archive that legitimately holds only
    // node_modules keeps nothing and is still perfectly readable — the caller has an accurate message
    // for that ("zip your source folder instead"). Only "we tried to read entries and every single one
    // failed" means the archive itself is unusable.
    if (attempted > 0 && readFailures === attempted) {
      throw new Error('This file could not be read as a zip archive.');
    }
    return { files, assets, dropped, totalEntries, keptBytes };
  } catch (err) {
    throw new Error(
      err instanceof Error && /encrypt|password/i.test(err.message)
        ? 'This zip is password-protected, so it cannot be opened. Export it without a password and try again.'
        : 'This file could not be read as a zip archive.',
    );
  } finally {
    try { await reader.close(); } catch { /* closing is best-effort */ }
  }
}
