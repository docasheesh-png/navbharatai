// Free-tier build routing (admin plan 2026-07-10) — a NEW public user still on their welcome bonus
import { envFlag } from '../lib/envFlag';
// (has never purchased) gets their builds on the CHEAP floor (GLM / Kimi), NEVER on Claude. Rationale
// the admin set: NavBharatAI must not spend its expensive Claude budget on a user who has not paid yet.
// The moment the user recharges (becomes a paying customer) they graduate to the normal Claude-first
// path — exactly today's behavior.
//
// When a free-tier (cheap-only) build cannot deliver, we do NOT ship a broken app and we do NOT rescue
// it on Claude (that would spend the very budget this rule protects). Instead we ask the user honestly
// to add credits and finish on the strongest engine — which both saves the first impression AND
// converts the user to paid.
//
// STRICTLY DORMANT until BOTH are true: AGENTV3_FREE_TIER_CHEAP=true AND a cheap floor is actually
// configured (AGENTV3_CHEAP_FLOOR names a provider whose key is present). With the flag off, or before
// the bake-off proves a cheap model, this changes nothing — free-tier builds fall through to today's
// path. Pure + unit-tested; the route wires the decision into model selection, escalation, and the
// build-failed message.

/** DORMANT switch. Free-tier cheap routing is inert unless this is exactly 'true'. */
export function freeTierCheapEnabled(): boolean {
  return envFlag('AGENTV3_FREE_TIER_CHEAP');
}

/** Minimal wallet shape this module reads — only whether the user has ever paid. */
export interface FreeTierWallet {
  /** Total ₹ the user has ever spent buying tokens. 0 / absent ⇒ still on the welcome bonus. */
  totalMoneySpent?: unknown;
}

/**
 * A user is on the FREE tier while they have NEVER purchased — i.e. they are still spending the
 * welcome-bonus tokens. Any real purchase (totalMoneySpent > 0) makes them a paying user, who takes
 * the normal Claude-first path. A missing / non-finite / zero value ⇒ free tier (conservative: a
 * user we cannot confirm as paying is treated as not-yet-paying, so we never spend Claude on them).
 */
export function isFreeTierUser(wallet: FreeTierWallet | null | undefined): boolean {
  const paid = Number(wallet?.totalMoneySpent);
  return !(Number.isFinite(paid) && paid > 0);
}

export interface FreeTierInputs {
  /** freeTierCheapEnabled() — the dormant master switch. */
  enabled: boolean;
  /** Is the paid surface active for this (non-free-list) user? Free-tier routing only applies then. */
  billingActive: boolean;
  /** Is a cheap floor actually configured (GLM/KIMI key present)? No floor ⇒ cannot route cheap-only. */
  cheapFloorConfigured: boolean;
  /** The user's wallet (to tell free-tier from paying). */
  wallet: FreeTierWallet | null | undefined;
}

/**
 * Decide whether THIS build must run as a free-tier cheap-only build. ALL of: the switch is on, the
 * paid surface is active for the user, a cheap floor exists, and the user has never paid. Any one
 * missing ⇒ not active ⇒ the build takes its normal path. Pure.
 */
export function isFreeTierBuild(inputs: FreeTierInputs): boolean {
  return (
    inputs.enabled &&
    inputs.billingActive &&
    inputs.cheapFloorConfigured &&
    isFreeTierUser(inputs.wallet)
  );
}

/**
 * The honest message shown when a free-tier (cheap-only) build could not deliver — instead of shipping
 * a broken app or spending Claude to rescue it, we invite the user to add credits and finish on the
 * strongest engine. Displayed to end users, so it is friendly and provider-agnostic (no model names).
 */
export function freeTierUpsellMessage(): string {
  return (
    '✨ Your app needs our strongest engine to finish cleanly. ' +
    'Add credits and I will complete it on the best engine — nothing you have done so far is lost.'
  );
}

/**
 * Slice F (NAVBHARATAI_ROUTING_PLAN.md §1 row 6): POWER MODE (Only Opus) is for PAYING accounts only —
 * Opus is the most expensive engine, and a user who has never purchased must not be able to spend it.
 * True ⇒ the route refuses the power build pre-stream (an honest 402), BEFORE any wallet-balance math.
 * Normal (non-power) builds are unaffected. Pure.
 */
export function powerModeBlockedForFreeUser(
  powerRequested: boolean,
  wallet: FreeTierWallet | null | undefined,
): boolean {
  return powerRequested && isFreeTierUser(wallet);
}

/** The honest, provider-agnostic refusal shown for that block (client renders the add-credits card). */
export function powerModePaidOnlyMessage(): string {
  return (
    '⚡ Power mode is available for paid accounts. Add credits to unlock it — ' +
    'your build can still run in normal mode right now.'
  );
}
