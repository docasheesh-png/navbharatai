import { describe, it, expect } from 'vitest';
import {
  allowedPowerLevels,
  defaultPowerLevel,
  clampPowerForUser,
  powerWasClampedDown,
  POWER_LEVELS_ORDERED,
} from './powerGating';

describe('allowedPowerLevels — free users get ONLY weak, paid users get all three', () => {
  it('free → [weak]', () => {
    expect(allowedPowerLevels(false)).toEqual(['weak']);
  });
  it('paid → all three in order', () => {
    // Three since 2026-09-14: 'medium' (Powerful) and 'max' (Full Team) retired as choices.
    expect(allowedPowerLevels(true)).toEqual(['weak', 'off', 'mini']);
    expect(allowedPowerLevels(true)).toEqual(POWER_LEVELS_ORDERED);
  });
});

describe('defaultPowerLevel — Normal for paid, Weak for free', () => {
  it('paid default = off (Normal)', () => {
    expect(defaultPowerLevel(true)).toBe('off');
  });
  it('free default = weak', () => {
    expect(defaultPowerLevel(false)).toBe('weak');
  });
});

describe('clampPowerForUser — the money-critical server-side guard', () => {
  it('a FREE user is ALWAYS forced to weak, whatever they request (UI-bypass proof)', () => {
    for (const req of ['max', 'medium', 'mini', 'off', 'weak', true, 'garbage', undefined, null] as const) {
      expect(clampPowerForUser(req, false)).toBe('weak');
    }
  });
  it('a PAID user gets their requested tier', () => {
    expect(clampPowerForUser('mini', true)).toBe('mini');
    expect(clampPowerForUser('off', true)).toBe('off');
    expect(clampPowerForUser('weak', true)).toBe('weak');
  });
  it('🔴 a PAID user holding a RETIRED tier is moved UP to Strong, not reset to Normal', () => {
    // This is the path a real paying user actually takes on the day of the change: their stored
    // preference is 'max' or 'medium' and neither exists any more. Resetting them to the default
    // would quietly demote the users on the most expensive tier, which is the one downgrade nobody
    // would see and everybody would feel.
    expect(clampPowerForUser('max', true)).toBe('mini');
    expect(clampPowerForUser('medium', true)).toBe('mini');
  });
  it('and a retired tier still cannot get a FREE user past the weak clamp', () => {
    // The money-critical guard is unchanged by the collapse: the upward remap happens INSIDE
    // toPowerLevel, after the free check, so it can never become a way to reach a paid engine.
    expect(clampPowerForUser('max', false)).toBe('weak');
    expect(clampPowerForUser('medium', false)).toBe('weak');
  });
  it('a PAID user with an absent/invalid request falls back to the default (Normal)', () => {
    expect(clampPowerForUser(undefined, true)).toBe('off');
    expect(clampPowerForUser('nonsense', true)).toBe('off');
  });
  it('the legacy onlyOpus boolean maps through (true→mini for paid, forced weak for free)', () => {
    expect(clampPowerForUser(true, true)).toBe('mini');
    expect(clampPowerForUser(true, false)).toBe('weak');
  });
});

describe('powerWasClampedDown — did a free user get downgraded?', () => {
  it('true when a free user asked for a paid tier', () => {
    expect(powerWasClampedDown('max', false)).toBe(true);
    expect(powerWasClampedDown('off', false)).toBe(true);
  });
  it('false when a free user asked for weak (no downgrade)', () => {
    expect(powerWasClampedDown('weak', false)).toBe(false);
  });
  it('always false for a paid user', () => {
    expect(powerWasClampedDown('max', true)).toBe(false);
  });
});
