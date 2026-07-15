// Professional Pass — configuration & feature flag (admin 2026-07-15).
//
// The Professionals section becomes PAID: a flat "Professional Pass" (default ₹99/month) unlocks ALL
// professionals unlimited; non-subscribers get a small daily free quota (default 10 messages/day); the
// admin free-list is always unlimited. Every knob here is env-tunable so the admin can change price,
// quota and pass length from Cloud Run WITHOUT a deploy — and the master switch defaults OFF so the
// whole feature is inert (today's behaviour) until the pay path + UI are wired and the admin flips it.

import { isAgentV3FreeUser } from '../AgentV3/featureFlag';

/** Master switch. OFF (default) = no gating anywhere — professionals behave exactly like today. */
export function professionalPaidEnabled(): boolean {
  return String(process.env.PROFESSIONAL_PAID_ENABLED || '').trim().toLowerCase() === 'true';
}

/** Daily free-message allowance for non-subscribers (across all professionals). Default 50 (admin
 *  2026-07-15). Env-tunable without a deploy. */
export function professionalFreeDailyLimit(): number {
  const n = Number(process.env.PROFESSIONAL_FREE_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
}

/** Professional Pass price in ₹. Default 99. */
export function professionalPassPriceInr(): number {
  const n = Number(process.env.PROFESSIONAL_PASS_PRICE_INR);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 99;
}

/** How many days one Pass grants. Default 30 (monthly). */
export function professionalPassDays(): number {
  const n = Number(process.env.PROFESSIONAL_PASS_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

/**
 * Is this VERIFIED user free (admin/tester)? Reuses the platform free-list so the same admin/test
 * accounts are free everywhere. MUST be called with the server-verified identity, never a client claim.
 */
export function isProfessionalFreeUser(userId?: string | null, email?: string | null): boolean {
  return isAgentV3FreeUser(userId, email);
}
