/** Cohort configuration is not identity or inference authority. Never log the UID list. */
export interface GatewayRollout {
  readonly mode: 'canary' | 'all' | 'invalid';
  readonly uids: readonly string[];
}
export function gatewayRollout(env: Record<string, string | undefined> = process.env): GatewayRollout {
  const mode = env.INFERENCE_GATEWAY_ROLLOUT_MODE?.trim() || 'canary';
  const raw = env.INFERENCE_GATEWAY_CANARY_UIDS ?? '';
  if (!['canary', 'all'].includes(mode) || raw.length > 4127) return { mode: 'invalid', uids: [] };
  const uids = raw.trim() ? raw.split(',').map(uid => uid.trim()) : [];
  if (uids.length > 32 || uids.some(uid => !/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) || new Set(uids).size !== uids.length) {
    return { mode: 'invalid', uids: [] };
  }
  return { mode: mode as 'canary' | 'all', uids: Object.freeze(uids) };
}
/** Call only with the UID obtained from the server's verified Firebase identity boundary. */
export function gatewayRolloutAllowsUid(rollout: GatewayRollout, verifiedUid: string | null | undefined): boolean {
  return rollout.mode === 'all' || (rollout.mode === 'canary' && !!verifiedUid && rollout.uids.includes(verifiedUid));
}
export function gatewayRolloutAllowsGuest(env: Record<string, string | undefined> = process.env): boolean {
  return gatewayRollout(env).mode === 'all';
}
