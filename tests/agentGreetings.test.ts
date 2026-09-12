import { describe, it, expect } from 'vitest';
import { NBI_GREETINGS, greetingsForAgent, pickGreetingForAgent } from '../src/lib/agentGreetings';

/**
 * One greeting pool, since 2026-09-12.
 *
 * The Vishwakarma Basic / Pro / VIP pools went with Vishwakarma itself. What still matters — and what
 * these tests pin — is that an agent id nobody recognises, INCLUDING a legacy `vishwakarma_*` id still
 * stored on a real user's saved session, gets a real greeting rather than `undefined`. That is the one
 * way this could break silently: the session restores, the greeting line is empty, and the chat opens
 * with a blank first message.
 */
describe('greetingsForAgent', () => {
  it('returns the one pool for every agent', () => {
    for (const agent of ['navbharatai', 'navbharatai-pro', 'sda', 'unknown', '']) {
      expect(greetingsForAgent(agent), agent).toBe(NBI_GREETINGS);
    }
  });

  it('🔒 a LEGACY vishwakarma agent id still resolves to a real pool, not undefined', () => {
    for (const legacy of ['vishwakarma_basic', 'vishwakarma_pro', 'vishwakarma_vip']) {
      const pool = greetingsForAgent(legacy);
      expect(pool, legacy).toBe(NBI_GREETINGS);
      expect(pool.length).toBeGreaterThan(0);
    }
  });
});

describe('pickGreetingForAgent', () => {
  it('uses the injected picker (deterministic)', () => {
    const first = (arr: string[]) => arr[0];
    expect(pickGreetingForAgent('navbharatai', first)).toBe(NBI_GREETINGS[0]);
    expect(pickGreetingForAgent('vishwakarma_vip', first)).toBe(NBI_GREETINGS[0]);
  });

  it('the default random picker always returns a real line, for a legacy id too', () => {
    for (let i = 0; i < 20; i++) {
      expect(NBI_GREETINGS).toContain(pickGreetingForAgent('navbharatai'));
      expect(NBI_GREETINGS).toContain(pickGreetingForAgent('vishwakarma_basic'));
    }
  });
});

describe('greeting pool integrity', () => {
  it('the pool is non-empty and every entry is a non-empty string', () => {
    expect(NBI_GREETINGS.length).toBeGreaterThan(0);
    for (const line of NBI_GREETINGS) {
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('names no deleted product', () => {
    const blob = NBI_GREETINGS.join(' ').toLowerCase();
    expect(blob).not.toContain('vishwakarma');
    expect(blob).not.toContain('sakuni');
  });
});
