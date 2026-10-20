import * as admin from 'firebase-admin';
import { planWorkspaceErase, type EraseRefusal } from './workspaceDataErase';
import { workspaceAssetBucketName, workspaceAssetObjectPrefix } from './workspaceAssetStorage';
import { notePersistenceFailure } from './persistenceHealth';

export interface WorkspaceAssetEraseReport {
  attempted: boolean;
  /** The configured bucket confirmed the prefix deletion; this cannot fence an in-flight upload. */
  removed: boolean;
  failures: string[];
  refusal?: EraseRefusal;
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
 * Erase completed private asset spills, including ones whose Firestore pointer was already erased.
 * The verified uid range supplies the exact object prefix; no ownership is guessed from pointers.
 * Bucket history, uploads still in flight and ZIP chunks need separate reconciliation.
 */
export async function eraseUserWorkspaceAssetObjects(
  uid: string,
  deps: WorkspaceAssetEraseDeps = liveDeps(),
): Promise<WorkspaceAssetEraseReport> {
  const plan = planWorkspaceErase(uid);
  if (!plan.range) return { attempted: false, removed: false, failures: [], refusal: plan.refusal };
  if (!deps.bucket) return {
    attempted: false, removed: false,
    failures: ['Workspace asset storage is not configured; removal could not be confirmed.'],
  };
  try {
    await deps.deletePrefix(deps.bucket, workspaceAssetObjectPrefix(plan.range.startAt));
    return { attempted: true, removed: true, failures: [] };
  } catch (error) {
    notePersistenceFailure('workspace_assets', 'write', error);
    return {
      attempted: true, removed: false,
      failures: ['Workspace asset storage could not confirm removal.'],
    };
  }
}
