import { describe, it, expect, afterEach } from 'vitest';
import {
  freeTierCheapEnabled,
  isFreeTierUser,
  isFreeTierBuild,
  freeTierUpsellMessage,
  powerModeBlockedForFreeUser,
  powerModePaidOnlyMessage,
} from './FreeTierBuildRouting';

const ORIG = process.env.AGENTV3_FREE_TIER_CHEAP;
afterEach(() => {
  if (ORIG === undefined) delete process.env.AGENTV3_FREE_TIER_CHEAP;
  else process.env.AGENTV3_FREE_TIER_CHEAP = ORIG;
});

describe('freeTierCheapEnabled — the dormant master switch', () => {
  it('is OFF unless the env is exactly "true"', () => {
    delete process.env.AGENTV3_FREE_TIER_CHEAP;
    expect(freeTierCheapEnabled()).toBe(false);
    process.env.AGENTV3_FREE_TIER_CHEAP = '1';
    expect(freeTierCheapEnabled()).toBe(false); // only 'true' counts
    process.env.AGENTV3_FREE_TIER_CHEAP = 'true';
    expect(freeTierCheapEnabled()).toBe(true);
  });
});

describe('isFreeTierUser — never-purchased ⇒ free tier', () => {
  it('a user who has never paid is free tier', () => {
    expect(isFreeTierUser({ totalMoneySpent: 0 })).toBe(true);
    expect(isFreeTierUser({})).toBe(true);
    expect(isFreeTierUser(null)).toBe(true);
    expect(isFreeTierUser(undefined)).toBe(true);
  });

  it('any real purchase graduates the user to paying (normal Claude path)', () => {
    expect(isFreeTierUser({ totalMoneySpent: 100 })).toBe(false);
    expect(isFreeTierUser({ totalMoneySpent: 0.5 })).toBe(false);
  });

  it('a non-finite / negative value is treated conservatively as free tier (never spend Claude)', () => {
    expect(isFreeTierUser({ totalMoneySpent: NaN })).toBe(true);
    expect(isFreeTierUser({ totalMoneySpent: -5 })).toBe(true);
    expect(isFreeTierUser({ totalMoneySpent: 'x' })).toBe(true);
  });
});

describe('isFreeTierBuild — the AND of every activation condition', () => {
  const base = { enabled: true, billingActive: true, cheapFloorConfigured: true, wallet: { totalMoneySpent: 0 } };

  it('active only when ALL conditions hold', () => {
    expect(isFreeTierBuild(base)).toBe(true);
  });

  it('inactive if the switch is off (dormant)', () => {
    expect(isFreeTierBuild({ ...base, enabled: false })).toBe(false);
  });

  it('inactive if the paid surface is not active for this user', () => {
    expect(isFreeTierBuild({ ...base, billingActive: false })).toBe(false);
  });

  it('inactive if no cheap floor is configured (cannot route cheap-only)', () => {
    expect(isFreeTierBuild({ ...base, cheapFloorConfigured: false })).toBe(false);
  });

  it('inactive for a paying user (they take the normal Claude-first path)', () => {
    expect(isFreeTierBuild({ ...base, wallet: { totalMoneySpent: 500 } })).toBe(false);
  });
});

describe('freeTierUpsellMessage', () => {
  it('is friendly, provider-agnostic (no model names leaked to the user)', () => {
    const msg = freeTierUpsellMessage();
    expect(msg).toMatch(/add credits/i);
    expect(msg).not.toMatch(/claude|glm|kimi|gemini|vertex|opus|sonnet/i);
  });
});

describe('powerModeBlockedForFreeUser — Slice F: power mode is for PAYING accounts only', () => {
  it('blocks a power request from a never-paid account', () => {
    expect(powerModeBlockedForFreeUser(true, { totalMoneySpent: 0 })).toBe(true);
    expect(powerModeBlockedForFreeUser(true, null)).toBe(true); // unknown wallet = conservative block
  });

  it('allows a power request from a paying account', () => {
    expect(powerModeBlockedForFreeUser(true, { totalMoneySpent: 500 })).toBe(false);
  });

  it('never touches a NORMAL (non-power) build, paid or not', () => {
    expect(powerModeBlockedForFreeUser(false, { totalMoneySpent: 0 })).toBe(false);
    expect(powerModeBlockedForFreeUser(false, null)).toBe(false);
  });

  it('the refusal message asks for credits without leaking model names', () => {
    const msg = powerModePaidOnlyMessage();
    expect(msg).toMatch(/add credits/i);
    expect(msg).not.toMatch(/claude|glm|kimi|gemini|vertex|opus|sonnet/i);
  });
});
