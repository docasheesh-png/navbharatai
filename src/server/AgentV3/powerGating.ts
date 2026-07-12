// AgentV3 — POWER-TIER GATING by paid/free status (admin UI redesign 2026-07-12).
//
// The admin's design: the "Power" selector has five tiers — weak / normal / strong / powerful / full team
// (internal keys: 'weak' | 'off' | 'mini' | 'medium' | 'max'). A FREE user (logged in, never purchased) may
// use ONLY 'weak' (cheap floor GLM/Kimi, never Claude). A PAID user gets all five, defaulting to 'normal'.
//
// This gate is ENFORCED SERVER-SIDE, not just in the UI: a free user's build is clamped to 'weak' no matter
// what power the client sends, so a free account can never spend NavBharatAI's Claude/Opus budget by
// bypassing the UI (the money-leak class we keep closing). Pure + fully unit-tested.

import type { PowerLevel } from './powerLevel';
import { toPowerLevel } from './powerLevel';

/** The five tiers, cheapest → strongest, in display order. */
export const POWER_LEVELS_ORDERED: PowerLevel[] = ['weak', 'off', 'mini', 'medium', 'max'];

/**
 * The power levels a user may choose. A PAID user (has ever purchased, or a free-list admin/tester) gets
 * all five; a FREE user gets ONLY 'weak'. Pure.
 */
export function allowedPowerLevels(isPaid: boolean): PowerLevel[] {
  return isPaid ? [...POWER_LEVELS_ORDERED] : ['weak'];
}

/** The default power level: 'off' (Normal) for a paid user, 'weak' for a free user. Pure. */
export function defaultPowerLevel(isPaid: boolean): PowerLevel {
  return isPaid ? 'off' : 'weak';
}

/**
 * Clamp a requested power level to what the user is actually allowed. A FREE user is ALWAYS forced to
 * 'weak' (the money-critical server-side guard) regardless of what the client asked for. A PAID user
 * gets their requested level (normalised), or the default when the request is absent/invalid. Pure.
 */
export function clampPowerForUser(
  requested: PowerLevel | boolean | string | undefined | null,
  isPaid: boolean,
): PowerLevel {
  if (!isPaid) return 'weak'; // free users can ONLY use weak — enforced here, not just in the UI
  const level = toPowerLevel(requested);
  return allowedPowerLevels(true).includes(level) ? level : defaultPowerLevel(true);
}

/** True when the requested tier was DOWNGRADED by the clamp (a free user asked for a paid tier). */
export function powerWasClampedDown(
  requested: PowerLevel | boolean | string | undefined | null,
  isPaid: boolean,
): boolean {
  if (isPaid) return false;
  return toPowerLevel(requested) !== 'weak';
}
