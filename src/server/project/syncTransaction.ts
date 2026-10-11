// CROSS-DEVICE SYNC, READ AND WRITTEN AS ONE CONSISTENT SNAPSHOT (performance audit 2026-10-11, D7).
//
// `POST /api/sync/:userId` (sent 2.5 s after every session change) read the manifest and up to nine 900 KB chunks
// ONE AT A TIME, merged, then wrote them back one at a time — with no transaction. So:
//   • two devices saving together each merged against the state BEFORE the other's write, and the second write
//     dropped the first device's new sessions (the lost update `SyncMerge` exists to prevent);
//   • a reader between a chunk write and the manifest write could decode new chunks under an old manifest;
//   • a full save cost up to 20 sequential round trips.
// Now a save is ONE transaction — read, merge, write — that Firestore retries on conflict, so the merge always
// sees the latest state, and a load is one read-only transaction over a consistent snapshot with a single
// batched read of the chunks. Pure apart from the transaction it is handed.

import { encodeWorkspace, decodeWorkspace, chunkDocId, MAX_WORKSPACE_BYTES } from './WorkspaceStore';
import { mergeWorkspaceState, type WorkspacePayload } from './SyncMerge';

/** The parts of a Firestore transaction this needs. */
export interface SyncTx<Ref> {
  get(ref: Ref): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  getAll(...refs: Ref[]): Promise<Array<{ exists: boolean; data(): Record<string, unknown> | undefined }>>;
  set(ref: Ref, data: Record<string, unknown>): unknown;
  delete(ref: Ref): unknown;
}

/** Turns a document id in `user_workspaces` into a reference. */
export type SyncRef<Ref> = (id: string) => Ref;

export interface StoredWorkspace {
  payload: WorkspacePayload;
  /** How many chunk documents the stored manifest points at (0 for a legacy v1 or absent workspace). */
  chunkCount: number;
  updatedAt: string | null;
  exists: boolean;
}

/** Read the stored workspace inside `tx`: the manifest, then every chunk in ONE batched read. */
export async function readWorkspaceTx<Ref>(tx: SyncTx<Ref>, ref: SyncRef<Ref>, userId: string): Promise<StoredWorkspace> {
  const m = await tx.get(ref(userId));
  if (!m.exists) return { payload: { sessions: [], lastApp: '' }, chunkCount: 0, updatedAt: null, exists: false };
  const data = m.data() ?? {};
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null;
  if (data.version === 2 && typeof data.chunkCount === 'number') {
    const count = Math.max(0, Math.floor(data.chunkCount));
    const snaps = count > 0 ? await tx.getAll(...Array.from({ length: count }, (_, i) => ref(chunkDocId(userId, i)))) : [];
    const chunks = snaps.map((s) => (s.exists ? String(s.data()?.data ?? '') : ''));
    const decoded = decodeWorkspace<{ sessions?: unknown[]; lastApp?: string }>(chunks) || {};
    return { payload: { sessions: (decoded.sessions || []) as WorkspacePayload['sessions'], lastApp: decoded.lastApp || '' }, chunkCount: count, updatedAt, exists: true };
  }
  // Legacy v1: a single inline document.
  return {
    payload: { sessions: (Array.isArray(data.sessions) ? data.sessions : []) as WorkspacePayload['sessions'], lastApp: typeof data.lastApp === 'string' ? data.lastApp : '' },
    chunkCount: 0, updatedAt, exists: true,
  };
}

export type SaveOutcome =
  | { ok: true; stored: number; chunks: number; totalBytes: number; updatedAt: string }
  | { ok: false; tooLarge: true; totalBytes: number; limit: number };

/**
 * Merge `incoming` into the stored workspace and write the result, all inside `tx`. A stored state that cannot
 * be decoded is treated as empty — this save is never lost because an older one is unreadable.
 */
export async function saveWorkspaceTx<Ref>(
  tx: SyncTx<Ref>,
  ref: SyncRef<Ref>,
  userId: string,
  incoming: WorkspacePayload,
): Promise<SaveOutcome> {
  let stored: StoredWorkspace;
  try {
    stored = await readWorkspaceTx(tx, ref, userId);
  } catch {
    stored = { payload: { sessions: [], lastApp: '' }, chunkCount: 0, updatedAt: null, exists: false };
  }
  const merged = mergeWorkspaceState(stored.payload, incoming);
  const encoded = encodeWorkspace(merged);
  if (encoded.manifest.totalBytes > MAX_WORKSPACE_BYTES) {
    return { ok: false, tooLarge: true, totalBytes: encoded.manifest.totalBytes, limit: MAX_WORKSPACE_BYTES };
  }
  encoded.chunks.forEach((chunk, i) => tx.set(ref(chunkDocId(userId, i)), { data: chunk }));
  for (let i = encoded.chunks.length; i < stored.chunkCount; i++) tx.delete(ref(chunkDocId(userId, i)));
  tx.set(ref(userId), { userId, ...encoded.manifest });
  return {
    ok: true,
    stored: merged.sessions.length, // count AFTER the server-side merge
    chunks: encoded.chunks.length,
    totalBytes: encoded.manifest.totalBytes,
    updatedAt: encoded.manifest.updatedAt,
  };
}
