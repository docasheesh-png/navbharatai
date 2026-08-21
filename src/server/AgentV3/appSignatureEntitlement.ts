// WHO IS ALLOWED TO REMOVE THE "made by NavBharatAI" BADGE (admin 2026-08-21).
//
// THE BUG. The badge is NavBharatAI's viral-growth mechanic and, per the admin, removing it is a paid
// feature of the ₹99/month Pass. It was not gated at all. The whole decision lived on the client: a
// localStorage flag in Settings → General became `appSignature: false` in the build request, and the
// server did `req.body?.appSignature !== false` — it simply believed it. Anyone could flip the toggle,
// or post the field directly, and get the paid outcome for nothing.
//
// THE CLASS, so this is fixed once rather than per feature: A PAID ENTITLEMENT ENFORCED ON THE CLIENT
// IS NOT ENFORCED. The client can only ever express a PREFERENCE. Whether that preference is honoured
// is a server decision made from the server-VERIFIED identity — never from a body field, and never from
// anything the browser had a hand in.
//
// FAIL CLOSED, and the asymmetry is deliberate. When the Pass cannot be read at all, this keeps the
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
  | 'removed-by-pass'
  /** They asked, but they are not on the Pass. */
  | 'requires-pass'
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
  /** Does the verified user hold an ACTIVE ₹99/month Pass? `null` = could not be determined. */
  hasActivePass: boolean | null;
  /** Admin/test accounts, who are treated as entitled. */
  isFreeListed?: boolean;
}

/**
 * Decide whether the built app carries the badge.
 *
 * Note the FIRST rule, which is the admin's explicit requirement and easy to lose: a Pass holder who
 * has NOT turned the toggle off still gets the badge. Paying does not remove it; asking does. The Pass
 * only buys the RIGHT to ask.
 */
export function decideAppSignature(facts: AppSignatureFacts): AppSignatureDecision {
  if (!facts.requestedRemoval) return { enabled: true, reason: 'not-requested' };
  if (facts.isFreeListed) return { enabled: false, reason: 'removed-by-pass' };
  if (!facts.signedIn) return { enabled: true, reason: 'requires-sign-in' };
  if (facts.hasActivePass === null) return { enabled: true, reason: 'entitlement-unknown' };
  if (!facts.hasActivePass) return { enabled: true, reason: 'requires-pass' };
  return { enabled: false, reason: 'removed-by-pass' };
}

/**
 * What to TELL the user when they asked for removal and did not get it.
 *
 * Silence here would be the second-absolute-rule failure the toggle already was: a switch that appears
 * to work and quietly does nothing. Returns null when there is nothing to say. The price is passed in
 * rather than hardcoded so one number cannot drift from professionalPassPriceInr().
 */
export function appSignatureNotice(reason: AppSignatureReason, priceInr: number): string | null {
  switch (reason) {
    case 'requires-pass':
      return `The "made by NavBharatAI" badge stays on your app for now — removing it is part of the Professional Pass (₹${priceInr}/month). You can turn it off from Settings → General once the Pass is active.`;
    case 'requires-sign-in':
      return 'The "made by NavBharatAI" badge stays on your app — sign in to use your Professional Pass and remove it.';
    case 'entitlement-unknown':
      return 'The "made by NavBharatAI" badge stays on your app this time — your subscription could not be checked just now. It will come off on your next build if your Pass is active.';
    default:
      return null;
  }
}
