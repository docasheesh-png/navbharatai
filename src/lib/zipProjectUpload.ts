// Client half of the chunked zip import (see src/server/routes/zipUpload.ts for the why).
//
// A project zip is sliced into chunks small enough that every request clears Cloud Run's ~32 MB cap,
// so archive size stops being a limit. The server reassembles, extracts, and returns the file map;
// the caller then lands it through the existing import path.
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
  files: Record<string, string>;
  assetCount: number;
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
 * Upload a project zip in chunks and return its extracted file map.
 * Throws with an honest, user-facing message on any failure — never resolves on a partial upload.
 */
export async function uploadZipProject(
  file: File,
  onProgress?: (p: ZipUploadProgress) => void,
): Promise<ZipProjectResult> {
  const jsonHeaders = await authJsonHeaders();

  // 1. Begin
  const beginRes = await fetch('/api/zip-upload/begin', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ fileName: file.name }),
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

  // 3. Commit → extract
  onProgress?.({ fraction: 1, sentBytes: file.size, totalBytes: file.size, phase: 'extracting' });
  const commitRes = await fetch('/api/zip-upload/commit', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ uploadId }),
  });
  const commit = await commitRes.json().catch(() => ({} as any));
  if (!commitRes.ok || !commit?.ok || !commit?.files) {
    throw new Error(commit?.error || 'The upload finished but the archive could not be read.');
  }
  return {
    fileName: String(commit.fileName || file.name),
    fileCount: Number(commit.fileCount) || Object.keys(commit.files).length,
    files: commit.files as Record<string, string>,
    assetCount: Number(commit.assetCount) || 0,
  };
}
