// MASTER IMPORT, part 3 — "Open Folder": no zip, no upload of anything that is not source.
//
// THE IDEA (admin, 2026-08-04, "vsc jaisa kuch hona chahiye"). Parts 1-2 stopped shipping a gigabyte to
// the server by reading the ZIP in the browser. This removes the zip too: the user points at their
// project FOLDER and the browser reads it directly. Nothing is compressed, nothing is staged, and the
// only bytes that ever leave the machine are the source files themselves.
//
// It also removes a failure class rather than mitigating one. There is no archive to be truncated, no
// temp file on a Cloud Run instance, no chunk that can land on the wrong instance, no 30-minute upload
// TTL, and no memory ceiling from holding an archive — because there is no archive. A 50 GB folder is
// as cheap to open as a 5 MB one, since the walk skips what it does not want before reading it.
//
// PRUNE BEFORE DESCENDING — the single most important decision here. `node_modules` in a real project
// is 50,000-200,000 files. Walking into it to reject each entry one at a time would take minutes and
// hammer the disk for a result we already know. `SKIP_DIR_RE` is therefore tested against the DIRECTORY
// before recursing, so the biggest folder in the project costs exactly one check.
//
// SHARED RULES, SHARED BUDGETS (rule 4). Every keep/drop decision comes from `keepVerdict` — the same
// function the zip path uses, over the same `importRules`. This module contributes the traversal, not a
// second opinion about what a project is: a folder import and a zip import of the same project must
// land identical files, or the two paths will quietly disagree and only one of them will be right.
//
// SUPPORT IS HONEST. The File System Access API is Chrome/Edge desktop only. `isFolderImportSupported()`
// is what the UI gates on, so the option is never offered where it cannot work — an offered button that
// throws is worse than no button.

import { keepVerdict, countDrop, type BrowserZipResult, type ZipEntryInfo } from './browserZipImport';
import { SKIP_DIR_RE } from './importRules';
import type { DropCounts } from './importDropReport';

/** Progress while walking a real folder. `total` is unknown until the walk ends, so it stays absent. */
export interface FolderScanProgress {
  /** Files examined so far. */
  seen: number;
  /** Files kept so far. */
  kept: number;
  /** The directory currently being read, relative to the project root. */
  where: string;
}

/**
 * TRUE when this browser can open a folder. Chrome/Edge desktop today; Firefox, Safari and every mobile
 * browser lack it. The UI must gate on this rather than offer a button that throws.
 */
export function isFolderImportSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * Should the walk descend into this directory at all? PURE.
 *
 * The name is tested with a trailing slash so `SKIP_DIR_RE`'s `(\/|$)` anchor matches a directory the
 * same way it matches a path segment — keeping one regex authoritative for both the zip and folder
 * paths instead of introducing a directory-only variant that could drift.
 */
export function shouldDescend(dirPath: string): boolean {
  return !SKIP_DIR_RE.test(`${dirPath}/`);
}

/** Join a parent path and a child name into the project-relative path. Pure. */
export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/**
 * The maximum number of directories the walk will enter. A safety rail against a pathological tree
 * (a symlink loop the browser exposes, or a generated folder with a hundred thousand subdirectories) —
 * not a limit any real project reaches.
 */
export const FOLDER_MAX_DIRS = 20_000;

/**
 * Read a project folder and return exactly what the zip path would return for the same project.
 *
 * The identical `BrowserZipResult` shape is deliberate: the master handler and the panel then treat a
 * folder and an archive the same way, and neither has to learn a second vocabulary.
 */
export async function readFolderInBrowser(
  root: FileSystemDirectoryHandle,
  onProgress?: (p: FolderScanProgress) => void,
): Promise<BrowserZipResult> {
  const files: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const dropped: DropCounts = {};
  const state = { files: 0, bytes: 0, assets: 0 };
  let keptBytes = 0;
  let totalEntries = 0;
  let dirsVisited = 0;

  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    if (dirsVisited >= FOLDER_MAX_DIRS) return;
    dirsVisited += 1;
    onProgress?.({ seen: totalEntries, kept: state.files + state.assets, where: prefix || '/' });

    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      const path = joinPath(prefix, name);

      if (handle.kind === 'directory') {
        // The whole point: reject node_modules/.git/dist ONCE, instead of walking their contents to
        // reject 200,000 files individually.
        if (!shouldDescend(path)) { dropped.dir = (dropped.dir ?? 0) + 1; continue; }
        await walk(handle as FileSystemDirectoryHandle, path);
        continue;
      }

      totalEntries += 1;
      let file: File;
      try {
        file = await (handle as FileSystemFileHandle).getFile();
      } catch {
        // A file the OS will not hand over (permissions, a broken link) must not abort the import.
        countDrop(dropped, 'overCap');
        continue;
      }

      const info: ZipEntryInfo = { path, bytes: file.size, directory: false };
      const verdict = keepVerdict(info, state);
      if (verdict.keep === false) { countDrop(dropped, verdict.reason); continue; }

      try {
        if (verdict.keep === 'asset') {
          assets[path] = await fileToDataUri(file, verdict.mime);
          state.assets += 1;
        } else {
          files[path] = await file.text();
          state.files += 1;
          state.bytes += file.size;
        }
        keptBytes += file.size;
      } catch {
        countDrop(dropped, 'overCap');
      }
    }
  };

  await walk(root, '');
  onProgress?.({ seen: totalEntries, kept: state.files + state.assets, where: '' });
  return { files, assets, dropped, totalEntries, keptBytes };
}

/** Read a small binary file as a `data:` URI, the same shape the zip path produces for assets. */
async function fileToDataUri(file: File, mime: string): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // Chunked so a 640 KB asset cannot blow the argument limit of String.fromCharCode.
  const CHUNK = 8 * 1024;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Ask the user for a project folder. Returns null when they cancel — a cancel is a normal outcome, not
 * an error, and must never surface as a failure message.
 */
export async function pickProjectFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (typeof picker !== 'function') return null;
  try {
    return await picker({ mode: 'read', id: 'navbharatai-project', startIn: 'documents' });
  } catch (err) {
    // AbortError = the user closed the dialog. Anything else is a real failure worth surfacing.
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') return null;
    throw err;
  }
}
