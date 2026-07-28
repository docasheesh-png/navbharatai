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

/**
 * The most pass periods ONE payment may grant automatically. A single order buying more than two
 * years is almost always a fat-finger or a card-testing probe, not a real customer — granting an
 * 80-year pass on it and only finding out at chargeback time is the expensive outcome. Anything above
 * this is capped and flagged so a human decides, rather than silently written into the entitlement.
 */
export const MAX_PASS_PERIODS = 24;

export interface PassEntitlement {
  /** Days to grant. 0 means the payment did not buy a pass — never grant on 0. */
  days: number;
  /** How many whole pass periods the payment covers. */
  periods: number;
  /** True when the payment covered MORE periods than one order may grant automatically. */
  capped: boolean;
}

/**
 * How many pass days a payment ACTUALLY buys — derived from the amount paid and the SERVER's own
 * price, never from anything the client sent.
 *
 * WHY THIS EXISTS (admin 2026-07-27, found while verifying the Pass before going live): the grant path
 * read `passDays` straight out of the order document, and that document was populated from the client's
 * own request body. Nothing anywhere compared the amount paid to the price we charge. So
 * `{ amount: 1, productType: 'professional_pass', passDays: 36500 }` bought a hundred-year unlimited
 * pass for one rupee. This is the same defect class the wallet path already fixed (C4 — credited tokens
 * derive from the VERIFIED paid amount), applied to the entitlement the Pass grants.
 *
 * Money is compared in whole paise so a float like 98.99999999 can never lose a customer their pass.
 * Pure and exhaustively tested.
 */
export function passEntitlementForPayment(
  amountPaidInr: unknown,
  priceInr: number = professionalPassPriceInr(),
  daysPerPeriod: number = professionalPassDays(),
): PassEntitlement {
  const paidPaise = Math.round(Number(amountPaidInr) * 100);
  const pricePaise = Math.round(Number(priceInr) * 100);
  const days = Math.floor(Number(daysPerPeriod));
  if (!Number.isFinite(paidPaise) || paidPaise <= 0) return { days: 0, periods: 0, capped: false };
  if (!Number.isFinite(pricePaise) || pricePaise <= 0) return { days: 0, periods: 0, capped: false };
  if (!Number.isFinite(days) || days <= 0) return { days: 0, periods: 0, capped: false };

  const earned = Math.floor(paidPaise / pricePaise);
  const periods = Math.min(earned, MAX_PASS_PERIODS);
  return { days: periods * days, periods, capped: earned > MAX_PASS_PERIODS };
}

/**
 * May this amount be accepted as a Professional Pass order at all? Checked at ORDER CREATION so an
 * underpaid pass order never reaches the gateway — the customer is told the real price up front
 * instead of paying and then finding out nothing was granted.
 */
export function isAcceptablePassPayment(
  amountInr: unknown,
  priceInr: number = professionalPassPriceInr(),
  daysPerPeriod: number = professionalPassDays(),
): boolean {
  return passEntitlementForPayment(amountInr, priceInr, daysPerPeriod).periods >= 1;
}
