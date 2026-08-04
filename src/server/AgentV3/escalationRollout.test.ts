import { describe, it, expect } from 'vitest';
import { escalationRolloutPercent, rolloutBucket, inEscalationRollout, escalationCohort, inFlagRollout } from './escalationRollout';

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

describe('escalationCohort — the telemetry A/B label', () => {
  it('is "off" when the flag is not on, regardless of PCT', () => {
    expect(escalationCohort('ws-1', {} as NodeJS.ProcessEnv)).toBe('off');
    expect(escalationCohort('ws-1', { AGENTV3_ESCALATION_PCT: '50' } as NodeJS.ProcessEnv)).toBe('off');
  });

  it('is "in" for everyone at full rollout (on, no PCT)', () => {
    const env = { AGENTV3_ESCALATION: 'on' } as NodeJS.ProcessEnv;
    expect(escalationCohort('ws-1', env)).toBe('in');
    expect(escalationCohort(undefined, env)).toBe('in');
  });

  it('splits "in" vs "out" deterministically at a partial PCT — and matches inEscalationRollout exactly', () => {
    const env = { AGENTV3_ESCALATION: 'on', AGENTV3_ESCALATION_PCT: '50' } as NodeJS.ProcessEnv;
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const expected = inEscalationRollout(key, 50) ? 'in' : 'out';
      expect(escalationCohort(key, env)).toBe(expected); // labels must match gate behaviour
    }
    expect(escalationCohort(undefined, env)).toBe('out'); // no key at partial PCT → out (conservative)
  });
});

describe('inFlagRollout — the shared feature-flag percentage canary (feature-heal / vaccine reuse this)', () => {
  const key = 'ws-abc-123';
  it('off flag → always false regardless of PCT', () => {
    expect(inFlagRollout(false, undefined, key)).toBe(false);
    expect(inFlagRollout(false, '100', key)).toBe(false);
  });
  it('on + no PCT → 100% (byte-identical to a plain global "on")', () => {
    expect(inFlagRollout(true, undefined, key)).toBe(true);
    expect(inFlagRollout(true, '', key)).toBe(true);
    expect(inFlagRollout(true, '  ', key)).toBe(true);
  });
  it('on + malformed PCT → full rollout (never silently disables an explicitly-on flag)', () => {
    expect(inFlagRollout(true, 'abc', key)).toBe(true);
  });
  it('on + 0% → false, on + 100% → true', () => {
    expect(inFlagRollout(true, '0', key)).toBe(false);
    expect(inFlagRollout(true, '100', key)).toBe(true);
  });
  it('on + partial PCT is deterministic by key (matches rolloutBucket)', () => {
    expect(inFlagRollout(true, '50', key)).toBe(rolloutBucket(key) < 50);
    // no key under a partial rollout → conservatively OUT
    expect(inFlagRollout(true, '50', undefined)).toBe(false);
  });
});
