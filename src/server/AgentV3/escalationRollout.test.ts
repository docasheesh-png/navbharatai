import { describe, it, expect } from 'vitest';
import { escalationRolloutPercent, rolloutBucket, inEscalationRollout } from './escalationRollout';

// T1-escalation-on: the safe percentage canary. Pure — assert backward-compat + deterministic bucketing.

describe('escalationRolloutPercent', () => {
  it('is 0 when the flag is off/unset (escalation fully off — unchanged)', () => {
    expect(escalationRolloutPercent({} as NodeJS.ProcessEnv)).toBe(0);
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'off' } as NodeJS.ProcessEnv)).toBe(0);
  });

  it('is 100 when on with no PCT (identical to the old "on" semantics)', () => {
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'on' } as NodeJS.ProcessEnv)).toBe(100);
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'on', AGENTV3_ESCALATION_PCT: '' } as NodeJS.ProcessEnv)).toBe(100);
  });

  it('honors a valid PCT and clamps out-of-range / floors decimals', () => {
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'on', AGENTV3_ESCALATION_PCT: '10' } as NodeJS.ProcessEnv)).toBe(10);
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'on', AGENTV3_ESCALATION_PCT: '250' } as NodeJS.ProcessEnv)).toBe(100);
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'on', AGENTV3_ESCALATION_PCT: '-5' } as NodeJS.ProcessEnv)).toBe(0);
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'on', AGENTV3_ESCALATION_PCT: '12.9' } as NodeJS.ProcessEnv)).toBe(12);
  });

  it('defaults to full on a malformed PCT (flag is explicitly on)', () => {
    expect(escalationRolloutPercent({ AGENTV3_ESCALATION: 'on', AGENTV3_ESCALATION_PCT: 'abc' } as NodeJS.ProcessEnv)).toBe(100);
  });
});

describe('rolloutBucket', () => {
  it('is deterministic and in [0,100)', () => {
    const b = rolloutBucket('workspace-123');
    expect(b).toBe(rolloutBucket('workspace-123'));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });

  it('spreads keys across buckets (not all identical)', () => {
    const buckets = new Set(Array.from({ length: 50 }, (_, i) => rolloutBucket(`ws-${i}`)));
    expect(buckets.size).toBeGreaterThan(10);
  });
});

describe('inEscalationRollout', () => {
  it('100% includes everyone (even without a key), 0% excludes everyone', () => {
    expect(inEscalationRollout('any', 100)).toBe(true);
    expect(inEscalationRollout(undefined, 100)).toBe(true);
    expect(inEscalationRollout('any', 0)).toBe(false);
  });

  it('a partial rollout is deterministic per key and needs a key', () => {
    const decide = (k: string) => inEscalationRollout(k, 50);
    expect(decide('same-key')).toBe(decide('same-key')); // stable
    expect(inEscalationRollout(undefined, 50)).toBe(false); // no key → out of a partial rollout
  });

  it('a higher percentage never drops a key that a lower percentage already included (monotonic)', () => {
    const key = 'monotonic-check';
    const at = (p: number) => inEscalationRollout(key, p);
    if (at(20)) expect(at(60)).toBe(true);
    if (at(60)) expect(at(90)).toBe(true);
  });
});
