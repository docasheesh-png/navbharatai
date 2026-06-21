import { describe, it, expect } from 'vitest';
import {
  getSecurityContext,
  getBharatContext,
  getApiKeysInstruction,
  getVishwakarmaBasicContext,
  getVishwakarmaProContext,
  getVishwakarmaVipContext,
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

  it('getVishwakarmaBasicContext returns a non-empty string', () => {
    expect(getVishwakarmaBasicContext()).toBeTruthy();
  });

  it('getVishwakarmaProContext returns a non-empty string', () => {
    expect(getVishwakarmaProContext()).toBeTruthy();
  });

  it('getVishwakarmaVipContext returns a non-empty string', () => {
    expect(getVishwakarmaVipContext()).toBeTruthy();
  });

  it('NAVBHARAT_OS_V2 is a string with content', () => {
    expect(typeof NAVBHARAT_OS_V2).toBe('string');
    expect(NAVBHARAT_OS_V2.length).toBeGreaterThan(100);
  });
});
