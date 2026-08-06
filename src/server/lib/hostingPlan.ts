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
import { inrToDebitTokens } from './payments';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';

export const HOSTING_PLAN_ID = 'custom_domain';
export const HOSTING_PLAN_DAYS = 30;

export function hostingPlansEnabled(): boolean {
  return !/^(off|false|0)$/i.test((process.env.AGENTV3_HOSTING_PLANS || '').trim());
}

/** ₹ per 30 days. Env-tunable so a price change never needs a deploy. */
export function hostingPlanPriceInr(): number {
  const v = Number(process.env.HOSTING_PLAN_PRICE_INR);
  return Number.isFinite(v) && v > 0 ? v : 99;
}

export interface HostingPlanRecord {
  id: string;
  purchasedAt: string;
  expiresAt: string;
  autoRenew: boolean;
}

export interface HostingPlanStatus {
  enabled: boolean;
  active: boolean;
  plan: HostingPlanRecord | null;
  priceInr: number;
  days: number;
}

/** Pure: is the wallet's plan active at `nowMs`? */
export function hostingPlanActive(wallet: Record<string, any> | null | undefined, nowMs: number = Date.now()): boolean {
  const p = wallet?.hostingPlan as HostingPlanRecord | undefined;
  if (!p || p.id !== HOSTING_PLAN_ID || typeof p.expiresAt !== 'string') return false;
  const exp = Date.parse(p.expiresAt);
  return Number.isFinite(exp) && exp > nowMs;
}

export type PlanPurchaseOutcome =
  | { ok: true; wallet: Record<string, any>; plan: HostingPlanRecord; charged: boolean }
  | { ok: false; reason: 'insufficient' | 'disabled'; shortfallTokens?: number };

/**
 * PURE purchase/extension. An active plan EXTENDS from its current expiry (paying early never
 * loses days); an expired/absent one starts a fresh 30 days from `now`. The idempotency ref is
 * keyed on the period start, so replaying the same purchase is a no-op that still returns ok.
 */
export function computePlanPurchase(
  current: Record<string, any>,
  nowIso: string,
): PlanPurchaseOutcome {
  if (!hostingPlansEnabled()) return { ok: false, reason: 'disabled' };
  const w = current || {};
  const nowMs = Date.parse(nowIso);
  const price = hostingPlanPriceInr();
  const needed = inrToDebitTokens(price);
  const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  if (balance < needed) {
    return { ok: false, reason: 'insufficient', shortfallTokens: Math.ceil(needed - balance) };
  }

  const prior = w.hostingPlan as HostingPlanRecord | undefined;
  const priorExp = prior?.id === HOSTING_PLAN_ID ? Date.parse(prior.expiresAt) : NaN;
  const periodStartMs = Number.isFinite(priorExp) && priorExp > nowMs ? priorExp : nowMs;
  const expiresAt = new Date(periodStartMs + HOSTING_PLAN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const buildRef = `hostingplan_${HOSTING_PLAN_ID}_${periodStartMs}`;

  const debited = computeDebitedWallet(w, {
    billedInr: price,
    buildRef,
    description: 'Hosting plan — Custom Domain (30 days)',
  }, nowIso);

  const plan: HostingPlanRecord = {
    id: HOSTING_PLAN_ID,
    purchasedAt: (prior?.id === HOSTING_PLAN_ID && prior.purchasedAt) || nowIso,
    expiresAt,
    autoRenew: prior?.id === HOSTING_PLAN_ID ? prior.autoRenew !== false : true,
  };

  // `applied === false` here means the ledger already carries this exact period (double-tap /
  // transaction retry) — the plan grant below is then also a replay of the same state, so the whole
  // call converges to one purchase, one charge, one grant.
  return { ok: true, wallet: { ...debited.wallet, hostingPlan: plan }, plan, charged: debited.applied };
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
  if (!p || p.id !== HOSTING_PLAN_ID || p.autoRenew === false) return { wallet: w, renewed: false, applied: false };
  const nowMs = Date.parse(nowIso);
  const exp = Date.parse(p.expiresAt);
  if (!Number.isFinite(exp) || exp > nowMs) return { wallet: w, renewed: false, applied: false };

  const price = hostingPlanPriceInr();
  const needed = inrToDebitTokens(price);
  const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  if (balance < needed) return { wallet: w, renewed: false, applied: false };

  const debited = computeDebitedWallet(w, {
    billedInr: price,
    buildRef: `hostingplan_renew_${p.expiresAt}`,
    description: 'Hosting plan — Custom Domain (auto-renewal, 30 days)',
  }, nowIso);
  if (!debited.applied) return { wallet: w, renewed: false, applied: false }; // this lapse already renewed

  const plan: HostingPlanRecord = {
    ...p,
    expiresAt: new Date(nowMs + HOSTING_PLAN_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
  return { wallet: { ...debited.wallet, hostingPlan: plan }, renewed: true, applied: true };
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
export async function readHostingPlanStatus(db: any, userId: string): Promise<HostingPlanStatus> {
  const base: HostingPlanStatus = {
    enabled: hostingPlansEnabled(), active: false, plan: null,
    priceInr: hostingPlanPriceInr(), days: HOSTING_PLAN_DAYS,
  };
  if (!db || !userId) return base;
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const wallet = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      if (!snap.exists()) return null;
      const current = snap.data();
      const renewal = computeLazyRenewal(current, new Date().toISOString());
      if (renewal.applied) t.set(ref, renewal.wallet);
      return renewal.wallet;
    });
    if (!wallet) return base;
    const plan = (wallet.hostingPlan as HostingPlanRecord | undefined) ?? null;
    return { ...base, active: hostingPlanActive(wallet), plan: plan && plan.id === HOSTING_PLAN_ID ? plan : null };
  } catch {
    return base;
  }
}

export type PlanPurchaseResult =
  | { ok: true; plan: HostingPlanRecord; tokenBalance: number; charged: boolean }
  | { ok: false; error: string; reason: 'insufficient' | 'disabled' | 'unavailable'; shortfallTokens?: number };

/** Atomic purchase: debit + grant in one transaction on the wallet doc. Never throws. */
export async function purchaseHostingPlan(db: any, userId: string): Promise<PlanPurchaseResult> {
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
      const result = computePlanPurchase(current, new Date().toISOString());
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
      return { ok: false, error: 'Hosting plans are not available right now.', reason: 'disabled' };
    }
    invalidatePlanCache(userId);
    return {
      ok: true, plan: outcome.plan, charged: outcome.charged,
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
      if (!p || p.id !== HOSTING_PLAN_ID) return false;
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
