/**
 * Phase 2 — Workspace persistence codec.
 *
 * Firestore caps a single document at ~1 MB, which is why the old sync route
 * silently dropped any file > 60KB and truncated whole workspaces past 800KB —
 * losing user work. This codec instead splits an arbitrarily large, JSON-
 * serializable workspace payload into N size-bounded string chunks that each fit
 * comfortably under the Firestore doc limit, and reassembles them losslessly.
 *
 * Storage layout:
 *   user_workspaces/{userId}        → manifest { version, chunkCount, totalBytes, updatedAt }
 *   user_workspaces/{userId}__c{i}  → { data: <chunk string> }
 *
 * 🔴 THAT SECOND LINE USED TO READ `{userId}_chunk_{i}`, AND NO SUCH DOCUMENT HAS EVER EXISTED
 * (corrected 2026-10-09, Q-763). The real id has always been `${userId}__c${i}` — it was built by a
 * private helper inside `routes/sync.ts`, so the only written DESCRIPTION of the layout lived here
 * and disagreed with the only IMPLEMENTATION of it, with nothing able to notice. That is not a typo
 * to shrug at: the chunks hold the user's entire synced workspace, and an eraser or a migration that
 * trusted this comment would have built ids matching nothing, deleted nothing, and reported success.
 * So the id builder now lives HERE, next to the codec that defines the format, and `sync.ts` imports
 * it. One definition, and this comment is checked against it by
 * `tests/theSyncedWorkspaceIsErased.test.ts`.
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

/**
 * Hard ceiling on one person's whole synced workspace. Lives here rather than in the route because it
 * is a property of the STORAGE FORMAT: together with `DEFAULT_CHUNK_SIZE` it is what bounds how many
 * chunk documents can exist, which is what makes erasing them exactly — with no prefix query — possible.
 */
export const MAX_WORKSPACE_BYTES = 8_000_000;

/**
 * The document id of chunk `i` of `userId`'s workspace. THE one definition; `routes/sync.ts` reads and
 * writes through it, and the eraser deletes through it, so the two cannot drift apart.
 */
export const chunkDocId = (userId: string, i: number): string => `${userId}__c${i}`;

/**
 * The most chunk documents a workspace can possibly have, from the two constants above — 9 today.
 *
 * Why an eraser needs this and cannot just trust the manifest's `chunkCount`: a save writes the chunks
 * FIRST and the manifest LAST (`sync.ts`, "so a partial write is never read as complete"), and when a
 * workspace SHRINKS the route deletes the now-surplus chunks. Either step can be interrupted, which
 * leaves chunk documents the manifest does not count. Sweeping to this ceiling takes them too, and
 * every id is exact — a deletion of a document that does not exist is a no-op in Firestore.
 *
 * The margin covers a historically SMALLER chunk size: at 450_000 characters the same cap would need
 * 18 chunks, so the sweep goes to twice the computed ceiling rather than exactly to it.
 */
export function maxChunkCount(byteCap: number = MAX_WORKSPACE_BYTES, chunkSize: number = DEFAULT_CHUNK_SIZE): number {
  if (chunkSize <= 0) throw new Error('maxChunkCount: chunkSize must be > 0');
  return Math.ceil(byteCap / chunkSize) * 2;
}

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
