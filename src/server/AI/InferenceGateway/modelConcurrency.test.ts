import { describe, expect, it } from 'vitest';
import { emptyModelSlotState, modelSlotBinding, modelSlotPath, readHeldModelSlot, readModelSlotPolicy, readModelSlotState, validModelSlotIdentity } from './modelConcurrency';
const identity = { provider: 'GLM' as const, accountScopeIds: ['reviewed-account'], modelId: 'glm-4.7-flash' };
const policy = { ...identity, kind: 'gateway_model_slot_policy', version: 1, revision: 'review-one', limit: 1, accountReviewRef: 'account-review', reviewedAtMs: 100, expiresAtMs: 200 };
describe('non-expiring exact-account model occupancy schema', () => {
  it('does not partition by credential, profile alias or day', () => {
    expect(modelSlotPath('state', identity)).toEqual(modelSlotPath('state', structuredClone(identity)));
    expect(modelSlotPath('state', { ...identity, modelId: 'glm-4.5-flash' })).not.toEqual(modelSlotPath('state', identity));
    expect(validModelSlotIdentity({ ...identity, accountScopeIds: ['reviewed-account', 'invented-second-scope'] })).toBe(false);
  });
  it.each([0, 65, 1.5, '1', null])('rejects unreviewed concurrency count %s', limit => {
    expect(() => readModelSlotPolicy({ ...policy, limit }, identity, 150)).toThrow();
  });
  it.each([99, 200, 86400100])('does not revive stale or future review at %i', now => {
    expect(() => readModelSlotPolicy(policy, identity, now)).toThrow();
  });
  it('refuses TTL fields and unbounded/corrupt occupied states', () => {
    const state = emptyModelSlotState(identity); expect(readModelSlotState(state, identity)).toEqual(state);
    expect(() => readModelSlotState({ ...state, expireAt: 300 }, identity)).toThrow();
    expect(() => readModelSlotPolicy({ ...policy, expireAt: 300 }, identity, 150)).toThrow();
    expect(() => readModelSlotState({ ...state, occupants: { one: { intentBinding: 'bad', acquiredAtMs: 100 } } }, identity)).toThrow();
    const occupants = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`attempt-${i}`, { intentBinding: 'a'.repeat(64), acquiredAtMs: 100 }]));
    expect(() => readModelSlotState({ ...state, occupants }, identity)).toThrow();
  });
  it('binds held reservations with fixed-size canonical digests', () => {
    const held = { identity, policyRevision: 'review-one', intentBinding: modelSlotBinding({ attempt: 'one' }) };
    expect(held.intentBinding).toMatch(/^[a-f0-9]{64}$/); expect(readHeldModelSlot(held)).toEqual(held);
    expect(() => readHeldModelSlot({ ...held, identity: { ...identity, modelId: 'unknown' } })).toThrow();
  });
});
