import { describe, expect, it } from 'vitest';
import { gatewayRollout, gatewayRolloutAllowsGuest, gatewayRolloutAllowsUid } from './rollout';
describe('default-deny Gateway rollout configuration', () => {
  it('defaults to an empty canary, never everybody', () => {
    const c = gatewayRollout({}); expect(c).toEqual({ mode: 'canary', uids: [] });
    expect(gatewayRolloutAllowsUid(c, 'owner')).toBe(false); expect(gatewayRolloutAllowsGuest({})).toBe(false);
  });
  it('matches exact verified UIDs, not substrings, case variants or null', () => {
    const c = gatewayRollout({ INFERENCE_GATEWAY_CANARY_UIDS: ' owner,second-user ' });
    expect(gatewayRolloutAllowsUid(c, 'owner')).toBe(true);
    for (const uid of ['Owner', 'own', 'owner-suffix', null, undefined]) expect(gatewayRolloutAllowsUid(c, uid)).toBe(false);
  });
  it.each(['ALL', 'off', '*', 'typo'])('unknown mode %s selects nobody', mode => {
    const c = gatewayRollout({ INFERENCE_GATEWAY_ROLLOUT_MODE: mode, INFERENCE_GATEWAY_CANARY_UIDS: 'owner' });
    expect(c.mode).toBe('invalid'); expect(gatewayRolloutAllowsUid(c, 'owner')).toBe(false);
  });
  it.each(['owner,', ',owner', 'owner,,other', 'owner,owner', '*', 'owner\nother', 'a'.repeat(129), Array.from({ length: 33 }, (_, i) => `u${i}`).join(',')])('rejects the whole malformed list, never a partial allowlist', raw => {
    const c = gatewayRollout({ INFERENCE_GATEWAY_CANARY_UIDS: raw }); expect(c.mode).toBe('invalid');
    expect(gatewayRolloutAllowsUid(c, 'owner')).toBe(false);
  });
  it('only explicit all permits guests, and malformed lists cannot expand it', () => {
    expect(gatewayRolloutAllowsGuest({ INFERENCE_GATEWAY_ROLLOUT_MODE: 'all' })).toBe(true);
    expect(gatewayRolloutAllowsGuest({ INFERENCE_GATEWAY_ROLLOUT_MODE: 'all', INFERENCE_GATEWAY_CANARY_UIDS: '*' })).toBe(false);
  });
});
