import { safeWorkspaceUid } from './workspaceIdentity';

/** The private asset writer and account eraser must address the same bucket and object namespace. */
export function workspaceAssetBucketName(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.WORKSPACE_ASSETS_BUCKET || env.NAV_STORE_BUCKET || env.FIREBASE_STORAGE_BUCKET || '').trim();
}

const OBJECT_ROOT = 'workspace-assets';
const VERIFIED_OWNER_OBJECT_ROOT = 'workspace-assets-v2';

/** Legacy workspace keys carry no independently verified owner; never use this prefix for erasure. */
export function workspaceAssetObjectPrefix(workspaceIdPrefix: string): string {
  return `${OBJECT_ROOT}/${workspaceIdPrefix}`;
}

export function workspaceAssetObjectKey(workspaceId: string, assetId: string): string {
  return `${workspaceAssetObjectPrefix(workspaceId)}/${assetId}`;
}

/**
 * The one encoding of a VERIFIED owner inside an object key in the private bucket (the workspace-asset spills and the game
 * proof pictures, Q-3410), so the account eraser can name every owner-filed object from the uid alone. base64url never
 * contains `/`, so the segment is always exactly one path level. null for an unusable or anonymous uid: such an object has
 * no owner to file it under. Only an identity verified by the server may be passed here — never a client-claimed one.
 */
export function verifiedOwnerKeySegment(verifiedOwnerUid: string | null | undefined): string | null {
  const uid = safeWorkspaceUid(verifiedOwnerUid);
  if (!uid || uid === 'anon') return null;
  return Buffer.from(uid, 'utf8').toString('base64url');
}

/** Only an identity verified by the server may select this namespace. Never infer it from a workspace id. */
export function workspaceAssetVerifiedOwnerPrefix(verifiedOwnerUid: string | null | undefined): string | null {
  const owner = verifiedOwnerKeySegment(verifiedOwnerUid);
  // The delimiter makes exact owners distinct even when either UID or its encoding prefixes another.
  return owner ? `${VERIFIED_OWNER_OBJECT_ROOT}/${owner}/` : null;
}

export function workspaceAssetVerifiedOwnerObjectKey(
  verifiedOwnerUid: string | null | undefined,
  workspaceId: string,
  assetId: string,
): string | null {
  const prefix = workspaceAssetVerifiedOwnerPrefix(verifiedOwnerUid);
  return prefix ? `${prefix}${Buffer.from(workspaceId, 'utf8').toString('base64url')}/${assetId}` : null;
}
