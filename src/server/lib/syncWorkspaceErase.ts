// Historical sync manifests and chunks share one physical document namespace:
// `user_workspaces/{uid}` and `user_workspaces/{uid}__c{i}`. An exact constructed
// key does not prove ownership: UID `abc__c0` names the same document as chunk 0
// of UID `abc`. Neither the manifest nor the historical chunk format records
// independent ownership proof. Retain these records until that proof is available.

export const SYNC_COLLECTION = 'user_workspaces';

export const SYNC_WORKSPACE_OWNERSHIP_ERASURE_LIMITATION = {
  code: 'sync-workspace-ownership-unverified',
  collection: SYNC_COLLECTION,
  message: 'Synced workspace records without independently verified ownership are retained pending ownership review.',
} as const;

/** Retained for callers that inject the existing sync datastore surface. */
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
  /** Whether a manifest or legacy inline document was deleted. */
  manifestDeleted: boolean;
  /** Chunk ids inspected; zero when ownership cannot be established. */
  probed: number;
  refusal?: 'ownership-unverified';
  limitations?: readonly { code: string; collection: string; message: string }[];
  error?: string;
}

/**
 * Preserve the account-erasure API while refusing ambiguous historical sync keys.
 * No UID spelling is sufficient proof: the raw manifest key can also be another
 * person's chunk, even when the requested UID contains no separator. Do not read
 * or delete these documents, or report them erased, based on this key alone.
 */
export async function eraseSyncedWorkspace(
  _db: SyncEraseFirestore,
  uid: string,
): Promise<SyncWorkspaceEraseReport> {
  if (!uid || typeof uid !== 'string') {
    return { uid: String(uid ?? ''), chunks: 0, manifestDeleted: false, probed: 0, error: 'a non-empty uid is required' };
  }
  return {
    uid,
    chunks: 0,
    manifestDeleted: false,
    probed: 0,
    refusal: 'ownership-unverified',
    limitations: [SYNC_WORKSPACE_OWNERSHIP_ERASURE_LIMITATION],
  };
}
