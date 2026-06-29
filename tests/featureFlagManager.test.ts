import { describe, it, expect } from 'vitest';
import { isFlagEnabled, stableHashPercent, type FeatureFlagConfig } from '../src/server/FeatureFlagManager';

/**
 * P-PME.8 — feature flag evaluation (pure).
 */
describe('FeatureFlagManager — stableHashPercent', () => {
  it('is deterministic and in [0,100)', () => {
    const a = stableHashPercent('user-1', 'beta');
    expect(a).toBe(stableHashPercent('user-1', 'beta'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });
  it('differs across users / flags', () => {
    expect(stableHashPercent('user-1', 'beta')).not.toBe(stableHashPercent('user-2', 'beta'));
  });
});

describe('FeatureFlagManager — isFlagEnabled', () => {
  it('returns the global flag value', () => {
    const c: FeatureFlagConfig = { flags: { a: true, b: false } };
    expect(isFlagEnabled(c, 'a')).toBe(true);
    expect(isFlagEnabled(c, 'b')).toBe(false);
    expect(isFlagEnabled(c, 'missing')).toBe(false);
  });

  it('null config / no config → false', () => {
    expect(isFlagEnabled(null, 'a')).toBe(false);
    expect(isFlagEnabled(undefined, 'a')).toBe(false);
  });

  it('per-user override wins over everything (both directions)', () => {
    const c: FeatureFlagConfig = {
      flags: { a: false },
      overrides: { u1: { a: true }, u2: { a: false } },
      rollout: { a: 100 },
    };
    expect(isFlagEnabled(c, 'a', 'u1')).toBe(true);  // override true beats off-global
    expect(isFlagEnabled(c, 'a', 'u2')).toBe(false); // override false beats 100% rollout
  });

  it('percentage rollout: 100% on for any user, 0% off', () => {
    expect(isFlagEnabled({ flags: { a: false }, rollout: { a: 100 } }, 'a', 'anyone')).toBe(true);
    expect(isFlagEnabled({ flags: { a: false }, rollout: { a: 0 } }, 'a', 'anyone')).toBe(false);
  });

  it('rollout needs a userId — anonymous falls back to the global flag', () => {
    expect(isFlagEnabled({ flags: { a: false }, rollout: { a: 100 } }, 'a')).toBe(false);
  });

  it('rollout is consistent for a given user (bucketed)', () => {
    // A user below the threshold stays in for any pct >= their bucket.
    const userBucket = stableHashPercent('stableUser', 'a');
    const cfgIn: FeatureFlagConfig = { flags: { a: false }, rollout: { a: userBucket + 1 } };
    const cfgOut: FeatureFlagConfig = { flags: { a: false }, rollout: { a: userBucket } };
    expect(isFlagEnabled(cfgIn, 'a', 'stableUser')).toBe(true);   // bucket < pct
    expect(isFlagEnabled(cfgOut, 'a', 'stableUser')).toBe(false); // bucket == pct → not < pct
  });
});
