/**
 * Traffic Manager V2, P5: upstream diversity for the gateway's fallback (owner requirement: "Two resellers using the
 * same upstream must not be treated as independent fallbacks").
 *
 * 🔒 A ROUTING CHANGE, SO IT STARTS OFF AND REACHES STAFF FIRST (owner: "Do not deploy new routing behavior to all
 * users without successful canary validation"). `GATEWAY_FAMILY_DIVERSITY`:
 *   · unset / `off` — today's order, byte-identical;
 *   · `canary` — only for the verified staff uids already listed in `INFERENCE_GATEWAY_CANARY_UIDS`;
 *   · `on` — every gateway request. The owner sets this after the canary's decision records (P4) show it helps.
 * What it changes when on: ONLY the pick after a provider-side failure of the same request (see policy.ts
 * `diversified`). Free never jumps paid or the reverse; nothing is added; the owner's fixed chain order is kept
 * whenever the next rung is already independent.
 */
import type { ProviderProfile } from '../InferenceGateway/types';
import { gatewayRollout } from '../InferenceGateway/rollout';
import { familyOfGatewayProvider } from './controlDecision';
import { routeDependencies, UNKNOWN } from './upstreamFamilies';

export type DiversityMode = 'off' | 'canary' | 'on';
export function familyDiversityMode(env: NodeJS.ProcessEnv = process.env): DiversityMode {
  const v = String(env.GATEWAY_FAMILY_DIVERSITY ?? '').trim().toLowerCase();
  return v === 'on' || v === 'canary' ? v : 'off';
}

/** Is diversity applied to this request? Decided from the verified principal the gateway already holds. */
export function familyDiversityFor(principalId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = familyDiversityMode(env);
  if (mode === 'on') return true;
  if (mode !== 'canary') return false;
  const rollout = gatewayRollout(env);
  return rollout.mode !== 'invalid' && rollout.uids.includes(principalId);
}

/** The outage domains a gateway profile's route depends on. An unclassified provider is independent of nothing. */
export function profileDependsOn(profile: Pick<ProviderProfile, 'providerId' | 'modelId'>): readonly string[] {
  try { return routeDependencies(familyOfGatewayProvider(profile.providerId), profile.modelId).dependsOn; }
  catch { return [UNKNOWN]; }
}
