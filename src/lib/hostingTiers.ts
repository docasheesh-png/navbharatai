// THE HOSTING PLAN CATALOGUE — one home for every number a user is shown and then charged.
//
// 🔴 WHY A CATALOGUE REPLACED A SINGLE PLAN (admin 2026-09-10: "do tier banao, credit bundle karo,
// 20 GB theek hai"). There used to be exactly one plan — ₹99/30 days, "Custom Domain" — whose price
// lived in `hostingPlanPriceInr()` and whose entitlements lived nowhere at all: the badge removal and
// the domain gate each decided for themselves what an active plan meant. That works for one plan and
// stops working the moment there are two, because "active" then has to answer *which* tier, and every
// surface that asks would answer it separately. This file is that answer, once.
//
// 🔒 THE LIMITS AND THE AGREEMENT ARE THE SAME NUMBERS, BY CONSTRUCTION. The admin's instruction was
// that the ₹149 plan ships WITH limits, that going past a limit is charged separately, and that the
// user must tick an agreement saying so before paying ("yeh bat clear likhi ho jab user 149₹ ka
// purchage kare, agreement type aa jaye, 'ok' tick karne ko aye"). An agreement that quotes one
// number while the meter enforces another is worse than no agreement — so the consent text is
// GENERATED from the tier (`hostingAgreementTerms`), never written out by hand beside it.
//
// 🔑 THE ONE PROMISE THAT IS NOT A LIMIT: going over does NOT take the app down. It is billed from the
// same wallet, at a stated per-GB rate, and the app keeps serving. A hosting plan that switches a
// user's live site off for going popular is the opposite of what they bought.
//
// PURE. No env, no clock, no I/O — so the browser and the server read the identical catalogue.

export type HostingTierId = 'starter' | 'growth';

/**
 * The plan id written on wallets before tiers existed (₹99 "Custom Domain").
 *
 * ⚠️ IT IS STILL A REAL, ACTIVE PLAN for anyone holding it, and must keep working exactly as sold —
 * withdrawing an entitlement somebody paid for is theft, and this file is not allowed to do it. It
 * maps to Starter's entitlements and keeps its own ₹99 price until its current period ends.
 */
export const LEGACY_HOSTING_PLAN_ID = 'custom_domain';

export interface HostingTier {
  id: HostingTierId;
  /** What the user sees. */
  name: string;
  /** ₹ per period, taken from the wallet. */
  priceInr: number;
  /** Days per period. */
  days: number;
  /** How many of the user's own domains may be connected at once. */
  domains: number;
  /**
   * Included data transfer per period, in GB. Egress is the line that decides whether a hosting plan
   * makes or loses money — an app serving images or video can have it dwarf everything else — which
   * is why the allowance is denominated in it rather than in "apps" or "storage".
   */
  includedTransferGb: number;
  /**
   * Wallet credit granted with the plan, in ₹. Growth bundles ₹150 so the plan covers a month of
   * ordinary editing as well as the hosting — the admin's "credit bundle karo".
   */
  bundledCreditInr: number;
  /** One line for the plan card. */
  tagline: string;
  /** The bullet list on the plan card, in order. */
  includes: readonly string[];
}

/**
 * ₹ per GB of data transfer beyond the included allowance.
 *
 * Set ABOVE what a GB costs us, deliberately and by a real margin: overage exists to cover an expense,
 * and an overage rate at or under cost turns a popular app into a loss that grows with its success.
 * It is a single flat number because it is quoted in an agreement the user ticks before paying, and a
 * number that varies by region or by month cannot be quoted in advance.
 */
export const HOSTING_OVERAGE_INR_PER_GB = 20;

/**
 * The purchasable tiers, cheapest first.
 *
 * The ₹2,999 "Business" tier the admin sketched is deliberately NOT here. It has no customers yet, and
 * a purchasable plan with no one on it is a promise about capacity, support and limits that nothing in
 * the code keeps. It is offered as "talk to us" until a real customer defines it — which is also the
 * honest way to find out what it should actually contain.
 */
export const HOSTING_TIERS: readonly HostingTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceInr: 149,
    days: 30,
    domains: 1,
    includedTransferGb: 5,
    bundledCreditInr: 0,
    tagline: 'One live site on your own domain.',
    includes: [
      'Connect 1 domain of your own',
      'No "Made with NavBharatAI" badge',
      '5 GB of visitor traffic each month',
      'Remix any app in the gallery',
      'No ads on NavBharatAI, ever, while the plan is on',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    priceInr: 499,
    days: 30,
    domains: 3,
    includedTransferGb: 20,
    bundledCreditInr: 150,
    tagline: 'Several sites, room to grow, and credit to keep building.',
    includes: [
      'Connect up to 3 domains of your own',
      'No "Made with NavBharatAI" badge',
      '20 GB of visitor traffic each month',
      '₹150 of build credit added to your wallet every month',
      'Remix any app in the gallery',
      'No ads on NavBharatAI, ever, while the plan is on',
    ],
  },
];

/** The tier a plan id grants, or null. The legacy ₹99 plan grants Starter's entitlements. */
export function tierForPlanId(planId: string | null | undefined): HostingTier | null {
  const id = String(planId ?? '');
  if (id === LEGACY_HOSTING_PLAN_ID) return HOSTING_TIERS[0];
  return HOSTING_TIERS.find((t) => t.id === id) ?? null;
}

/** Is this a plan id the catalogue recognises at all (including the legacy one)? */
export function isKnownPlanId(planId: string | null | undefined): boolean {
  return tierForPlanId(planId) !== null;
}

/** A tier by id, for a purchase request. The legacy id is NOT purchasable — it is only honoured. */
export function purchasableTier(tierId: string | null | undefined): HostingTier | null {
  return HOSTING_TIERS.find((t) => t.id === String(tierId ?? '')) ?? null;
}

/**
 * Ranking, for upgrade/downgrade decisions. Higher is more. The legacy plan ranks with Starter, so
 * a legacy holder moving to Growth is correctly an UPGRADE and gets the unused-days credit.
 */
export function tierRank(planId: string | null | undefined): number {
  const t = tierForPlanId(planId);
  if (!t) return -1;
  return HOSTING_TIERS.findIndex((x) => x.id === t.id);
}

/**
 * The exact sentences the user ticks "OK" against before paying.
 *
 * Generated from the tier so the agreement can never quote a limit the meter does not enforce. Every
 * line is something we actually do — there is no clause here describing a behaviour the code lacks.
 */
export function hostingAgreementTerms(tier: HostingTier): readonly string[] {
  return [
    `₹${tier.priceInr} is taken from your NavBharatAI wallet now, and again every ${tier.days} days while auto-renew is on. You can switch auto-renew off at any time.`,
    `The plan includes ${tier.includedTransferGb} GB of visitor traffic every ${tier.days} days, across all your connected sites.`,
    `If your sites go past ${tier.includedTransferGb} GB, your apps KEEP RUNNING — nothing is switched off. The extra traffic is charged from your wallet at ₹${HOSTING_OVERAGE_INR_PER_GB} per GB, and every charge appears in your ledger.`,
    `You can connect up to ${tier.domains} domain${tier.domains === 1 ? '' : 's'} of your own on this plan.`,
    ...(tier.bundledCreditInr > 0
      ? [`₹${tier.bundledCreditInr} of build credit is added to your wallet with each ${tier.days}-day period. It is ordinary credit — it does not expire separately from your balance.`]
      : []),
    `If the plan ends and is not renewed, your connected domain pauses after a short grace period, but your app stays live on its free NavBharatAI link. Renewing reconnects it automatically.`,
    `Your app's database is not part of this plan and stays free — it runs on your own account.`,
  ];
}

/** ₹ owed for traffic beyond the allowance. Never negative; a part-GB is charged as a part-GB. */
export function overageInr(usedGb: number, tier: HostingTier, ratePerGb: number = HOSTING_OVERAGE_INR_PER_GB): number {
  const used = Number(usedGb);
  if (!Number.isFinite(used) || used <= tier.includedTransferGb) return 0;
  const over = used - tier.includedTransferGb;
  return Math.round(over * ratePerGb * 100) / 100;
}
