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
   * Included SERVER traffic per period, in GB — the apps that run on NavBharatAI's own Cloud Run.
   *
   * 🔴 RENAMED FROM `includedTransferGb` ON 2026-09-13, BECAUSE THE OLD NAME WAS A CLAIM THE METER
   * COULD NOT KEEP. `hostingBillingSweep` measures `run.googleapis.com/container/network/sent_bytes_count`
   * — a Cloud Run metric — so a frontend-only app on Firebase Hosting has no service to read and is
   * never counted. One field called "transfer" therefore described two different things, and the
   * agreement generated from it said "across all your connected sites" while the meter saw one kind.
   * Two named fields make the code say which is which, and the agreement follows automatically.
   */
  includedBackendGb: number;
  /**
   * Included VISITOR traffic per period, in GB, for apps served as static files (Firebase Hosting or
   * the published-apps bucket).
   *
   * ⚠️ NOT METERED YET — see the agreement line that says so in `hostingAgreementTerms`. The number is
   * stated from the first day the plan is sold, deliberately: a limit added to a plan somebody has
   * already bought is a term they never agreed to, and this file's own rule is that an entitlement
   * sold is never withdrawn. Until the meter lands, the error runs entirely in the user's favour.
   */
  includedFrontendGb: number;
  /**
   * How many of this plan's apps may run a SERVER (Cloud Run), as opposed to being static files.
   *
   * 🔴 WHY A SECOND APP NUMBER (admin 2026-09-13). `publishedApps` bounds how many apps exist; it says
   * nothing about how many of them hold a container image and can be woken by a request. Those are the
   * two different costs: a static app is a file on a CDN, a server app carries an image in Artifact
   * Registry whether or not anybody visits. Without this field a 30-app plan implies 30 servers, and
   * the image storage alone (~500 MB each) outgrows the plan price with nobody visiting at all.
   */
  backendApps: number;
  /**
   * Wallet credit granted with the plan, in ₹.
   *
   * ⚠️ BOTH TIERS ARE ₹0 SINCE 2026-09-13 (admin: "credit = 0"). Growth bundled ₹150, and on the
   * costing that preceded the Cloud Run move it was the plan's single largest cost line — larger than
   * its servers and its traffic together. With the plan now granting real server hosting, the credit
   * was paying twice for the same upgrade. The field stays because a future tier may bundle credit
   * again, and every surface already renders it conditionally.
   */
  bundledCreditInr: number;
  /**
   * How many apps this plan may keep published on NavBharatAI's own hosting at once.
   *
   * 🔴 WHY THIS FIELD EXISTS AT ALL (admin 2026-09-10, "plan khatam to app offline honi chahiye, nahi
   * to user recharge hi nahi karega"). Before it, `publishedAppCap()` gave EVERY user the same 5 apps
   * whether they paid or not — so a "hosting plan" granted domains, badge removal, remix and ad-free,
   * and **no hosting at all**. That is why losing the plan felt toothless: there was nothing hosting-
   * shaped to lose. The plan now grants real headroom, which is what makes the demotion below mean
   * something.
   */
  publishedApps: number;
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
 * How many days a site with unpaid traffic stays online AFTER the reminder.
 *
 * 🔒 The agreement quotes this number, so it lives beside the price rather than only in the server
 * sweep: a promise of "3 more days" that the enforcement does not honour is worse than no promise.
 * `hostingOverage.HOSTING_DEBT_GRACE_DAYS` is the enforcing copy and a test pins the two together.
 */
export const HOSTING_AGREEMENT_GRACE_DAYS = 3;

/**
 * Apps a FREE account may keep published on NavBharatAI's hosting.
 *
 * 🔑 THIS IS THE FLOOR A LAPSED PLAN FALLS BACK TO — never zero, and that is the whole design. Free
 * hosting is a real product here (HostingQuota has given every account 5 apps since 2026-08-21), so
 * switching a lapsed PAYING user's apps all the way off would leave them strictly worse than someone
 * who never paid a rupee. The pressure to renew comes from losing the HEADROOM the plan bought, which
 * a user with 20 live apps feels immediately, not from taking away what free accounts get for nothing.
 *
 * It mirrors `publishedAppCap()`'s default on the server. That function stays authoritative (it is
 * env-tunable); this constant is what the purchase screen and the agreement quote, and a test pins
 * the two together so they cannot drift.
 */
export const FREE_PUBLISHED_APPS = 3;

/**
 * Visitor traffic a FREE account's static apps get each period, in GB.
 *
 * 🔒 A FREE ACCOUNT'S WALLET IS NEVER DEBITED FOR TRAFFIC — that is the rule this number serves, and
 * it is why the figure is not 0. A free user holds gifted credit, so metering them at zero would mean
 * the first visitor to a free app started eating the welcome gift, and the word "free" would stop
 * being true. Reaching this limit pauses the app; it never takes money.
 *
 * ⚠️ It is also why free accounts get `backendApps: 0`. No server ⇒ no Cloud Run service ⇒ the meter
 * has nothing to read, so a free account cannot accrue a charge even by accident.
 */
export const FREE_FRONTEND_GB = 5;

/** Apps a FREE account may run a SERVER for. Zero — server hosting is what a plan buys. */
export const FREE_BACKEND_APPS = 0;

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
    priceInr: 299,
    days: 30,
    domains: 1,
    includedBackendGb: 5,
    includedFrontendGb: 25,
    backendApps: 10,
    bundledCreditInr: 0,
    publishedApps: 10,
    tagline: 'Ten live apps, on your own domain, with real servers.',
    includes: [
      'Connect 1 domain of your own',
      'Keep up to 10 apps published (free accounts get 3)',
      'Up to 10 of them can run a real server (login, payments, an API)',
      'No "Made with NavBharatAI" badge',
      '25 GB of visitor traffic each month, and 5 GB for your server apps',
      'Remix any app in the Gallery or App Mart',
      'No ads on NavBharatAI, ever, while the plan is on',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    priceInr: 599,
    days: 30,
    domains: 3,
    includedBackendGb: 12,
    includedFrontendGb: 100,
    backendApps: 30,
    bundledCreditInr: 0,
    publishedApps: 30,
    tagline: 'Thirty apps, three domains, and room for the one that takes off.',
    includes: [
      'Connect up to 3 domains of your own',
      'Keep up to 30 apps published (free accounts get 3)',
      'Up to 30 of them can run a real server (login, payments, an API)',
      'No "Made with NavBharatAI" badge',
      '100 GB of visitor traffic each month, and 12 GB for your server apps',
      'Remix any app in the Gallery or App Mart',
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
    // 🔴 THE ORDER OF THESE LINES IS THE FIX, NOT THEIR CONTENT (admin 2026-09-13: "isko padhne se
    // aisa lag raha hai, ki 149₹ bhi dega user aur wallet se paise bhi dega"). The list used to open
    // with the traffic charge and the words "goes offline", so a buyer who will never exceed their
    // included GB — which is most of them — still read it as paying twice. Every rule below is
    // unchanged; what changed is that the agreement now states what the price COVERS before it
    // states the one case where something else is owed. An exception read first stops being an
    // exception and becomes the deal.
    `Everything listed on this plan is included in the ₹${tier.priceInr} — your ${tier.includedFrontendGb} GB of visitor traffic, your ${tier.domains === 1 ? 'domain' : 'domains'}, and up to ${tier.publishedApps} published apps, of which ${tier.backendApps} can run a real server. Nothing else is taken from your wallet for them.`,
    `₹${tier.priceInr} is taken from your NavBharatAI wallet now, and again every ${tier.days} days while auto-renew is on. You can switch auto-renew off at any time.`,
    // 🔒 THE WELCOME GIFT IS NOT PLAN MONEY (admin 2026-09-13: "gift ... plan purchase me kam nahi
    // ayenge"). Enforced by `giftSpend.ts`, and said HERE because a rule the user meets for the first
    // time at the payment button is a trap, however well it is implemented.
    `Your NavBharatAI welcome gift is for building apps, not for buying a plan — a plan is paid for from money you have added yourself. Your gift is not touched by this purchase and stays available for building.`,
    `The plan lets you keep up to ${tier.publishedApps} apps published at once. Free accounts keep ${FREE_PUBLISHED_APPS}, and a free account cannot run a server at all — that is what this plan adds.`,
    // 🔒 THE HONEST WARNING ABOUT WHAT LAPSING COSTS. The admin asked for a lapse with real bite; the
    // user is owed the same sentence BEFORE they buy, not discovered afterwards. It says exactly what
    // is paused and exactly what is not, because a vague "your apps may be affected" is the kind of
    // clause people only read after it has already happened to them.
    // ⚠️ THE RESTORE IS DESCRIBED EXACTLY AS IT WORKS, and two earlier drafts of this line were not.
    // "Everything comes back when you renew" implied an automatic restore nothing performs; "in one
    // tap" implied a Restore button that does not exist. Republishing re-runs a real build, so it is
    // done by opening the app and pressing Publish. Promising less friction than there is would be
    // discovered at the worst possible moment — just after the user paid to get their apps back.
    `If you do not renew, your plan simply ends on its expiry date. Your first ${FREE_PUBLISHED_APPS} apps stay online free and all of your files are kept. Apps beyond those ${FREE_PUBLISHED_APPS} wait offline until you renew and press Publish, your domain reconnects by itself, and the "Made with NavBharatAI" badge returns.`,
    // 🔴 THE SENTENCE THAT DID NOT EXIST UNTIL NavBharat Cloud DID. The line above describes the
    // STATIC fallback — five apps stay online free — and that is true only of apps a CDN can serve. An
    // app with a server has no free tier to fall back to, because free accounts do not get container
    // hosting at all. So for those apps "the plan ends" means the app stops, and a buyer is owed that
    // sentence BEFORE paying rather than on the morning it happens.
    `Apps that need a server run only on a plan. If the plan ends, they wait offline until you renew — your code and your data are kept exactly as they are.`,
    // 🔴 TWO ALLOWANCES, SAID PLAINLY, BECAUSE THE METER GENUINELY HAS TWO SIDES (2026-09-13). An app
    // that is only files is served by a CDN; an app with a server runs on Cloud Run and is measured by
    // a different metric entirely. One combined number would have to be enforced by a meter that does
    // not exist, and the line this replaces — "across all your connected sites" — promised exactly
    // that. Naming both is longer, and is the only version the code can keep.
    `The plan includes two separate traffic allowances every ${tier.days} days: ${tier.includedFrontendGb} GB for visitors to your apps, and ${tier.includedBackendGb} GB for the apps that run a server. They are counted separately, not added together.`,
    `Up to ${tier.backendApps} of your published apps can run a real server. The rest are served as files, which has no server limit.`,
    // 🔴 THIS LINE PROMISED THE OPPOSITE UNTIL 2026-09-13, IN CAPITALS: "your apps KEEP RUNNING —
    // nothing is switched off", with no condition at all. Under that wording a site whose owner never
    // paid for its overage had to be served free, for ever — and switching it off anyway would have
    // been breaking a promise somebody had paid for. It is corrected here, in the same change as the
    // rule that enforces it (`hostingOverage.decideDebtAction`), so nobody is ever subject to a term
    // they were not shown. What was NOT weakened: the app keeps running while there is balance, going
    // over does not switch anything off by itself, and nothing is ever deleted.
    `If you go past either allowance in a period, the extra traffic is ₹${HOSTING_OVERAGE_INR_PER_GB} per GB from your wallet, and every charge appears in your ledger. You can see your usage in the app at any time, so this is never a surprise.`,
    `Your apps keep running while your wallet has balance. If your balance reaches ₹0 while extra traffic is owed, we send you a reminder first and your site stays online for ${HOSTING_AGREEMENT_GRACE_DAYS} more days; it goes offline only if it is still unpaid after that. Nothing is ever deleted, and your site comes back when you top up and press Publish.`,
    // 🔴 THIS LINE IS HERE BECAUSE THE METER IS NOT LIVE YET, and an agreement that quietly implies
    // otherwise would be describing a system we do not have (rule 2: fully working, or honestly not
    // built). Traffic can only be measured where published apps pass through our own serving path,
    // and today most are served by Firebase Hosting channels, whose bytes cannot be attributed to one
    // user. Until a site's traffic is genuinely measured, NOTHING beyond the plan price is charged —
    // the error is entirely in the user's favour. Delete this line the day the meter covers a site,
    // and not one day earlier.
    // 🔒 NARROWED, NOT DELETED (2026-09-13). The meter is now real for apps on NavBharatAI's own
    // servers, so the old blanket "still being rolled out" would have understated what we can charge.
    // It stays true, and stays here, for every site served from a Hosting channel, whose bytes cannot
    // be attributed to one user — and those sites are still charged the plan price and nothing more.
    // Delete it the day every serving path is metered, and not one day earlier.
    `Traffic is measured on apps hosted on NavBharatAI's own servers. For a site served any other way, your traffic is not measured yet and you are charged the plan price and nothing more. You will always see your measured usage before anything extra is charged.`,
    `You can connect up to ${tier.domains} domain${tier.domains === 1 ? '' : 's'} of your own on this plan.`,
    ...(tier.bundledCreditInr > 0
      ? [`₹${tier.bundledCreditInr} of build credit is added to your wallet with each ${tier.days}-day period. It is ordinary credit — it does not expire separately from your balance.`]
      : []),
    `If the plan ends and is not renewed, your connected domain pauses after a short grace period, but your app stays live on its free NavBharatAI link. Renewing reconnects it automatically.`,
    `Your app's database is not part of this plan and stays free — it runs on your own account.`,
  ];
}

/**
 * ₹ owed for SERVER traffic beyond the allowance. Never negative; a part-GB is charged as a part-GB.
 *
 * ⚠️ THE ALLOWANCE IT COMPARES AGAINST IS NOW EXPLICIT (2026-09-13). It used to read
 * `tier.includedTransferGb`, a single field that the sweep fed with Cloud Run bytes and the agreement
 * described as "all your connected sites" — so the name hid which of the two allowances was being
 * spent. Every caller is a Cloud Run measurement, so the behaviour is byte-identical; what changed is
 * that a reader can now tell, and `overageFrontendInr` below cannot be confused for it.
 */
export function overageInr(usedGb: number, tier: HostingTier, ratePerGb: number = HOSTING_OVERAGE_INR_PER_GB): number {
  const used = Number(usedGb);
  if (!Number.isFinite(used) || used <= tier.includedBackendGb) return 0;
  const over = used - tier.includedBackendGb;
  return Math.round(over * ratePerGb * 100) / 100;
}

/**
 * ₹ owed for VISITOR traffic beyond the frontend allowance.
 *
 * 🔴 NOTHING CALLS THIS FOR MONEY YET, AND THAT IS THE HONEST STATE. The frontend meter does not
 * exist (the sweep reads a Cloud Run metric, which a static app has none of), so no charge can be
 * derived from a measurement nobody takes. It is defined here, beside its sibling and at the same
 * rate, so that when the meter lands the price is already the one the user ticked — rather than a
 * number invented on the day it is first charged. Same shape as `overageInr` deliberately: two
 * allowances, one rate, one rule.
 */
export function overageFrontendInr(usedGb: number, tier: HostingTier, ratePerGb: number = HOSTING_OVERAGE_INR_PER_GB): number {
  const used = Number(usedGb);
  if (!Number.isFinite(used) || used <= tier.includedFrontendGb) return 0;
  const over = used - tier.includedFrontendGb;
  return Math.round(over * ratePerGb * 100) / 100;
}
