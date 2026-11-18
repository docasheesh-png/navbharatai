/** Owner improvement #1: a family is suspected down only on independent evidence, and only shown. */
import { describe, expect, it } from 'vitest';
import { familyOfHealthProvider, suspectedFamilyOutages, FAMILY_WINDOW_MS, type HealthObservation } from './familyHealth';

const NOW = 10_000_000;
const down = (provider: string, model: string, kind: HealthObservation['kind'] = 'timeout', at = NOW - 1000): HealthObservation =>
  ({ provider, state: 'down', kind, at, model, source: 'local' });

describe('family-wide verdicts need independent evidence', () => {
  it('one provider down, however often, is that provider only', () => {
    expect(suspectedFamilyOutages([down('free-chat-chain:deepseek', 'deepseek-flash'), down('free-chat-chain:deepseek', 'deepseek-flash')], NOW)).toEqual([]);
  });
  it('two DIFFERENT providers down on routes that share a maker → suspected outage of that domain', () => {
    const v = suspectedFamilyOutages([down('free-chat-chain:deepseek', 'deepseek-flash'), down('ENGINE_R1', 'deepseek-v4')], NOW);
    expect(v).toEqual([{ domain: 'deepseek', providers: ['deepseek', 'router-one'], since: NOW - 1000 }]);
  });
  it('an empty balance or a rate limit is never upstream evidence', () => {
    expect(suspectedFamilyOutages([
      { ...down('free-chat-chain:deepseek', 'deepseek-flash'), state: 'suspended', kind: 'suspended' },
      down('ENGINE_R1', 'deepseek-v4', 'rate-limit'),
    ], NOW)).toEqual([]);
  });
  it('two providers down only on rate limits: not an outage (each guard checked on its own)', () => {
    expect(suspectedFamilyOutages([down('free-chat-chain:deepseek', 'deepseek-flash', 'rate-limit'), down('ENGINE_R1', 'deepseek-v4', 'rate-limit')], NOW)).toEqual([]);
    expect(suspectedFamilyOutages([down('free-chat-chain:deepseek', 'deepseek-flash', 'suspended'), down('ENGINE_R1', 'deepseek-v4', 'suspended')], NOW)).toEqual([]);
  });
  it('two SUSPENDED accounts are two account problems, even with outage-shaped errors', () => {
    expect(suspectedFamilyOutages([
      { ...down('free-chat-chain:deepseek', 'deepseek-flash'), state: 'suspended' },
      { ...down('ENGINE_R1', 'deepseek-v4'), state: 'suspended' },
    ], NOW)).toEqual([]);
  });
  it('old evidence expires', () => {
    expect(suspectedFamilyOutages([down('free-chat-chain:deepseek', 'deepseek-flash', 'timeout', NOW - FAMILY_WINDOW_MS - 1), down('ENGINE_R1', 'deepseek-v4')], NOW)).toEqual([]);
  });
  it('unrelated providers never combine; a reseller\'s own gateway is not a shared domain', () => {
    expect(suspectedFamilyOutages([down('GLM', 'glm-5.3'), down('KIMI', 'kimi-k3')], NOW)).toEqual([]);
    expect(suspectedFamilyOutages([down('ENGINE_R1', 'beam'), down('ENGINE_BM', 'mystery')], NOW)).toEqual([]);
  });
  it('labels from every path resolve', () => {
    expect(familyOfHealthProvider('free-chat-chain:glm47')).toBe('glm');
    expect(familyOfHealthProvider('GLM#2')).toBe('glm');
    expect(familyOfHealthProvider('ENGINE_QX')).toBe('qubax');
  });
});
