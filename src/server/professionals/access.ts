// Professional access gate (admin 2026-07-15) — decides whether one professional chat turn is
// allowed, and whether it counts against the daily free quota.
//
// Monetisation model (admin-confirmed): the whole Professionals section becomes PAID via a flat
// "Professional Pass" (₹99/month unlocks ALL professionals, unlimited). Non-subscribers get a small
// daily free quota (default 10 messages/day across all professionals); the admin free-list is always
// unlimited. Doctor AI (SDA) is a professional too and shares this gate.
//
// This module is PURE + dependency-free so the money-sensitive decision is exhaustively unit-tested
// without any Firestore/clock. The route supplies the live facts (flag, free-list, pass, today's
// count); this function only decides. FLAG OFF ⇒ it allows everything exactly like today (no gating),
// so shipping it is safe long before the pay/UI paths exist.

export interface ProfessionalAccessInput {
  /** PROFESSIONAL_PAID_ENABLED — the master switch. When false, gating is inert (today's behaviour). */
  enabled: boolean;
  /** The caller is a verified signed-in user (a paid product needs an account to key quota/pass). */
  signedIn: boolean;
  /** Admin/test free-list — always unlimited, never billed. */
  isFreeListed: boolean;
  /** The user currently holds a non-expired Professional Pass. */
  hasActivePass: boolean;
  /** Free professional messages the user has already used TODAY (across all professionals). */
  usedToday: number;
  /** Daily free-message allowance for non-subscribers (default 10). */
  freeDailyLimit: number;
}

export type ProfessionalAccessReason =
  | 'disabled'          // flag off — no gating (today's behaviour)
  | 'free-list'         // admin/test — unlimited
  | 'pass'              // active Professional Pass — unlimited
  | 'within-free-quota' // no pass, but still inside today's free allowance
  | 'login-required'    // gating on, but the caller is anonymous
  | 'free-quota-exhausted'; // no pass and today's free allowance is used up

export interface ProfessionalAccessDecision {
  action: 'allow' | 'block';
  reason: ProfessionalAccessReason;
  /** Whether THIS turn should increment the daily free counter (only a within-quota free turn does). */
  countsAgainstFree: boolean;
  /** Free messages left AFTER this turn (0 for unlimited/blocked; informational for the UI). */
  remainingFree: number;
}

/**
 * Decide access for one professional chat turn. Order matters: the flag short-circuits FIRST so a
 * disabled gate is a perfect no-op; then unlimited tiers (free-list, pass); then the login
 * requirement; then the daily free quota. A blocked decision never counts against the quota.
 */
export function decideProfessionalAccess(input: ProfessionalAccessInput): ProfessionalAccessDecision {
  const { enabled, signedIn, isFreeListed, hasActivePass, usedToday, freeDailyLimit } = input;

  // Flag off → gating is completely inert: allow everything, count nothing (byte-for-byte today).
  if (!enabled) return { action: 'allow', reason: 'disabled', countsAgainstFree: false, remainingFree: 0 };

  // Unlimited tiers.
  if (isFreeListed) return { action: 'allow', reason: 'free-list', countsAgainstFree: false, remainingFree: 0 };

  // A paid product needs an account to key the pass and the per-user daily quota (an anonymous quota
  // is trivially bypassed by clearing state, so it would not be honest). Ask the user to sign in.
  if (!signedIn) return { action: 'block', reason: 'login-required', countsAgainstFree: false, remainingFree: 0 };

  if (hasActivePass) return { action: 'allow', reason: 'pass', countsAgainstFree: false, remainingFree: 0 };

  // Free quota. A non-positive limit means "no free messages" (day-1 paid, if the admin ever sets it).
  const limit = Number.isFinite(freeDailyLimit) && freeDailyLimit > 0 ? Math.floor(freeDailyLimit) : 0;
  const used = Number.isFinite(usedToday) && usedToday > 0 ? Math.floor(usedToday) : 0;
  if (used < limit) {
    return { action: 'allow', reason: 'within-free-quota', countsAgainstFree: true, remainingFree: limit - used - 1 };
  }
  return { action: 'block', reason: 'free-quota-exhausted', countsAgainstFree: false, remainingFree: 0 };
}
