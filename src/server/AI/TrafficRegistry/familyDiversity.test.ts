/** P5: diversity is a routing change, so it is off by default and reaches staff canary uids first. */
import { describe, expect, it } from 'vitest';
import { familyDiversityFor, familyDiversityMode, profileDependsOn } from './familyDiversity';

describe('GATEWAY_FAMILY_DIVERSITY', () => {
  it('off unless set', () => {
    expect(familyDiversityMode({})).toBe('off');
    expect(familyDiversityFor('staff-1', {})).toBe(false);
    expect(familyDiversityMode({ GATEWAY_FAMILY_DIVERSITY: 'yes' })).toBe('off');
  });
  it('canary: only the verified staff uids already on the gateway canary list', () => {
    const env = { GATEWAY_FAMILY_DIVERSITY: 'canary', INFERENCE_GATEWAY_CANARY_UIDS: 'staff-1,staff-2' };
    expect(familyDiversityFor('staff-1', env)).toBe(true);
    expect(familyDiversityFor('customer-9', env)).toBe(false);
    expect(familyDiversityFor('staff-1', { GATEWAY_FAMILY_DIVERSITY: 'canary', INFERENCE_GATEWAY_CANARY_UIDS: 'bad uid!' })).toBe(false);
  });
  it('on: everyone', () => { expect(familyDiversityFor('anyone', { GATEWAY_FAMILY_DIVERSITY: 'on' })).toBe(true); });
  it('profile dependencies come from the P1 registry, unknown providers are independent of nothing', () => {
    expect(profileDependsOn({ providerId: 'DEEPINFRA', modelId: 'deepseek-ai/DeepSeek-V4-Flash-0731' })).toEqual(['deepinfra']);
    expect(profileDependsOn({ providerId: 'CHEAPERINFERENCE', modelId: 'beam' })).toContain('unknown');
    expect(profileDependsOn({ providerId: 'BRAND_NEW', modelId: 'x' })).toEqual(['unknown']);
  });
});
