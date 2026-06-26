import { describe, it, expect, afterEach } from 'vitest';
import { onboardingEligible, freeOnboardingLimit } from '../src/server/lib/OnboardingCreditStore';

describe('onboardingEligible (P9 — pure free-build policy)', () => {
  it('is OFF when the limit is 0 or negative (dormant default)', () => {
    expect(onboardingEligible(0, 0)).toBe(false);
    expect(onboardingEligible(0, -1)).toBe(false);
  });

  it('grants free builds up to (not including) the limit', () => {
    expect(onboardingEligible(0, 3)).toBe(true); // 1st build free
    expect(onboardingEligible(1, 3)).toBe(true); // 2nd
    expect(onboardingEligible(2, 3)).toBe(true); // 3rd
    expect(onboardingEligible(3, 3)).toBe(false); // 4th — limit reached, now billed
    expect(onboardingEligible(5, 3)).toBe(false);
  });

  it('treats missing/NaN usage as zero used', () => {
    // @ts-expect-error — exercising defensive default
    expect(onboardingEligible(undefined, 1)).toBe(true);
  });

  it('rejects a non-finite limit (NaN/Infinity guarded out)', () => {
    expect(onboardingEligible(0, NaN)).toBe(false);
    expect(onboardingEligible(0, Infinity)).toBe(false); // not finite → never eligible (fail-safe)
  });
});

describe('freeOnboardingLimit (env parsing)', () => {
  const prev = process.env.AGENTV3_FREE_ONBOARDING_BUILDS;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_FREE_ONBOARDING_BUILDS;
    else process.env.AGENTV3_FREE_ONBOARDING_BUILDS = prev;
  });

  it('defaults to 0 (OFF) when unset or invalid', () => {
    delete process.env.AGENTV3_FREE_ONBOARDING_BUILDS;
    expect(freeOnboardingLimit()).toBe(0);
    process.env.AGENTV3_FREE_ONBOARDING_BUILDS = 'abc';
    expect(freeOnboardingLimit()).toBe(0);
    process.env.AGENTV3_FREE_ONBOARDING_BUILDS = '-2';
    expect(freeOnboardingLimit()).toBe(0);
  });

  it('parses a positive integer limit', () => {
    process.env.AGENTV3_FREE_ONBOARDING_BUILDS = '3';
    expect(freeOnboardingLimit()).toBe(3);
  });
});
