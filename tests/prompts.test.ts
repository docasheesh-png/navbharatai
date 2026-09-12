import { describe, it, expect } from 'vitest';
import {
  getSecurityContext,
  getBharatContext,
  getApiKeysInstruction,
  NAVBHARAT_OS_V2,
} from '../src/server/lib/prompts';

describe('prompts', () => {
  it('getSecurityContext includes the target string', () => {
    const ctx = getSecurityContext('example.com');
    expect(ctx).toContain('example.com');
  });

  it('getSecurityContext returns a non-empty string', () => {
    expect(getSecurityContext('test')).toBeTruthy();
  });

  it('getBharatContext returns a non-empty string', () => {
    expect(getBharatContext()).toBeTruthy();
  });

  it('getApiKeysInstruction returns a non-empty string', () => {
    expect(getApiKeysInstruction()).toBeTruthy();
  });

  it('NAVBHARAT_OS_V2 is a string with content', () => {
    expect(typeof NAVBHARAT_OS_V2).toBe('string');
    expect(NAVBHARAT_OS_V2.length).toBeGreaterThan(100);
  });

  /**
   * 🔴 WHY THIS IS ASSERTED ON THE LIVE PROMPT AND NOT JUST ON A DELETED EXPORT.
   *
   * NAVBHARAT_OS_V2 is the FREE chat's whole system prompt — `getBharatContext` interpolates it — and
   * it used to describe "Vishwakarma" agents with Basic/Pro/VIP tiers and three "SAKUNI" modes. After
   * that surface was deleted the prompt was still teaching the model to send users to a place that no
   * longer exists, which is the kind of rot no typecheck and no route test can see.
   *
   * (Worth recording: a grep that EXCLUDED prompts.ts reported this constant as having zero uses. It
   * is used, inside its own file, by template interpolation. That is why this test reads the live
   * prompt rather than trusting a reference count.)
   */
  it('🔒 the live system prompt names no deleted surface, and points at the real one', () => {
    const live = getBharatContext().toLowerCase();
    expect(live).not.toContain('vishwakarma');
    expect(live).not.toContain('sakuni');
    expect(live).toContain('navbharatai pro');
  });

  it('🔒 the deleted prompt builders are gone from the module surface', async () => {
    const mod = await import('../src/server/lib/prompts');
    for (const dead of ['getVishwakarmaBasicContext', 'getVishwakarmaProContext', 'getVishwakarmaVipContext']) {
      expect(Object.keys(mod), dead).not.toContain(dead);
    }
  });
});
