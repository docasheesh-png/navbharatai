// ERASING THE SYNCED WORKSPACE — the part of right-to-be-forgotten that no key strategy could reach.
//
// 🔴 WHY THIS IS ITS OWN MODULE, AND NOT A REGISTRY ENTRY (Q-763).
//
// `user_workspaces/{uid}` looks like the most obvious `'docId'` entry in the repo: the document id IS
// the uid. It is also only a MANIFEST — `{ version, chunkCount, totalBytes, updatedAt }` — while the
// person's entire synced workspace (every chat session and the last app they built) lives in separate
// documents at `user_workspaces/{uid}__c{i}`.
//
// So adding it to `USER_SCOPED_COLLECTIONS` as `'docId'` would have deleted the INDEX and kept the
// DATA: an erase that reports success, satisfies every test, and leaves the user's workspace in our
// database for ever, now unreachable because the manifest that counted its chunks is gone. That is
// strictly worse than the state before, and it is the same shape of mistake Q-134 made with a
// subcollection and Q-701 PR A nearly made with `agentv3_conversations`.
//
// `DataRetentionManager`'s header is explicit that it is exact-match only — `docId` or a field — and
// that nothing goes in on a guess, because a wrong strategy either misses data or deletes the wrong
// person's. A manifest-and-chunks layout is a shape it does not have, and contorting it to fit would
// weaken the one property that makes that registry safe. Hence a small module of its own, called from
// `DELETE /api/profile` beside `deleteUserWorkspaceData`.
//
// ⚠️ NO PREFIX QUERY, DELIBERATELY. `workspaceDataErase.ts` documents why a doc-id prefix range is
// dangerous here: a uid that itself contains the separator makes the range ambiguous, and getting it
// wrong deletes a different person's data. Every id below is constructed exactly, by the same builder
// `routes/sync.ts` writes through.

import { chunkDocId, maxChunkCount } from '../project/WorkspaceStore';

export const SYNC_COLLECTION = 'user_workspaces';

/** The smallest Firestore surface this needs. Injected, so the real logic is unit-testable. */
export interface SyncEraseDocRef {
  get(): Promise<{ exists: boolean; data?(): Record<string, unknown> | undefined }>;
  delete(): Promise<unknown>;
}
export interface SyncEraseFirestore {
  collection(name: string): { doc(id: string): SyncEraseDocRef };
}

export interface SyncWorkspaceEraseReport {
  uid: string;
  /** Chunk documents deleted. */
  chunks: number;
  /** Whether the manifest (or a legacy v1 single document) was there and is now gone. */
  manifestDeleted: boolean;
  /** How many chunk ids were probed — `max(chunkCount, ceiling)`, so a reader can check the sweep. */
  probed: number;
  error?: string;
}

/**
 * Erase `uid`'s synced workspace: every chunk document, then the manifest.
 *
 * 🔒 CHUNKS FIRST, MANIFEST LAST — and this order is the whole safety argument.
 *
 * The manifest is the only thing that says how many chunks there are. Delete it first and a failure
 * one step later strands the chunks: nothing left points at them, so neither a retry of this code nor
 * any future sweep can find them by anything but a prefix query, which is the thing this module
 * refuses to do. In this order a partial failure leaves the manifest in place, so running it again
 * finishes the job — the same reasoning `deleteUserWorkspaceData` and `deleteUserData`'s `subs` use.
 *
 * Never throws: a failure is reported, because account deletion must not be blocked by this one step.
 */
export async function eraseSyncedWorkspace(
  db: SyncEraseFirestore,
  uid: string,
): Promise<SyncWorkspaceEraseReport> {
  if (!uid || typeof uid !== 'string') {
    // Refused rather than attempted: an empty uid would build the ids `__c0`, `__c1`, … which are real,
    // constructible document names belonging to nobody. Deleting those is not a no-op.
    return { uid: String(uid ?? ''), chunks: 0, manifestDeleted: false, probed: 0, error: 'a non-empty uid is required' };
  }
  const col = db.collection(SYNC_COLLECTION);
  let chunks = 0;
  let manifestDeleted = false;
  let probed = 0;
  try {
    const manifestRef = col.doc(uid);
    const snap = await manifestRef.get();
    const data = snap.exists && typeof snap.data === 'function' ? snap.data() : undefined;
    const counted = typeof data?.chunkCount === 'number' && Number.isFinite(data.chunkCount)
      ? Math.max(0, Math.floor(data.chunkCount))
      : 0;

    // The manifest's own count, OR the format ceiling — whichever is larger. A save writes chunks
    // first and the manifest last, and deletes surplus chunks when a workspace shrinks, so either
    // step can be interrupted and leave chunks the manifest does not count. Sweeping to the ceiling
    // takes those too; deleting a document that is not there is a no-op.
    probed = Math.max(counted, maxChunkCount());
    for (let i = 0; i < probed; i++) {
      const ref = col.doc(chunkDocId(uid, i));
      const cs = await ref.get();
      if (!cs.exists) continue;
      await ref.delete();
      chunks++;
    }

    // Last, and only now: the manifest, or a legacy v1 single document that held the payload inline.
    if (snap.exists) {
      await manifestRef.delete();
      manifestDeleted = true;
    }
    return { uid, chunks, manifestDeleted, probed };
  } catch (e) {
    return { uid, chunks, manifestDeleted, probed, error: e instanceof Error ? e.message : String(e) };
  }
}
