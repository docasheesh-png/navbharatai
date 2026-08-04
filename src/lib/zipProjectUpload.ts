// Client half of the chunked upload (see src/server/routes/zipUpload.ts for the why).
//
// A file is sliced into chunks small enough that every request clears Cloud Run's ~32 MB cap, so
// file size stops being a limit. `uploadFileChunked` is the generic transfer; `uploadZipProject`
// adds the project-import commit on top. Landing/extraction happens SERVER-SIDE — sending a large
// file map back to the browser would hit the same cap this exists to remove.
//
// Deliberately NOT a chat attachment: a project is imported into the workspace, never base64-encoded
// into a build request. That distinction is the whole point of the separate entry point.

import { authJsonHeaders } from './authHeaders';

/** Mirrors ZIP_CHUNK_BYTES on the server; the begin call returns the authoritative value. */
export const DEFAULT_ZIP_CHUNK_BYTES = 8 * 1024 * 1024;

export interface ZipUploadProgress {
  /** 0..1 across the upload phase. */
  fraction: number;
  sentBytes: number;
  totalBytes: number;
  phase: 'uploading' | 'extracting';
}

export interface ZipProjectResult {
  fileName: string;
  fileCount: number;
  /** Files actually written into the workspace (landing happens server-side). */
  imported: number;
}

/** Pure: how many chunks a file of `size` needs at `chunkBytes` (always ≥1 so an empty file still posts). */
export function chunkCount(size: number, chunkBytes: number): number {
  if (chunkBytes <= 0) return 1;
  return Math.max(1, Math.ceil(size / chunkBytes));
}

/** Pure: byte range for chunk `i`, clamped to the file's end. */
export function chunkRange(i: number, chunkBytes: number, size: number): { start: number; end: number } {
  const start = Math.min(i * chunkBytes, size);
  return { start, end: Math.min(start + chunkBytes, size) };
}

/**
 * Transfer ANY file to the server in chunks and return its upload id.
 *
 * Extracted from the zip import so every large-binary path reuses one implementation instead of
 * re-inventing (and re-breaking) it — the Nav App Store's APK publish is the second caller. Throws on
 * any failure and cleans up the partial upload; never resolves on a partial transfer.
 */
export async function uploadFileChunked(
  file: File,
  onProgress?: (p: ZipUploadProgress) => void,
): Promise<{ uploadId: string; jsonHeaders: Record<string, string> }> {
  const jsonHeaders = await authJsonHeaders();

  // 1. Begin
  const beginRes = await fetch('/api/zip-upload/begin', {
    method: 'POST',
    headers: jsonHeaders,
    // fileSize lets the server run its ceiling + free-disk preflight BEFORE any bytes move, so a
    // too-big upload fails in one second with a real reason instead of dying at 90%.
    body: JSON.stringify({ fileName: file.name, fileSize: file.size }),
  });
  const begin = await beginRes.json().catch(() => ({} as any));
  if (!beginRes.ok || typeof begin?.uploadId !== 'string') {
    throw new Error(begin?.error || 'Could not start the import. Please sign in and try again.');
  }
  const uploadId: string = begin.uploadId;
  const chunkBytes: number = typeof begin.chunkBytes === 'number' && begin.chunkBytes > 0
    ? begin.chunkBytes
    : DEFAULT_ZIP_CHUNK_BYTES;

  const abort = async () => {
    try {
      await fetch('/api/zip-upload/abort', {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ uploadId }),
      });
    } catch { /* best-effort cleanup — the server sweeps stale uploads anyway */ }
  };

  // 2. Chunks — sequential, so the server's append order is the file's byte order.
  const total = chunkCount(file.size, chunkBytes);
  try {
    for (let i = 0; i < total; i++) {
      const { start, end } = chunkRange(i, chunkBytes, file.size);
      const res = await fetch('/api/zip-upload/chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(jsonHeaders.Authorization ? { Authorization: jsonHeaders.Authorization } : {}),
          'X-Upload-Id': uploadId,
          'X-Chunk-Index': String(i),
          'X-Total-Chunks': String(total),
        },
        body: file.slice(start, end),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err?.error || `Upload failed part-way through (chunk ${i + 1} of ${total}).`);
      }
      onProgress?.({ fraction: (i + 1) / total, sentBytes: end, totalBytes: file.size, phase: 'uploading' });
    }
  } catch (e) {
    await abort();
    throw e;
  }
  return { uploadId, jsonHeaders };
}

/**
 * Upload a project zip in chunks, then extract + land it into the workspace server-side.
 * Throws with an honest, user-facing message on any failure.
 */
export async function uploadZipProject(
  file: File,
  workspaceId: string,
  onProgress?: (p: ZipUploadProgress) => void,
): Promise<ZipProjectResult> {
  const { uploadId, jsonHeaders } = await uploadFileChunked(file, onProgress);

  // Commit → extract + land
  onProgress?.({ fraction: 1, sentBytes: file.size, totalBytes: file.size, phase: 'extracting' });
  const commitRes = await fetch('/api/zip-upload/commit', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ uploadId, workspaceId }),
  });
  const commit = await commitRes.json().catch(() => ({} as any));
  if (!commitRes.ok || !commit?.ok) {
    throw new Error(commit?.error || 'The upload finished but the archive could not be read.');
  }
  return {
    fileName: String(commit.fileName || file.name),
    fileCount: Number(commit.fileCount) || 0,
    imported: Number(commit.imported) || 0,
  };
}
