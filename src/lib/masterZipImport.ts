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
import { readFolderInBrowser, isFolderImportSupported, pickProjectFolder } from './folderImport';
import { linkFolder } from './folderWriteBack';
import { liftEmbeddedMedia, liftSummary } from './liftEmbeddedMedia';
import { IMPORT_LIMITS } from './importRules';

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
): Promise<{ imported: number; failedBatches: number; reasons: string[] }> {
  // Text rides in the usual 8 MB batches; media files (data: URIs) go in SMALLER ones, so one request never carries a
  // multi-megabyte video the server must also write into the sandbox and the durable store before it can answer
  // (single-file game autopsy, 2026-11-14: "0 file(s) were saved, but 1 batch(es) failed" on a 5 MB page of media).
  const isAsset = (v: string): boolean => /^data:[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9=._-]+)*;base64,/i.test(v);
  const text: Record<string, string> = {};
  const media: Record<string, string> = {};
  for (const [path, value] of Object.entries(files)) (typeof value === 'string' && isAsset(value) ? media : text)[path] = value;
  const batches = [...chunkFilesForSync(text), ...chunkFilesForSync(media, ASSET_BATCH_BYTES)];
  const headers = await authJsonHeaders();
  let imported = 0;
  let failedBatches = 0;
  const reasons: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    onProgress?.({
      label: batches.length > 1 ? `Saving your project… part ${i + 1} of ${batches.length}` : 'Saving your project…',
      fraction: batches.length > 0 ? (i + 1) / batches.length : null,
    });
    const outcome = await sendBatch(batches[i], { workspaceId, userId, email }, headers);
    if (outcome.ok) imported += Object.keys(batches[i]).length;
    else { failedBatches += 1; if (!reasons.includes(outcome.reason)) reasons.push(outcome.reason); }
  }
  return { imported, failedBatches, reasons };
}

/**
 * Did ANYTHING land? An import that saved zero files is a failed import — it must not be announced as imported, painted into Files as
 * if it were saved, or followed by a preview boot over an empty workspace ("Installing dependencies and starting your app…"). PURE.
 */
export function importLanded(result: { imported: number } | null | undefined): boolean {
  return !!result && Number(result.imported) > 0;
}

/** A media batch stays under this, so a request is one or two files, not the whole game. */
export const ASSET_BATCH_BYTES = 3 * 1024 * 1024;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const ATTEMPTS = 3;

/**
 * One batch, with the failure kept: a transient answer (rate limit, a gateway timeout, a dropped connection) is retried
 * with a growing pause, and when it still fails the REASON is returned — the status and the server's own sentence — so the user
 * and the build report are told WHY, not just that "1 batch failed" (the old code threw the status away).
 */
async function sendBatch(
  batch: Record<string, string>,
  who: { workspaceId: string; userId: string | null | undefined; email: string | null | undefined },
  headers: Record<string, string>,
): Promise<{ ok: boolean; reason: string }> {
  let reason = 'no answer from the server';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch('/api/agentv3/import-files', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...who, files: batch }),
      });
      if (res.ok) return { ok: true, reason: '' };
      const said = await res.json().then((j: { error?: unknown }) => (typeof j?.error === 'string' ? j.error : ''), () => '');
      reason = `${res.status}${said ? ` — ${said.slice(0, 160)}` : ''}`;
      if (!RETRY_STATUSES.has(res.status)) break; // 400/403/404/413: asking again cannot change the answer
    } catch (err) {
      reason = `the connection dropped (${err instanceof Error ? err.message.slice(0, 80) : 'network error'})`;
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  return { ok: false, reason };
}

/** The honest line for a partly-failed save — the user must never think a partial import was whole. */
export function partialSaveWarning(failedBatches: number, imported: number, reasons: readonly string[] = []): string {
  if (failedBatches <= 0) return '';
  const why = reasons.length > 0 ? ` Why: ${reasons.join('; ')}.` : '';
  return `⚠️ ${imported.toLocaleString()} file(s) were saved, but ${failedBatches} batch(es) failed to upload.${why} Import it again to retry — files already saved are merged, not duplicated — and do not assume the whole project is in yet.`;
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
    const { imported, failedBatches, reasons } = await uploadExtractedFiles(payload, workspaceId, userId, email, onProgress);

    const dropped: DropCounts = read.dropped;
    const summary = importDropSummary({ kept: imported, totalEntries: read.totalEntries, dropped });
    const warn = partialSaveWarning(failedBatches, imported, reasons);
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

/**
 * Import a project FOLDER the user picked directly — no zip, no archive, no staging.
 *
 * Shares every downstream step with the archive path (same filter, same chunked send, same honest
 * summary), so a folder import and a zip import of the same project land identical files. The only
 * difference is where the bytes are read from, which is exactly as it should be.
 */
export async function importProjectFolder(
  root: FileSystemDirectoryHandle,
  folderName: string,
  workspaceId: string,
  userId: string | null | undefined,
  email: string | null | undefined,
  onProgress?: (p: MasterImportProgress) => void,
): Promise<MasterImportResult> {
  const read = await readFolderInBrowser(root, (p) => onProgress?.({
    // A folder walk has no known total until it ends, so a percentage here would be invented. Show the
    // real running counts instead — honest, and just as reassuring that something is happening.
    label: `Reading your project… ${p.kept.toLocaleString()} file(s) so far`,
    fraction: null,
  }));

  const keptCount = Object.keys(read.files).length + Object.keys(read.assets).length;
  if (keptCount === 0) {
    throw new Error('No source files were found in that folder. Pick the folder that holds your app’s source (the one with package.json), not a build or downloads folder.');
  }

  const payload: Record<string, string> = { ...read.files, ...read.assets };
  const { imported, failedBatches, reasons } = await uploadExtractedFiles(payload, workspaceId, userId, email, onProgress);
  const summary = importDropSummary({ kept: imported, totalEntries: read.totalEntries, dropped: read.dropped });
  const warn = partialSaveWarning(failedBatches, imported, reasons);
  // Remember the folder so "Save to folder" (Q-160) can write changes back — on a press, never on its own.
  linkFolder({ handle: root, name: folderName, original: { ...read.files }, stamps: { ...read.stamps } });
  return {
    via: 'browser',
    files: read.files,
    fileName: folderName,
    fileCount: keptCount,
    imported,
    dropSummary: [summary, warn].filter(Boolean).join('\n\n'),
  };
}


/**
 * Import ONE HTML page — a one-file game or app — as a project (single-file game autopsy, 2026-11-14).
 *
 * The page is read here, in the browser, and every embedded video / sound / image is moved out into `assets/media/` BEFORE
 * anything is sent: a 5.4 MB page becomes about 0.8 MB of code plus real files, so no size cap drops it and no model is ever
 * handed megabytes of base64. The page is saved as `index.html` (the name the preview and the builder look for); its own
 * localStorage keys are untouched, so the player's saved games still load.
 */
export async function importSingleHtml(
  file: File,
  workspaceId: string,
  userId: string | null | undefined,
  email: string | null | undefined,
  onProgress?: (p: MasterImportProgress) => void,
): Promise<MasterImportResult> {
  if (file.size > IMPORT_LIMITS.maxHtmlSourceBytes) {
    throw new Error(`That page is ${(file.size / 1024 / 1024).toFixed(1)} MB — over the ${(IMPORT_LIMITS.maxHtmlSourceBytes / 1024 / 1024).toFixed(0)} MB limit for one page. Zip it with its media files and use Import project (.zip) instead.`);
  }
  onProgress?.({ label: 'Reading your page…', fraction: null });
  const text = await file.text();
  if (!text.trim()) throw new Error('That file is empty, so there is nothing to import.');
  onProgress?.({ label: 'Moving the media out of your page…', fraction: null });
  const lifted = liftEmbeddedMedia({ 'index.html': text });
  const payload: Record<string, string> = { ...lifted.files, ...lifted.assets };
  const { imported, failedBatches, reasons } = await uploadExtractedFiles(payload, workspaceId, userId, email, onProgress);
  const lines = [liftSummary(lifted)];
  const unlifted = lifted.unlifted.length;
  if (unlifted > 0) lines.push(`⚠️ ${unlifted} media item(s) were too large to move out and stay inside the page.`);
  const warn = partialSaveWarning(failedBatches, imported, reasons);
  if (warn) lines.push(warn);
  return {
    via: 'browser',
    files: lifted.files,
    fileName: file.name,
    fileCount: Object.keys(payload).length,
    imported,
    dropSummary: lines.filter(Boolean).join('\n\n'),
  };
}

/** Re-exported so callers need only this module. */
export { totalFilesBytes, isFolderImportSupported, pickProjectFolder };
