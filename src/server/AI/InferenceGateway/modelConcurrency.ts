/** Gateway-owned physical occupancy only. Preserved legacy account consumers are outside this bound. */
import { createHash } from 'node:crypto';
import { isIdentifier } from './capabilities';
import { evidenceBinding } from './profiles';
import { gatewayAccountScopeIds } from './accountMigration';
import type { ProviderProfile } from './types';

export interface ModelSlotIdentity { provider: 'GLM'; accountScopeIds: string[]; modelId: string }
export interface GatewayModelSlotPolicy extends ModelSlotIdentity {
  kind: 'gateway_model_slot_policy'; version: 1; revision: string; limit: number;
  accountReviewRef: string; reviewedAtMs: number; expiresAtMs: number;
}
export interface ModelSlotOccupant { intentBinding: string; claimBinding?: string; acquiredAtMs: number }
export interface GatewayModelSlotState {
  kind: 'gateway_model_slot_state'; version: 1; identity: ModelSlotIdentity;
  /** No TTL, day reset or credential generation can remove uncertain occupancy. */
  occupants: Record<string, ModelSlotOccupant>;
}
export interface HeldModelSlot { identity: ModelSlotIdentity; policyRevision: string; intentBinding: string }
const models = new Set(['glm-4.7-flash', 'glm-4.5-flash', 'glm-4.6v-flash']);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const same = (a: unknown, b: unknown) => evidenceBinding(a) === evidenceBinding(b);
export const modelSlotBinding = (value: unknown): string => createHash('sha256').update(evidenceBinding(value)).digest('hex');
const binding = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function assert(value: unknown): asserts value { if (!value) throw new Error('Gateway model occupancy unavailable'); }
export function validModelSlotIdentity(value: unknown): value is ModelSlotIdentity {
  const v = value as ModelSlotIdentity | undefined;
  return !!v && v.provider === 'GLM' && models.has(v.modelId) && Array.isArray(v.accountScopeIds)
    && v.accountScopeIds.length === 1 && v.accountScopeIds.every(isIdentifier)
    && same(v.accountScopeIds, [...new Set(v.accountScopeIds)].sort());
}
export function modelSlotIdentity(profile: Pick<ProviderProfile, 'providerId' | 'modelId' | 'quotaDimensions'>): ModelSlotIdentity | undefined {
  if (profile.providerId !== 'GLM') return undefined;
  const identity: ModelSlotIdentity = { provider: 'GLM', accountScopeIds: gatewayAccountScopeIds(profile.quotaDimensions), modelId: profile.modelId };
  assert(validModelSlotIdentity(identity)); return identity;
}
export function modelSlotPath(kind: 'policy' | 'state' | 'release', identity: ModelSlotIdentity | string): string {
  if (kind === 'release') assert(typeof identity === 'string' && isIdentifier(identity));
  else assert(validModelSlotIdentity(identity));
  return `free_chat_chain/gateway_model_slot_${kind}_${createHash('sha256').update(evidenceBinding(identity)).digest('hex')}`;
}
export function readModelSlotPolicy(raw: unknown, identity: ModelSlotIdentity, now: number): GatewayModelSlotPolicy {
  const v = raw as GatewayModelSlotPolicy | undefined;
  assert(v && v.kind === 'gateway_model_slot_policy' && v.version === 1 && same({ provider: v.provider, accountScopeIds: v.accountScopeIds, modelId: v.modelId }, identity)
    && isIdentifier(v.revision) && isIdentifier(v.accountReviewRef) && count(v.limit) && v.limit >= 1 && v.limit <= 64
    && count(v.reviewedAtMs) && count(v.expiresAtMs) && v.reviewedAtMs <= now && now < v.expiresAtMs
    && v.expiresAtMs - v.reviewedAtMs <= 86400000 && !('expireAt' in v) && !('expiresAt' in v));
  return v;
}
export function emptyModelSlotState(identity: ModelSlotIdentity): GatewayModelSlotState {
  assert(validModelSlotIdentity(identity)); return { kind: 'gateway_model_slot_state', version: 1, identity, occupants: {} };
}
export function readModelSlotState(raw: unknown, identity: ModelSlotIdentity): GatewayModelSlotState {
  const v = raw as GatewayModelSlotState | undefined;
  assert(v && v.kind === 'gateway_model_slot_state' && v.version === 1 && same(v.identity, identity)
    && v.occupants && typeof v.occupants === 'object' && !Array.isArray(v.occupants) && Object.keys(v.occupants).length <= 64
    && !('expireAt' in v) && !('expiresAt' in v));
  for (const [id, h] of Object.entries(v.occupants)) assert(isIdentifier(id) && h && binding(h.intentBinding) && (h.claimBinding === undefined || binding(h.claimBinding)) && count(h.acquiredAtMs));
  return v;
}
export function readHeldModelSlot(raw: unknown): HeldModelSlot {
  const v = raw as HeldModelSlot | undefined;
  assert(v && validModelSlotIdentity(v.identity) && isIdentifier(v.policyRevision) && binding(v.intentBinding));
  return v;
}
