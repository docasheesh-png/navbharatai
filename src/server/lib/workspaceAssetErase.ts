import * as admin from 'firebase-admin';
import type { EraseRefusal } from './workspaceDataErase';
import { workspaceAssetBucketName, workspaceAssetVerifiedOwnerPrefix } from './workspaceAssetStorage';
import { notePersistenceFailure } from './persistenceHealth';

export interface WorkspaceAssetEraseReport {
  attempted: boolean;
  /** Overall removal remains unconfirmed because legacy objects have no verified ownership proof. */
  removed: boolean;
  /** Confirms completed objects in the verified-owner namespace only; cannot fence in-flight uploads. */
  verifiedOwnerObjectsRemoved: boolean;
  failures: string[];
  limitations: string[];
  refusal?: EraseRefusal;
}

const LEGACY_OWNERSHIP_LIMITATION = 'Legacy workspace asset ownership cannot be confirmed; legacy objects are retained.';

export function unconfirmedWorkspaceAssetEraseReport(): WorkspaceAssetEraseReport {
  return {
    attempted: false,
    removed: false,
    verifiedOwnerObjectsRemoved: false,
    failures: [],
    limitations: [LEGACY_OWNERSHIP_LIMITATION],
  };
}

export interface WorkspaceAssetEraseDeps {
  bucket: string;
  deletePrefix(bucket: string, prefix: string): Promise<unknown>;
}

function liveDeps(): WorkspaceAssetEraseDeps {
  return {
    bucket: workspaceAssetBucketName(),
    deletePrefix: (bucket, prefix) => admin.storage().bucket(bucket).deleteFiles({ prefix }),
  };
}

/**
 * Erase completed spills written with a verified owner, even after their Firestore pointer is gone.
 * Legacy workspace-id prefixes are ambiguous and never supply ownership proof for deletion.
 * Legacy objects, bucket history, uploads still in flight and ZIP chunks need separate reconciliation.
 */
export async function eraseUserWorkspaceAssetObjects(
  uid: string,
  deps: WorkspaceAssetEraseDeps = liveDeps(),
): Promise<WorkspaceAssetEraseReport> {
  const report = unconfirmedWorkspaceAssetEraseReport();
  const prefix = workspaceAssetVerifiedOwnerPrefix(uid);
  if (!prefix) return { ...report, refusal: 'unusable-uid' };
  if (!deps.bucket) return {
    ...report,
    failures: ['Workspace asset storage is not configured; removal could not be confirmed.'],
  };
  try {
    await deps.deletePrefix(deps.bucket, prefix);
    return { ...report, attempted: true, verifiedOwnerObjectsRemoved: true };
  } catch (error) {
    notePersistenceFailure('workspace_assets', 'write', error);
    return {
      ...report, attempted: true,
      failures: ['Workspace asset storage could not confirm removal.'],
    };
  }
}
