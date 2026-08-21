// WHO IS ALLOWED TO REMOVE THE "made by NavBharatAI" BADGE (admin 2026-08-21).
//
// THE BUG. The badge is NavBharatAI's viral-growth mechanic and, per the admin, removing it is a paid
// feature of a ₹99/month subscription. It was not gated at all. The whole decision lived on the client: a
// localStorage flag in Settings → General became `appSignature: false` in the build request, and the
// server did `req.body?.appSignature !== false` — it simply believed it. Anyone could flip the toggle,
// or post the field directly, and get the paid outcome for nothing.
//
// THE CLASS, so this is fixed once rather than per feature: A PAID ENTITLEMENT ENFORCED ON THE CLIENT
// IS NOT ENFORCED. The client can only ever express a PREFERENCE. Whether that preference is honoured
// is a server decision made from the server-VERIFIED identity — never from a body field, and never from
// anything the browser had a hand in.
//
// WHICH ENTITLEMENT (corrected 2026-08-21, hours after the first version). This first shipped gated on
// the Professional Pass — which was WITHDRAWN FROM SALE on 2026-08-10, so the gate was correct and
// unopenable: nobody could buy their way past it. The right entitlement was already live and was
// missed: the ₹99/month CUSTOM DOMAIN PLAN (`hostingPlan.ts`, admin-approved 2026-08-06), paid from
// the ONE wallet, purchasable today from Billing → Plans — and already sold on removing NavBharatAI
// branding, because it removes the publish-time "Made with NavBharatAI" badge.
//
// That last point is why this correction is more than a swap. There are TWO badges: this one, baked
// into index.html at BUILD time, and the publish-time one stamped by DeploymentStore. Gating them on
// DIFFERENT paywalls would mean a user paying ₹99 watched one badge go and the other stay forever,
// with no way to reach it. One entitlement, both badges.
//
// FAIL CLOSED, and the asymmetry is deliberate. When the plan cannot be read at all, this keeps the
// badge. That is the opposite of the wallet gate beside it, which fails OPEN — and rightly so, because
// failing closed there would deny a paying user their build over a Firestore blip. Here, failing closed
// costs the user a small badge on their app and nothing else, while failing open would give away the
// paid feature to everyone during any outage. Different stakes, different default.
//
// PURE — the decision takes facts and returns a verdict, so every rule is unit-testable without
// Firestore, an HTTP request, or a build.

export type AppSignatureReason =
  /** The user never asked to remove it (or explicitly asked to keep it). This is the default. */
  | 'not-requested'
  /** They asked, they are entitled, it is removed. */
  | 'removed-by-plan'
  /** They asked, but they are not on the plan. */
  | 'requires-plan'
  /** They asked, but nobody is signed in — there is no subscription to check. */
  | 'requires-sign-in'
  /** They asked, and we could not determine entitlement. Kept, on purpose. */
  | 'entitlement-unknown';

export interface AppSignatureDecision {
  /** TRUE = bake the badge into the built app. */
  enabled: boolean;
  reason: AppSignatureReason;
}

export interface AppSignatureFacts {
  /**
   * Did the CLIENT ask for the badge to be removed? A preference, nothing more — the name says so on
   * purpose, because `appSignature: false` read like an instruction and was treated as one.
   */
  requestedRemoval: boolean;
  /** Is anyone signed in? From the server-verified identity only. */
  signedIn: boolean;
  /** Does the verified user hold the ACTIVE ₹99/month plan? `null` = could not be determined. */
  hasActivePlan: boolean | null;
  /** Admin/test accounts, who are treated as entitled. */
  isFreeListed?: boolean;
}

/**
 * Decide whether the built app carries the badge.
 *
 * Note the FIRST rule, which is the admin's explicit requirement and easy to lose: a plan holder who
 * has NOT turned the toggle off still gets the badge. Paying does not remove it; asking does. The plan
 * only buys the RIGHT to ask.
 */
export function decideAppSignature(facts: AppSignatureFacts): AppSignatureDecision {
  if (!facts.requestedRemoval) return { enabled: true, reason: 'not-requested' };
  if (facts.isFreeListed) return { enabled: false, reason: 'removed-by-plan' };
  if (!facts.signedIn) return { enabled: true, reason: 'requires-sign-in' };
  if (facts.hasActivePlan === null) return { enabled: true, reason: 'entitlement-unknown' };
  if (!facts.hasActivePlan) return { enabled: true, reason: 'requires-plan' };
  return { enabled: false, reason: 'removed-by-plan' };
}

/**
 * What to TELL the user when they asked for removal and did not get it.
 *
 * Silence here would be the second-absolute-rule failure the toggle already was: a switch that appears
 * to work and quietly does nothing. Returns null when there is nothing to say. The price is passed in
 * rather than hardcoded so one number cannot drift from hostingPlanPriceInr().
 */
export function appSignatureNotice(reason: AppSignatureReason, priceInr: number): string | null {
  switch (reason) {
    case 'requires-plan':
      return `The "made by NavBharatAI" badge stays on your app for now — removing it is part of the Custom Domain plan (₹${priceInr}/month, paid from your wallet). Buy it from Billing → Plans, then turn the badge off in Settings → General.`;
    case 'requires-sign-in':
      return 'The "made by NavBharatAI" badge stays on your app — sign in to use your plan and remove it.';
    case 'entitlement-unknown':
      return 'The "made by NavBharatAI" badge stays on your app this time — your plan could not be checked just now. It will come off on your next build if your plan is active.';
    default:
      return null;
  }
}
