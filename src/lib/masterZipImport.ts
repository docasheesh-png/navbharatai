// THE MASTER IMPORT HANDLER — one entry point for a project archive of any size or shape.
//
// Admin: "1-2-3 teeno ko aise banao ki ham har ek file chahe kitni bhi badi kyu na ho, kitni bhi
// complex kyu na ho, sab handle kar paye, easy … sabhi 3 mila kar ek master zip handler banao."
//
// This is the routing layer over the two transports that now exist. It ALWAYS tries the browser first,
// because reading the archive locally is strictly better on every axis that matters — the file tree is
// known before any network call, `node_modules`/media/junk are dropped before they cost bandwidth, the
// server never holds a gigabyte in its memory-backed /tmp, and the multi-instance chunk-scatter risk
// disappears along with the chunked upload. It falls back to the server upload ONLY when the browser
// genuinely cannot do the job, and it says so rather than degrading silently.
//
// WHY A FALLBACK AT ALL. `readZipInBrowser` can legitimately fail: a very old browser without the APIs
// zip.js needs, a phone that runs out of memory on an unusually large archive, a corrupt central
// directory. Removing the server path would turn each of those into a dead end for the user; keeping it
// costs one branch. What it must NEVER do is fall back for a reason the user should have been told
// about — a password-protected archive is a real refusal and is re-thrown, not retried through a path
// that will fail more slowly and less clearly.

import { readZipInBrowser, type BrowserZipProgress } from './browserZipImport';
import { uploadZipProject, type ZipProjectResult } from './zipProjectUpload';
import { chunkFilesForSync, totalFilesBytes } from './chunkFilesForSync';
import { importDropSummary, type DropCounts } from './importDropReport';
import { authJsonHeaders } from './authHeaders';

export interface MasterImportProgress {
  /** What the user should be told is happening right now. */
  label: string;
  /** 0..1 when known, or null while a phase has no meaningful ratio. */
  fraction: number | null;
}

export interface MasterImportResult extends ZipProjectResult {
  /** Which transport actually delivered the project — recorded so a report can be honest about it. */
  via: 'browser' | 'server';
  /** Files the browser read locally, when it did; the caller can paint the tree from these instantly. */
  files: Record<string, string> | null;
}

/**
 * Reasons the browser path may hand over to the server. Anything NOT in this set is a real refusal the
 * user must see (a password-protected archive), never a silent retry.
 */
export function shouldFallBackToServer(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/password-protected/i.test(msg)) return false; // a real answer — do not retry it slowly
  return true;
}

/** Human label for a browser-reading phase. Pure. */
export function browserPhaseLabel(p: BrowserZipProgress): string {
  if (p.phase === 'scanning') return 'Opening your project…';
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  return `Reading your project… ${Math.max(0, Math.min(100, pct))}%`;
}

/**
 * Send an already-extracted file map to the workspace.
 *
 * Chunked through the SAME helper the IDE sync uses, because the source of a large monorepo can still
 * exceed the platform's per-request cap even after `node_modules` is gone — and a partial send must be
 * reported, never swallowed. Returns how many files actually landed.
 */
export async function uploadExtractedFiles(
  files: Record<string, string>,
  workspaceId: string,
  userId: string | null | undefined,
  email: string | null | undefined,
  onProgress?: (p: MasterImportProgress) => void,
): Promise<{ imported: number; failedBatches: number }> {
  const batches = chunkFilesForSync(files);
  const headers = await authJsonHeaders();
  let imported = 0;
  let failedBatches = 0;
  for (let i = 0; i < batches.length; i++) {
    onProgress?.({
      label: batches.length > 1 ? `Saving your project… part ${i + 1} of ${batches.length}` : 'Saving your project…',
      fraction: batches.length > 0 ? (i + 1) / batches.length : null,
    });
    try {
      const res = await fetch('/api/agentv3/import-files', {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspaceId, userId, email, files: batches[i] }),
      });
      if (!res.ok) { failedBatches += 1; continue; }
      imported += Object.keys(batches[i]).length;
    } catch {
      failedBatches += 1;
    }
  }
  return { imported, failedBatches };
}

/** The honest line for a partly-failed save — the user must never think a partial import was whole. */
export function partialSaveWarning(failedBatches: number, imported: number): string {
  if (failedBatches <= 0) return '';
  return `⚠️ ${imported.toLocaleString()} file(s) were saved, but ${failedBatches} batch(es) failed to upload. Send your next message and I will retry the rest — do not assume the whole project is in yet.`;
}

/**
 * Import a project archive. Tries the browser, falls back to the server upload, and always reports what
 * did not come in.
 */
export async function importProjectArchive(
  file: File,
  workspaceId: string,
  userId: string | null | undefined,
  email: string | null | undefined,
  onProgress?: (p: MasterImportProgress) => void,
): Promise<MasterImportResult> {
  try {
    const read = await readZipInBrowser(file, (p) => onProgress?.({
      label: browserPhaseLabel(p),
      fraction: p.total > 0 ? p.done / p.total : null,
    }));

    // An archive whose every entry was filtered out is not a transport failure — the server would reach
    // the same verdict after a multi-minute upload. Answer now, with the reason.
    const keptCount = Object.keys(read.files).length + Object.keys(read.assets).length;
    if (keptCount === 0) {
      throw new Error('No source files were found in that zip. If it only contains node_modules or build output, zip your source folder instead.');
    }

    // Assets ride along as data: URIs in the same map — the server's import path already understands
    // that shape, so nothing new is needed to land an imported app's logo.
    const payload: Record<string, string> = { ...read.files, ...read.assets };
    const { imported, failedBatches } = await uploadExtractedFiles(payload, workspaceId, userId, email, onProgress);

    const dropped: DropCounts = read.dropped;
    const summary = importDropSummary({ kept: imported, totalEntries: read.totalEntries, dropped });
    const warn = partialSaveWarning(failedBatches, imported);
    return {
      via: 'browser',
      files: read.files,
      fileName: file.name,
      fileCount: keptCount,
      imported,
      dropSummary: [summary, warn].filter(Boolean).join('\n\n'),
    };
  } catch (err) {
    if (!shouldFallBackToServer(err)) throw err;
    // HONEST DEGRADE: the user is told the slower path is being used, so a sudden multi-minute upload
    // is never unexplained.
    onProgress?.({ label: 'Opening it here did not work — uploading the archive instead…', fraction: null });
    const r = await uploadZipProject(file, workspaceId, (p) => onProgress?.({
      label: p.phase === 'extracting' ? 'Unpacking your project on the server…' : `Uploading… ${Math.round(p.fraction * 100)}%`,
      fraction: p.fraction,
    }));
    return { ...r, via: 'server', files: null };
  }
}

/** Re-exported so callers need only this module. */
export { totalFilesBytes };
