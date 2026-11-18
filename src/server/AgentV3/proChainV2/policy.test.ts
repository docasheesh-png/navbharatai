import { describe, it, expect } from 'vitest';
import { proChainV2Decision, proChainV2EnabledFor, proChainV2Tuning, isProChainV2SupplierLabel } from './policy';

const Z_UID = 'GiYNmFcDMVYSWW48Nrurm7j41gv1';

describe('Pro Chain V2 — who gets it', () => {
  it('default: no profile activates deferred provider admission', () => {
    expect(proChainV2EnabledFor('weak', 'z@gmail.com', null, {})).toBe(false);
    expect(proChainV2EnabledFor('weak', ' Z@Gmail.com ', null, {})).toBe(false);
    expect(proChainV2EnabledFor('weak', null, Z_UID, {})).toBe(false);
    expect(proChainV2EnabledFor('weak', 'someone@gmail.com', 'uid-1', {})).toBe(false);
    expect(proChainV2EnabledFor('weak', null, null, {})).toBe(false);
    expect(proChainV2Decision('weak', 'z@gmail.com', null, {}).reason).toBe('admission-unavailable');
  });
  it('other bands never get it, even for z@', () => {
    for (const tier of ['off', 'mini', 'opus', 'max', '', null]) expect(proChainV2EnabledFor(tier as string, 'z@gmail.com', Z_UID, {})).toBe(false);
  });
  it('kill switch PRO_CHAIN_V2=off removes it for everyone, including public and z@', () => {
    expect(proChainV2EnabledFor('weak', 'z@gmail.com', Z_UID, { PRO_CHAIN_V2: 'off' })).toBe(false);
    expect(proChainV2EnabledFor('weak', 'a@b.c', null, { PRO_CHAIN_V2: 'OFF', PRO_CHAIN_V2_PUBLIC: 'on' })).toBe(false);
    expect(proChainV2Decision('weak', 'z@gmail.com', null, { PRO_CHAIN_V2: 'false' }).reason).toBe('kill-switch');
  });
  it('public flag cannot override admission deferral', () => {
    expect(proChainV2EnabledFor('weak', 'anyone@x.in', 'u', { PRO_CHAIN_V2_PUBLIC: 'on' })).toBe(false);
    expect(proChainV2EnabledFor('weak', null, null, { PRO_CHAIN_V2_PUBLIC: '1' })).toBe(false);
    expect(proChainV2EnabledFor('weak', 'anyone@x.in', 'u', { PRO_CHAIN_V2_PUBLIC: 'off' })).toBe(false);
    expect(proChainV2EnabledFor('off', 'anyone@x.in', 'u', { PRO_CHAIN_V2_PUBLIC: 'on' })).toBe(false);
  });
  it('allowlists cannot override admission deferral', () => {
    const env = { PRO_CHAIN_V2_USERS: 'tester@x.in, uid-9' };
    expect(proChainV2EnabledFor('weak', 'TESTER@x.in', null, env)).toBe(false);
    expect(proChainV2EnabledFor('weak', null, 'uid-9', env)).toBe(false);
    expect(proChainV2EnabledFor('weak', 'z@gmail.com', null, env)).toBe(false);
    expect(proChainV2EnabledFor('weak', 'ester@x.in', 'uid-99', env)).toBe(false);
    expect(proChainV2EnabledFor('weak', null, 'UID-9', env)).toBe(false);
  });
  it('labels and tuning defaults', () => {
    expect(isProChainV2SupplierLabel('ENGINE_QX')).toBe(true);
    expect(isProChainV2SupplierLabel('ENGINE_MF#2')).toBe(true);
    expect(isProChainV2SupplierLabel('GLM')).toBe(false);
    expect(isProChainV2SupplierLabel('ENGINE_R1')).toBe(false);
    expect(proChainV2Tuning({})).toEqual({ stickyTurns: 4, surplusSkipAfter: 3, surplusSkipMs: 120_000 });
    expect(proChainV2Tuning({ PRO_CHAIN_V2_STICKY_TURNS: '-1', PRO_CHAIN_V2_SURPLUS_SKIP_AFTER: 'x' }).stickyTurns).toBe(4);
  });
});
