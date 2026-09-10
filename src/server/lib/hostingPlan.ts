/**
 * Hosting plans — the ₹99/month "Custom Domain" plan (admin-approved 2026-08-06: "han").
 *
 * THE PRODUCT, in one line: free hosting carries the "Made with NavBharatAI" badge; the Custom
 * Domain plan (₹99/30 days, paid from the ONE wallet) removes the badge and unlocks connecting
 * the user's own domain. DB stays free forever (it runs on the user's own account — standing rule),
 * and coding stays pay-per-use — so the wallet now honestly carries all three: hosting plan,
 * DB (₹0), coding usage.
 *
 * WHY THE PLAN LIVES ON THE WALLET DOC (`user_token_wallets/{uid}.hostingPlan`) and not in its own
 * collection: the purchase must debit the wallet and grant the plan ATOMICALLY — one Firestore
 * transaction over one doc. A separate collection would need a cross-doc transaction and give the
 * money and the entitlement two places to disagree. The wallet is already the single money truth;
 * the plan is a money fact.
 *
 * Money rules (all inherited from the wallet's existing discipline):
 *   • Purchase debits via the SAME pure `computeDebitedWallet` a build uses — same token unit, same
 *     carry, same ledger. The ledger row reads "Hosting plan — Custom Domain (30 days)".
 *   • NO OVERDRAFT for a plan: a build that already started may run negative; a discretionary
 *     purchase may not. Insufficient balance = honest refusal naming the shortfall.
 *   • IDEMPOTENT per period via the ledger `buildRef` — a double-tap can never double-charge.
 *   • Renewal is LAZY (no cron): when an expired auto-renew plan is next read server-side, the
 *     renewal is attempted in the same transaction. Can't afford it → the plan simply lapses
 *     (honest `expired` state, nothing charged) and the next read tries again.
 *
 * Kill switch: `AGENTV3_HOSTING_PLANS=off` — gating disappears everywhere, purchases refuse,
 * already-granted plans keep their badge-removal (taking back something paid-for would be theft).
 */

import { doc, getDoc, runTransaction, getServerDb } from './serverDb';
import { computeDebitedWallet } from './walletDebit';
import { inrToDebitTokens, inrToWalletTokens } from './payments';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';
import { envFlag } from './envFlag';
import {
  HOSTING_TIERS, LEGACY_HOSTING_PLAN_ID, hostingAgreementTerms, isKnownPlanId, purchasableTier,
  tierForPlanId, tierRank, HOSTING_OVERAGE_INR_PER_GB, type HostingTier, type HostingTierId,
} from '../../lib/hostingTiers';

/**
 * TWO TIERS SINCE 2026-09-10 (admin: "do tier banao, credit bundle karo, 20 GB theek hai").
 * The catalogue — prices, limits, entitlements and the agreement text — lives in
 * `src/lib/hostingTiers.ts` so the purchase screen and this module read the SAME numbers.
 *
 * ⚠️ `HOSTING_PLAN_ID` is now the LEGACY id, not the only id. It stays exported under its old name
 * because six call sites import it, and it still identifies a real, paid plan on real wallets.
 */
export const HOSTING_PLAN_ID = LEGACY_HOSTING_PLAN_ID;
export const HOSTING_PLAN_DAYS = 30;

export function hostingPlansEnabled(): boolean {
  return envFlag('AGENTV3_HOSTING_PLANS', true);
}

/**
 * The ENTRY price we advertise — Starter. Used by every "buy the plan to unlock this" message.
 *
 * ⚠️ NOT the price a legacy ₹99 holder renews at; see `planPriceInr`. Keeping one function for both
 * is what would quietly raise an existing customer's bill.
 */
export function hostingPlanPriceInr(): number {
  const v = Number(process.env.HOSTING_PLAN_PRICE_INR);
  return Number.isFinite(v) && v > 0 ? v : HOSTING_TIERS[0].priceInr;
}

/**
 * What the legacy ₹99 "Custom Domain" plan renews at.
 *
 * 🔒 GRANDFATHERED ON PURPOSE, and this is a decision, not an oversight. Those users agreed to ₹99;
 * moving them to ₹149 because a catalogue was introduced would be raising a price on a live
 * subscription without asking, which no amount of "the new plan is better" makes honest. They keep
 * ₹99 and receive Starter's entitlements — strictly more than they bought. When they choose a real
 * tier, they accept its agreement like everyone else.
 */
export function legacyPlanPriceInr(): number {
  const v = Number(process.env.HOSTING_PLAN_PRICE_INR);
  return Number.isFinite(v) && v > 0 ? v : 99;
}

/** The price THIS plan id costs per period — the legacy one at its own price, tiers at theirs. */
export function planPriceInr(planId: string | null | undefined): number {
  if (String(planId ?? '') === LEGACY_HOSTING_PLAN_ID) return legacyPlanPriceInr();
  return tierForPlanId(planId)?.priceInr ?? hostingPlanPriceInr();
}

/** Days per period for a plan id. */
export function planDays(planId: string | null | undefined): number {
  return tierForPlanId(planId)?.days ?? HOSTING_PLAN_DAYS;
}

export interface HostingPlanRecord {
  /** The tier id ('starter' | 'growth'), or the legacy 'custom_domain' on plans bought before tiers. */
  id: string;
  purchasedAt: string;
  expiresAt: string;
  autoRenew: boolean;
  /** Reminder dedupe: `${days}` → the expiresAt it was sent for (a new period resets naturally). */
  remindedFor?: Record<string, string>;
  /** Set when the lapse was ENFORCED (domains detached) — cleared by a new purchase. */
  lapsedAt?: string | null;
  /**
   * When the user ticked the agreement, and the exact terms they ticked.
   *
   * 🔒 THIS IS WHAT MAKES OVERAGE CHARGEABLE. The admin's instruction was that the limit and the
   * separate charge for exceeding it are stated plainly and ticked before paying. A plan with no
   * `agreedAt` — every legacy ₹99 plan — was never shown those terms, so nothing beyond its price
   * may ever be billed against it. Storing the terms themselves, not a version number, means the
   * record still says what was agreed even after the catalogue changes.
   */
  agreedAt?: string | null;
  agreedTerms?: readonly string[];
}

/** Days before expiry the renewal reminders go out (admin 2026-08-06: "5 din pahle reminder"). */
export const HOSTING_PLAN_REMINDER_DAYS: ReadonlyArray<number> = [5, 1];
/** Days AFTER expiry before the domain is actually detached — the late-recharge grace window. */
export const HOSTING_PLAN_GRACE_DAYS = 3;

export interface HostingPlanStatus {
  enabled: boolean;
  active: boolean;
  plan: HostingPlanRecord | null;
  /** The ENTRY price (Starter) — what the card advertises to someone with no plan. */
  priceInr: number;
  days: number;
  /** The purchasable catalogue, so the card never hardcodes a price or a limit. */
  tiers: readonly HostingTier[];
  /** The tier the held plan grants, or null. A legacy ₹99 plan reports Starter's entitlements. */
  tier: HostingTier | null;
  /** What the HELD plan renews at — ₹99 for a grandfathered holder, the tier price otherwise. */
  renewalPriceInr: number;
  /** ₹ per GB past the included allowance. */
  overageInrPerGb: number;
}

/**
 * Pure: is the wallet's plan active at `nowMs`?
 *
 * ⚠️ It asks the CATALOGUE whether the id is known, rather than comparing against one constant. The
 * old `p.id !== HOSTING_PLAN_ID` test is precisely the line that would have reported every new
 * Starter and Growth plan as inactive — a paying customer with no entitlements and no error anywhere.
 */
export function hostingPlanActive(wallet: Record<string, any> | null | undefined, nowMs: number = Date.now()): boolean {
  const p = wallet?.hostingPlan as HostingPlanRecord | undefined;
  if (!p || !isKnownPlanId(p.id) || typeof p.expiresAt !== 'string') return false;
  const exp = Date.parse(p.expiresAt);
  return Number.isFinite(exp) && exp > nowMs;
}

/** The tier a wallet's plan grants right now, or null when there is no active plan. */
export function activeHostingTier(wallet: Record<string, any> | null | undefined, nowMs: number = Date.now()): HostingTier | null {
  if (!hostingPlanActive(wallet, nowMs)) return null;
  return tierForPlanId((wallet?.hostingPlan as HostingPlanRecord | undefined)?.id);
}

/**
 * ₹ of unused time left on an active plan, for an UPGRADE.
 *
 * Paying for Growth on day 3 of a Starter month must not throw away the 27 days already bought. The
 * remaining days are valued at the plan's OWN daily rate and returned to the wallet as credit, then
 * the new tier is charged in full from today. Rounded DOWN to the paisa so the refund can never
 * exceed what was actually paid for the unused stretch.
 */
export function unusedPlanValueInr(plan: HostingPlanRecord | undefined | null, nowMs: number): number {
  if (!plan || !isKnownPlanId(plan.id)) return 0;
  const exp = Date.parse(plan.expiresAt);
  if (!Number.isFinite(exp) || exp <= nowMs) return 0;
  const DAY = 24 * 60 * 60 * 1000;
  const days = planDays(plan.id);
  const remainingDays = Math.min(days, (exp - nowMs) / DAY);
  const perDay = planPriceInr(plan.id) / days;
  return Math.max(0, Math.floor(remainingDays * perDay * 100) / 100);
}

export type PlanPurchaseOutcome =
  | { ok: true; wallet: Record<string, any>; plan: HostingPlanRecord; charged: boolean; creditedInr: number; bundledCreditInr: number }
  | { ok: false; reason: 'insufficient' | 'disabled' | 'unknown_tier' | 'agreement_required'; shortfallTokens?: number };

/**
 * PURE purchase / extension / upgrade.
 *
 * Three shapes, and which one applies is decided by the tier the user already holds:
 *
 *  • **SAME tier (or none / expired)** — extends from the current expiry when one is live, so paying
 *    early never loses days; otherwise a fresh period from `now`.
 *  • **UPGRADE** (Growth over Starter, or over the legacy ₹99 plan) — the unused days on the old plan
 *    are valued at their own daily rate and credited back to the wallet FIRST, then the new tier is
 *    charged in full from today. Someone who upgrades on day 3 loses nothing.
 *  • **DOWNGRADE** while a higher tier is still live — deliberately NOT a purchase. It would mean
 *    either refunding at a rate nobody agreed to or silently reducing what they paid for, so it is
 *    refused and the user is told to let the current period finish. (`unknown_tier` is the id being
 *    wrong; a downgrade returns that too rather than inventing a fourth outcome the routes must learn.)
 *
 * 🔒 THE AGREEMENT IS A PRECONDITION, NOT A FORMALITY. Without `agreedToTerms` this refuses, because
 * the tick-box is what makes the overage charge chargeable — and a plan record with no `agreedAt`
 * must never be billed for overage later. The terms are frozen onto the record as they were shown.
 *
 * The idempotency ref is keyed on tier + period start, so replaying the same purchase is a no-op that
 * still returns ok.
 */
export function computePlanPurchase(
  current: Record<string, any>,
  nowIso: string,
  tierId: HostingTierId | string = HOSTING_TIERS[0].id,
  opts: { agreedToTerms?: boolean } = {},
): PlanPurchaseOutcome {
  if (!hostingPlansEnabled()) return { ok: false, reason: 'disabled' };
  const tier = purchasableTier(tierId);
  if (!tier) return { ok: false, reason: 'unknown_tier' };
  if (!opts.agreedToTerms) return { ok: false, reason: 'agreement_required' };

  const w = current || {};
  const nowMs = Date.parse(nowIso);
  const prior = w.hostingPlan as HostingPlanRecord | undefined;
  const priorActive = hostingPlanActive(w, nowMs);
  const priorRank = priorActive ? tierRank(prior?.id) : -1;
  const newRank = tierRank(tier.id);

  // A live HIGHER tier is not replaced by a cheaper one mid-period — see the note above.
  if (priorActive && priorRank > newRank) return { ok: false, reason: 'unknown_tier' };

  const isUpgrade = priorActive && newRank > priorRank;
  // Credit the unused stretch of the old plan BEFORE testing affordability, so an upgrade the user
  // can afford *because of* their own unused days is not refused for being unaffordable.
  const creditedInr = isUpgrade ? unusedPlanValueInr(prior, nowMs) : 0;
  const creditedTokens = inrToWalletTokens(creditedInr);
  const startWallet = creditedTokens > 0
    ? {
        ...w,
        tokenBalance: (typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0) + creditedTokens,
        remaining_balance: (typeof w.remaining_balance === 'number' && Number.isFinite(w.remaining_balance) ? w.remaining_balance : 0) + creditedInr,
        walletLedger: [
          ...(Array.isArray(w.walletLedger) ? w.walletLedger : []),
          {
            type: 'refund',
            amountCoinsOrTokens: creditedTokens,
            moneySpent: 0,
            timestamp: nowIso,
            description: `Unused days on your ${tierForPlanId(prior?.id)?.name ?? 'previous'} plan, returned as credit`,
          },
        ],
      }
    : w;

  const needed = inrToDebitTokens(tier.priceInr);
  const balance = typeof startWallet.tokenBalance === 'number' && Number.isFinite(startWallet.tokenBalance) ? startWallet.tokenBalance : 0;
  if (balance < needed) {
    return { ok: false, reason: 'insufficient', shortfallTokens: Math.ceil(needed - balance) };
  }

  // An upgrade restarts the clock from today (the old period was paid back); a same-tier purchase
  // extends from the live expiry so early payment never costs days.
  const priorExp = priorActive && !isUpgrade ? Date.parse(prior!.expiresAt) : NaN;
  const periodStartMs = Number.isFinite(priorExp) && priorExp > nowMs ? priorExp : nowMs;
  const expiresAt = new Date(periodStartMs + tier.days * 24 * 60 * 60 * 1000).toISOString();
  const buildRef = `hostingplan_${tier.id}_${periodStartMs}`;

  const debited = computeDebitedWallet(startWallet, {
    billedInr: tier.priceInr,
    buildRef,
    description: `Hosting plan — ${tier.name} (${tier.days} days)`,
  }, nowIso);

  // The bundled credit is granted only when the charge really applied — a replayed purchase must not
  // hand out a second month of credit for one payment.
  const granted = debited.applied ? grantBundledCredit(debited.wallet, tier, nowIso, buildRef) : debited.wallet;

  const samePlan = prior && prior.id === tier.id;
  const plan: HostingPlanRecord = {
    id: tier.id,
    purchasedAt: (samePlan && prior!.purchasedAt) || nowIso,
    expiresAt,
    autoRenew: samePlan ? prior!.autoRenew !== false : true,
    agreedAt: nowIso,
    agreedTerms: hostingAgreementTerms(tier),
    lapsedAt: null,
  };

  // `applied === false` here means the ledger already carries this exact period (double-tap /
  // transaction retry) — the plan grant below is then also a replay of the same state, so the whole
  // call converges to one purchase, one charge, one grant.
  return {
    ok: true,
    wallet: { ...granted, hostingPlan: plan },
    plan,
    charged: debited.applied,
    creditedInr,
    bundledCreditInr: debited.applied ? tier.bundledCreditInr : 0,
  };
}

/**
 * Add a tier's bundled build credit to the wallet.
 *
 * It is ORDINARY credit, deliberately: a separate expiring bucket would need its own balance, its own
 * spend order and its own expiry rules, and would let a user hold ₹150 they cannot spend on the thing
 * they want. The ledger row names where it came from, and the balance is just bigger.
 */
function grantBundledCredit(
  wallet: Record<string, any>,
  tier: HostingTier,
  nowIso: string,
  buildRef: string,
): Record<string, any> {
  if (!(tier.bundledCreditInr > 0)) return wallet;
  const w = wallet || {};
  const n = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const tokens = inrToWalletTokens(tier.bundledCreditInr);
  return {
    ...w,
    tokenBalance: n(w.tokenBalance) + tokens,
    remaining_balance: n(w.remaining_balance) + tier.bundledCreditInr,
    total_balance: n(w.total_balance) + tier.bundledCreditInr,
    walletLedger: [
      ...(Array.isArray(w.walletLedger) ? w.walletLedger : []),
      {
        type: 'plan_credit',
        amountCoinsOrTokens: tokens,
        moneySpent: 0,
        timestamp: nowIso,
        planRef: buildRef,
        description: `${tier.name} plan — ₹${tier.bundledCreditInr} build credit included`,
      },
    ],
  };
}

export interface LazyRenewalResult {
  wallet: Record<string, any>;
  renewed: boolean;
  /** True when the wallet doc changed and must be persisted. */
  applied: boolean;
}

/**
 * PURE lazy renewal: an EXPIRED plan with autoRenew on is re-purchased for 30 days from `now`
 * (never back-dated — the lapsed gap was not service, charging for it would be dishonest). The
 * idempotency ref is keyed on the OLD expiry, so two concurrent reads can only renew once.
 * Insufficient balance or autoRenew off ⇒ untouched (the plan stays honestly expired).
 */
export function computeLazyRenewal(current: Record<string, any>, nowIso: string): LazyRenewalResult {
  const w = current || {};
  if (!hostingPlansEnabled()) return { wallet: w, renewed: false, applied: false };
  const p = w.hostingPlan as HostingPlanRecord | undefined;
  if (!p || !isKnownPlanId(p.id) || p.autoRenew === false) return { wallet: w, renewed: false, applied: false };
  const nowMs = Date.parse(nowIso);
  const exp = Date.parse(p.expiresAt);
  if (!Number.isFinite(exp) || exp > nowMs) return { wallet: w, renewed: false, applied: false };

  // A renewal charges the price of the plan the user HOLDS, never today's advertised one — that is
  // what keeps a grandfathered ₹99 holder at ₹99 (see legacyPlanPriceInr).
  const price = planPriceInr(p.id);
  const days = planDays(p.id);
  const tier = tierForPlanId(p.id);
  const label = p.id === LEGACY_HOSTING_PLAN_ID ? 'Custom Domain' : (tier?.name ?? 'Hosting');
  const needed = inrToDebitTokens(price);
  const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  if (balance < needed) return { wallet: w, renewed: false, applied: false };

  const renewRef = `hostingplan_renew_${p.expiresAt}`;
  const debited = computeDebitedWallet(w, {
    billedInr: price,
    buildRef: renewRef,
    description: `Hosting plan — ${label} (auto-renewal, ${days} days)`,
  }, nowIso);
  if (!debited.applied) return { wallet: w, renewed: false, applied: false }; // this lapse already renewed

  // Each renewed period carries the tier's bundled credit — it is part of the monthly product, not a
  // one-off signing bonus. The legacy plan has no tier bundle, so this is a no-op for it.
  const granted = tier ? grantBundledCredit(debited.wallet, tier, nowIso, renewRef) : debited.wallet;

  const plan: HostingPlanRecord = {
    ...p,
    expiresAt: new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString(),
  };
  return { wallet: { ...granted, hostingPlan: plan }, renewed: true, applied: true };
}

export type PlanSweepAction =
  | { kind: 'renewed' }
  | { kind: 'remind'; days: number; shortfallInr: number } // 0 = balance covers the renewal
  | { kind: 'lapse' }
  | null;

/**
 * PURE per-wallet sweep step — the plan's whole lifecycle in one decision (admin 2026-08-06:
 * "renewal na ho to website down; 5 din pehle reminder"). Order matters:
 *   1. An expired auto-renew plan RENEWS if the balance allows (computeLazyRenewal).
 *   2. An active plan inside a reminder window (5d / 1d) gets ONE reminder per window per period —
 *      naming the shortfall when the wallet cannot cover ₹99, so the user knows exactly what to do.
 *   3. A plan expired past the grace window LAPSES: marked here; the caller detaches the domains.
 * Inside grace, nothing happens — a late recharge renews silently and the domain never blinks.
 * Returns the possibly-updated wallet + whether it must be persisted + the action for side effects.
 */
export function decidePlanSweepStep(
  current: Record<string, any>,
  nowIso: string,
): { wallet: Record<string, any>; applied: boolean; action: PlanSweepAction } {
  const w = current || {};
  const p = w.hostingPlan as HostingPlanRecord | undefined;
  if (!hostingPlansEnabled() || !p || !isKnownPlanId(p.id)) return { wallet: w, applied: false, action: null };
  const nowMs = Date.parse(nowIso);
  const exp = Date.parse(p.expiresAt);
  if (!Number.isFinite(exp)) return { wallet: w, applied: false, action: null };
  const DAY = 24 * 60 * 60 * 1000;

  // 1) renewal first — a renewed plan needs no reminder and no lapse.
  const renewal = computeLazyRenewal(w, nowIso);
  if (renewal.renewed) return { wallet: renewal.wallet, applied: true, action: { kind: 'renewed' } };

  // 2) reminders — fire the SMALLEST reached window, and burn every larger one with it.
  //
  // ROOT CAUSE this closes (caught by the sweep suite on 2026-08-08, when the real clock crossed
  // into a fixture's final day): the loop used to fire the LARGEST reached window first. For a plan
  // with 8 HOURS left — a dormant account whose first sweep lands late, which is the common case,
  // not an edge one — that sent "just a heads-up 5 days ahead" when five days did not exist, and
  // then sent the 1-day reminder on the very next sweep: two notifications minutes apart, the first
  // of them factually false. A reminder that misstates the remaining time is worse than no reminder
  // (rule 5 — the system must tell the truth about its own state).
  //
  // Now: the smallest reached window wins (it is the only one that describes reality), and every
  // LARGER window is marked spent in the same write, because a "5 days ahead" warning is moot once
  // fewer than 5 days remain and must never fire late. The normal cadence is untouched: a plan swept
  // regularly still gets its 5-day note, then its 1-day note.
  if (exp > nowMs) {
    const remindedFor = p.remindedFor ?? {};
    const reached = HOSTING_PLAN_REMINDER_DAYS
      .filter((days) => exp - nowMs <= days * DAY)
      .sort((a, b) => a - b); // smallest (most urgent, most accurate) first
    const days = reached.find((d) => remindedFor[String(d)] !== p.expiresAt);
    if (days === undefined) return { wallet: w, applied: false, action: null };
    // The reminder must quote what THIS user will actually be charged, not the advertised entry price.
    const price = planPriceInr(p.id);
    const needed = inrToDebitTokens(price);
    const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
    const shortTokens = Math.max(0, needed - balance);
    const shortfallInr = shortTokens > 0 ? Math.ceil((shortTokens * price) / needed) : 0;
    // Burn the fired window AND every larger one — they can no longer be told truthfully.
    const burned = { ...remindedFor };
    for (const d of HOSTING_PLAN_REMINDER_DAYS) if (d >= days) burned[String(d)] = p.expiresAt;
    const plan: HostingPlanRecord = { ...p, remindedFor: burned };
    return { wallet: { ...w, hostingPlan: plan }, applied: true, action: { kind: 'remind', days, shortfallInr } };
  }

  // 3) expired: inside grace = wait (a lazy renewal can still save it); past grace = lapse once.
  if (nowMs - exp <= HOSTING_PLAN_GRACE_DAYS * DAY) return { wallet: w, applied: false, action: null };
  if (p.lapsedAt) return { wallet: w, applied: false, action: null }; // already enforced
  const plan: HostingPlanRecord = { ...p, lapsedAt: nowIso };
  return { wallet: { ...w, hostingPlan: plan }, applied: true, action: { kind: 'lapse' } };
}

async function canonicalId(db: any, uid: string): Promise<string> {
  if (!walletMergeResolveEnabled()) return uid;
  return resolveCanonicalWalletId(async (u) => {
    const s = await getDoc(doc(db, 'user_token_wallets', u));
    return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
  }, uid).catch(() => uid);
}

/**
 * Read a user's plan status, applying lazy auto-renewal transactionally when due. Never throws;
 * a store failure reports `active: false` with `plan: null` (callers decide their own fail
 * direction — see hostingPlanProbe).
 */
export async function readHostingPlanStatus(db: any, userId: string, nowIso?: string): Promise<HostingPlanStatus> {
  const base: HostingPlanStatus = {
    enabled: hostingPlansEnabled(), active: false, plan: null,
    priceInr: hostingPlanPriceInr(), days: HOSTING_PLAN_DAYS,
    tiers: HOSTING_TIERS, tier: null, renewalPriceInr: hostingPlanPriceInr(),
    overageInrPerGb: HOSTING_OVERAGE_INR_PER_GB,
  };
  if (!db || !userId) return base;
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const wallet = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      if (!snap.exists()) return null;
      const current = snap.data();
      const renewal = computeLazyRenewal(current, nowIso ?? new Date().toISOString());
      if (renewal.applied) t.set(ref, renewal.wallet);
      return renewal.wallet;
    });
    if (!wallet) return base;
    const plan = (wallet.hostingPlan as HostingPlanRecord | undefined) ?? null;
    const heldTier = tierForPlanId(plan?.id);
    // The SAME clock decides "is it active" as decided the renewal above. Threading `nowIso` into only
    // one of the two left this function half-injectable: a caller could pass a time, watch the renewal
    // honour it, and still get an `active` computed from today's real date. Caught by its own test.
    const nowMs = nowIso ? Date.parse(nowIso) : undefined;
    return {
      ...base,
      active: hostingPlanActive(wallet, Number.isFinite(nowMs as number) ? (nowMs as number) : undefined),
      plan: plan && isKnownPlanId(plan.id) ? plan : null,
      tier: heldTier,
      renewalPriceInr: plan && isKnownPlanId(plan.id) ? planPriceInr(plan.id) : hostingPlanPriceInr(),
    };
  } catch {
    return base;
  }
}

export type PlanPurchaseResult =
  | { ok: true; plan: HostingPlanRecord; tokenBalance: number; charged: boolean; creditedInr: number; bundledCreditInr: number }
  | { ok: false; error: string; reason: 'insufficient' | 'disabled' | 'unavailable' | 'unknown_tier' | 'agreement_required'; shortfallTokens?: number };

/**
 * Atomic purchase: debit + grant in one transaction on the wallet doc. Never throws.
 *
 * `nowIso` is injectable for the same reason `hostingPlanSweep` made its `now` a dependency: a wrapper
 * that reads the real clock while its pure core TAKES a time makes every test of the wrapper rot with
 * the calendar. That is not hypothetical — the sweep's own test did exactly that on 2026-08-08, passing
 * for days after it was written and then failing repo-wide when wall-clock time crossed a threshold in
 * a fixture nobody had touched.
 *
 * These two wrappers are the SIBLINGS of that bug, found by grepping for the same shape (rule 3): both
 * wrap a time-injectable core while hardcoding `new Date()`, and `purchaseHostingPlan` is itself under
 * test — so the next bomb was already armed. Production keeps the real clock by default.
 */
export async function purchaseHostingPlan(
  db: any,
  userId: string,
  nowIso?: string,
  tierId: HostingTierId | string = HOSTING_TIERS[0].id,
  opts: { agreedToTerms?: boolean } = {},
): Promise<PlanPurchaseResult> {
  if (!hostingPlansEnabled()) {
    return { ok: false, error: 'Hosting plans are not available right now.', reason: 'disabled' };
  }
  if (!db || !userId) {
    return { ok: false, error: 'Please try again in a moment.', reason: 'unavailable' };
  }
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const outcome = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      const result = computePlanPurchase(current, nowIso ?? new Date().toISOString(), tierId, opts);
      if (result.ok) t.set(ref, result.wallet);
      return result;
    });
    if (!outcome.ok) {
      if (outcome.reason === 'insufficient') {
        return {
          ok: false, reason: 'insufficient', shortfallTokens: outcome.shortfallTokens,
          error: 'Your wallet balance is not enough for this plan — please recharge first.',
        };
      }
      if (outcome.reason === 'agreement_required') {
        return { ok: false, reason: 'agreement_required', error: 'Please tick the plan terms before buying.' };
      }
      if (outcome.reason === 'unknown_tier') {
        // Also the answer for a downgrade attempted mid-period — the message says which it was, so
        // the user is not told "no such plan" about a plan that plainly exists on the screen.
        return {
          ok: false, reason: 'unknown_tier',
          error: 'That plan cannot be started right now. If you are on a higher plan, it will finish its current period first — you can switch after that.',
        };
      }
      return { ok: false, error: 'Hosting plans are not available right now.', reason: 'disabled' };
    }
    invalidatePlanCache(userId);
    return {
      ok: true, plan: outcome.plan, charged: outcome.charged,
      creditedInr: outcome.creditedInr, bundledCreditInr: outcome.bundledCreditInr,
      tokenBalance: typeof outcome.wallet.tokenBalance === 'number' ? outcome.wallet.tokenBalance : 0,
    };
  } catch {
    return { ok: false, error: 'Could not complete the purchase — nothing was charged. Please try again.', reason: 'unavailable' };
  }
}

/** Toggle auto-renewal. Never throws; returns success. */
export async function setHostingPlanAutoRenew(db: any, userId: string, autoRenew: boolean): Promise<boolean> {
  if (!db || !userId) return false;
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const ok = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      if (!snap.exists()) return false;
      const w = snap.data();
      const p = w.hostingPlan as HostingPlanRecord | undefined;
      if (!p || !isKnownPlanId(p.id)) return false;
      t.set(ref, { ...w, hostingPlan: { ...p, autoRenew: !!autoRenew } });
      return true;
    });
    if (ok) invalidatePlanCache(userId);
    return ok;
  } catch {
    return false;
  }
}

// ---------- cheap cached probe for the hot paths (badge stamping, domain gate) ----------

export interface PlanProbe {
  /** Plan known-active right now. */
  active: boolean;
  /** False when the store could not answer — the CALLER picks the safe direction for its surface. */
  known: boolean;
}

const PROBE_TTL_MS = 5 * 60 * 1000;
const probeCache = new Map<string, { probe: PlanProbe; at: number }>();

export function invalidatePlanCache(userId: string): void {
  probeCache.delete(userId);
}

/** Test seam: reset cache between tests. */
export function _clearPlanCacheForTests(): void {
  probeCache.clear();
}

/**
 * Is this user's plan active? Cached 5 min (the pwa serve path runs per page-view), bounded to 3s,
 * never throws. `known: false` on any failure so each surface fails in ITS safe direction:
 *   • badge stamping treats unknown as "keep the badge" (a free user must not escape it on an outage;
 *     a plan holder seeing the badge for one publish during an outage is the acceptable trade),
 *   • the domain-connect gate treats unknown as "allow" (rule #1 — an outage must never block a
 *     legitimately paying user's setup).
 */
export async function probeHostingPlan(userId: string | null | undefined): Promise<PlanProbe> {
  if (!userId || !hostingPlansEnabled()) {
    // Plans off ⇒ no badge removal and no gating anywhere — but that is a KNOWN answer, not a failure.
    return { active: false, known: true };
  }
  const hit = probeCache.get(userId);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.probe;
  try {
    const db = getServerDb();
    if (!db) return { active: false, known: false };
    const status = await Promise.race([
      readHostingPlanStatus(db, userId),
      new Promise<null>((r) => setTimeout(() => r(null), 3_000)),
    ]);
    if (!status) return { active: false, known: false };
    const probe: PlanProbe = { active: status.active, known: true };
    probeCache.set(userId, { probe, at: Date.now() });
    return probe;
  } catch {
    return { active: false, known: false };
  }
}
