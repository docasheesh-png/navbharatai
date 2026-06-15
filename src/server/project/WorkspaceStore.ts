/**
 * Phase 2 — Workspace persistence codec.
 *
 * Firestore caps a single document at ~1 MB, which is why the old sync route
 * silently dropped any file > 60KB and truncated whole workspaces past 800KB —
 * losing user work. This codec instead splits an arbitrarily large, JSON-
 * serializable workspace payload into N size-bounded string chunks that each fit
 * comfortably under the Firestore doc limit, and reassembles them losslessly.
 *
 * Storage layout (handled by the caller / WorkspaceStore):
 *   user_workspaces/{userId}            → manifest { chunkCount, totalBytes, updatedAt }
 *   user_workspaces/{userId}_chunk_{i}  → { data: <chunk string> }
 *
 * Pure + dependency-free so it is trivially unit-testable.
 */

export interface WorkspaceManifest {
  version: 2;
  chunkCount: number;
  totalBytes: number;
  updatedAt: string;
}

export interface EncodedWorkspace {
  manifest: WorkspaceManifest;
  chunks: string[];
}

/** Safe per-chunk character budget (well under Firestore's ~1MB/doc limit). */
export const DEFAULT_CHUNK_SIZE = 900_000;

/** Encode any JSON-serializable workspace value into size-bounded chunks. */
export function encodeWorkspace(payload: unknown, chunkSize = DEFAULT_CHUNK_SIZE): EncodedWorkspace {
  if (chunkSize <= 0) throw new Error('encodeWorkspace: chunkSize must be > 0');
  const json = JSON.stringify(payload ?? null);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += chunkSize) {
    chunks.push(json.slice(i, i + chunkSize));
  }
  // Always at least one chunk (empty payload → one empty-ish chunk for "null").
  if (chunks.length === 0) chunks.push(json);
  return {
    manifest: {
      version: 2,
      chunkCount: chunks.length,
      totalBytes: Buffer.byteLength(json, 'utf8'),
      updatedAt: new Date().toISOString(),
    },
    chunks,
  };
}

/** Reassemble chunks (in order) back into the original value. Lossless. */
export function decodeWorkspace<T = unknown>(chunks: string[]): T {
  const json = (chunks || []).join('');
  if (!json) return null as unknown as T;
  return JSON.parse(json) as T;
}
