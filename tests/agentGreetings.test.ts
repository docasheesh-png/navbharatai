import { describe, it, expect } from 'vitest';
import {
  NBI_GREETINGS,
  BASIC_GREETINGS,
  PRO_GREETINGS,
  VIP_GREETINGS,
  greetingsForAgent,
  pickGreetingForAgent,
} from '../src/lib/agentGreetings';

describe('greetingsForAgent', () => {
  it('returns VIP pool for vishwakarma_vip', () => {
    expect(greetingsForAgent('vishwakarma_vip')).toBe(VIP_GREETINGS);
  });
  it('returns Pro pool for vishwakarma_pro', () => {
    expect(greetingsForAgent('vishwakarma_pro')).toBe(PRO_GREETINGS);
  });
  it('returns Basic pool for vishwakarma_basic', () => {
    expect(greetingsForAgent('vishwakarma_basic')).toBe(BASIC_GREETINGS);
  });
  it('falls back to NBI pool for any other agent', () => {
    expect(greetingsForAgent('navbharatai')).toBe(NBI_GREETINGS);
    expect(greetingsForAgent('')).toBe(NBI_GREETINGS);
    expect(greetingsForAgent('unknown')).toBe(NBI_GREETINGS);
  });
});

describe('pickGreetingForAgent', () => {
  it('uses the injected picker (deterministic)', () => {
    const first = (arr: string[]) => arr[0];
    expect(pickGreetingForAgent('vishwakarma_vip', first)).toBe(VIP_GREETINGS[0]);
    expect(pickGreetingForAgent('navbharatai', first)).toBe(NBI_GREETINGS[0]);
  });

  it('returns a string from the correct pool with the default random picker', () => {
    const result = pickGreetingForAgent('vishwakarma_pro');
    expect(PRO_GREETINGS).toContain(result);
  });

  it('default picker always returns a member of the chosen pool', () => {
    for (let i = 0; i < 20; i++) {
      const result = pickGreetingForAgent('vishwakarma_basic');
      expect(BASIC_GREETINGS).toContain(result);
    }
  });
});

describe('greeting pools integrity', () => {
  it('every pool is non-empty and all entries are non-empty strings', () => {
    for (const pool of [NBI_GREETINGS, BASIC_GREETINGS, PRO_GREETINGS, VIP_GREETINGS]) {
      expect(pool.length).toBeGreaterThan(0);
      for (const line of pool) {
        expect(typeof line).toBe('string');
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });
});
