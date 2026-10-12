/**
 * THE BUILD'S BILLING LABEL — one rule, read from the money facts as well as the routing (autopsy 9c612cdb, Q-954).
 *
 * 🔴 WHAT WENT WRONG. Report 9c612cdb's billing record said, in one object:
 *     userTier "free (… cheap engines)"  ·  billedInr 103.24  ·  walletTokensDebited 10323
 * The label was chosen from `freeTierBuildActive` alone — a ROUTING flag that routes/agentv3.ts sets for every
 * Weak-tier build, a paying customer's included — so it asserted two facts nobody had checked:
 *   1. "free", beside a charge of ₹103.24 in the same record;
 *   2. a sign-up grant as the reason, a programme the admin retired on 2026-09-17 and deleted from the code on
 *      2026-09-26 (giftPolicy.ts: "a new wallet is created empty"). Printing a retired programme as the reason a
 *      build ran is a false statement about money, admin-only or not.
 * The two copies of the label (the wall-clock finalizer and the settle) had also drifted in how they spelled
 * the "paid" condition. One function now decides it for both.
 *
 * 🔑 WHAT "free" STILL MEANS HERE, and why it is kept. The repo's own vocabulary calls Weak the free tier
 * (ROUTING_AND_BILLING.md), and the admin kept the build's routing tier as the inbox `tier` on 2026-09-14
 * because "this build ran on the free tier" is a real fact (routes/admin.ts). So the Weak label keeps naming the
 * free tier's ROUTING — and now always says, beside it, whether this build was charged and how much. The
 * question "is this a paying user?" is answered by the account (`accountTier.ts`) and "was this build charged?"
 * by `charged`, never by parsing this string. `classifyReportTier` still reads the Weak label as 'free' (the
 * admin's accepted meaning) and still parses every label stored before this change.
 *
 * PURE. Admin-only text: it names no vendor and no model.
 */

export interface BuildBillingLabelInput {
  /** The verified user is on the free list (admins and testers): billing never applies. */
  freeListed: boolean;
  /** The build was routed to the cheap engines only — the Weak tier, or a never-purchased account under cost routing. */
  cheapEnginesOnly: boolean;
  /** Billing applies to this user: the paid surface or the credit gate is on, and they are not free-listed. */
  billingActive: boolean;
  /** What the build's bill came to, in USD, after every zeroing rule and the build discount. */
  billedUsd: number;
  /** The same bill in rupees, rounded exactly as the record's `billedInr` is. */
  billedInr: number;
}

export interface BuildBillingLabel {
  /** The record's `userTier` string. */
  userTier: string;
  /** True when this build's bill was set against the user's wallet: billing applies and the bill is above zero. */
  charged: boolean;
}

/** The routing name the Weak / cost-routed label carries. Exported so a test can pin it without a copy. */
export const CHEAP_TIER_LABEL = 'weak (free tier — cheap engines)';

/** The label and the charge flag for one build. PURE. */
export function buildBillingLabel(input: BuildBillingLabelInput): BuildBillingLabel {
  const usd = Number(input.billedUsd);
  const inr = Number(input.billedInr);
  const charged = !input.freeListed && input.billingActive && Number.isFinite(usd) && usd > 0;
  if (input.freeListed) return { userTier: 'free-list (admin/tester)', charged: false };
  if (input.cheapEnginesOnly) {
    const money = charged ? `charged ₹${(Number.isFinite(inr) ? inr : 0).toFixed(2)}` : 'not charged';
    return { userTier: `${CHEAP_TIER_LABEL} · ${money}`, charged };
  }
  if (input.billingActive) return { userTier: 'paid', charged };
  return { userTier: 'billing-off (no charge)', charged: false };
}
