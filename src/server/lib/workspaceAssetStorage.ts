/** The private asset writer and account eraser must address the same bucket and object namespace. */
export function workspaceAssetBucketName(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.WORKSPACE_ASSETS_BUCKET || env.NAV_STORE_BUCKET || env.FIREBASE_STORAGE_BUCKET || '').trim();
}

const OBJECT_ROOT = 'workspace-assets';

/** Accepts an internal workspace id or an ownership-verified workspace-id prefix. */
export function workspaceAssetObjectPrefix(workspaceIdPrefix: string): string {
  return `${OBJECT_ROOT}/${workspaceIdPrefix}`;
}

export function workspaceAssetObjectKey(workspaceId: string, assetId: string): string {
  return `${workspaceAssetObjectPrefix(workspaceId)}/${assetId}`;
}
