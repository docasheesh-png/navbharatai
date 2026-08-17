import { describe, it, expect } from 'vitest';
import { allowVerify, VERIFY_COOLDOWN_MS, VERIFY_COOLDOWN_MAX_ENTRIES } from './secrets';

describe('allowVerify — the throttle on /api/secrets/:userId/verify', () => {
  it('allows the first call and refuses an immediate second', () => {
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 1_000)).toBe(true);
    expect(allowVerify(state, 'u1', 1_000)).toBe(false);
    expect(allowVerify(state, 'u1', 1_000 + VERIFY_COOLDOWN_MS - 1)).toBe(false);
  });

  it('allows again once the cooldown has passed', () => {
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 1_000)).toBe(true);
    expect(allowVerify(state, 'u1', 1_000 + VERIFY_COOLDOWN_MS)).toBe(true);
  });

  it('throttles per user — one busy caller cannot block anybody else', () => {
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 1_000)).toBe(true);
    expect(allowVerify(state, 'u2', 1_000)).toBe(true);
    expect(allowVerify(state, 'u1', 1_000)).toBe(false);
    expect(allowVerify(state, 'u2', 1_000)).toBe(false);
  });

  it('a REFUSED call does not extend the cooldown', () => {
    // Otherwise a client that retries in a tight loop would lock itself out indefinitely.
    const state = new Map<string, number>();
    expect(allowVerify(state, 'u1', 0)).toBe(true);
    for (let t = 1; t < VERIFY_COOLDOWN_MS; t += 500) allowVerify(state, 'u1', t);
    expect(allowVerify(state, 'u1', VERIFY_COOLDOWN_MS)).toBe(true);
  });

  it('is bounded — the map cannot grow into a leak on a long-lived instance', () => {
    const state = new Map<string, number>();
    for (let i = 0; i < VERIFY_COOLDOWN_MAX_ENTRIES + 50; i++) allowVerify(state, `u${i}`, i);
    expect(state.size).toBeLessThanOrEqual(VERIFY_COOLDOWN_MAX_ENTRIES);
  });

  it('stays correct for the caller that triggered the flush', () => {
    const state = new Map<string, number>();
    for (let i = 0; i < VERIFY_COOLDOWN_MAX_ENTRIES; i++) allowVerify(state, `u${i}`, i);
    expect(allowVerify(state, 'flusher', 10_000_000)).toBe(true);
    expect(allowVerify(state, 'flusher', 10_000_000)).toBe(false); // its own entry survived the clear
  });
});
