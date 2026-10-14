/**
 * Go-live PR 18 — the Free → Pro → add-ons plan model (owner answer O-1).
 *
 * PLAN_MODEL_PRO (default OFF) decides which plans are OFFERED. It never decides what an existing
 * subscriber HAS: a Starter or Growth plan bought before (or after) the switch keeps resolving to
 * its own tier until it expires, through the unchanged `tierForPlanId`. Pro's price defaults to ₹499
 * and is configurable with PLAN_PRO_PRICE_INR (whole rupees, 1..99,999; anything else ⇒ default).
 * Pro's entitlements below are a PROPOSAL marked for owner confirmation; nothing sells Pro until the
 * purchase route is wired behind the flag in a follow-up. PURE: env is passed in.
 */
import { HOSTING_TIERS, PRO_TIER, tierForPlanId, type HostingTier } from './hostingTiers';

export const PRO_DEFAULT_PRICE_INR = 499;

type Env = Record<string, string | undefined>;
const on = (v: string | undefined) => /^(1|true|on|yes)$/i.test(String(v ?? '').trim());

export function planModelProEnabled(env: Env): boolean {
  return on(env.PLAN_MODEL_PRO);
}

export function proPriceInr(env: Env): number {
  const raw = String(env.PLAN_PRO_PRICE_INR ?? '').trim();
  if (!/^\d+$/.test(raw)) return PRO_DEFAULT_PRICE_INR;
  const n = Number(raw);
  return n >= 1 && n <= 99_999 ? n : PRO_DEFAULT_PRICE_INR;
}

/** Pro at the configured price. Entitlements live in hostingTiers.PRO_TIER (one definition). */
export type ProPlan = HostingTier;
export function proPlan(env: Env): ProPlan {
  return { ...PRO_TIER, priceInr: proPriceInr(env) };
}

/** Plans a NEW buyer may choose. Flag off ⇒ exactly today's list. */
export function offeredPlans(env: Env): ReadonlyArray<HostingTier | ProPlan> {
  return planModelProEnabled(env) ? [proPlan(env)] : HOSTING_TIERS;
}

/**
 * What a plan id ENTITLES its holder to. Starter/Growth/legacy resolve exactly as before whatever
 * the flag says, and 'pro' always resolves: a bought Pro must keep working if the flag is turned off.
 */
export function entitlementsForPlanId(planId: string | null | undefined, env: Env): HostingTier | ProPlan | null {
  if (String(planId ?? '') === 'pro') return proPlan(env);
  return tierForPlanId(planId);
}
