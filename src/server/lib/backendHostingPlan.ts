/**
 * backendHostingPlan — the ₹199/30-days "Managed Backend" plan (Deploy to NavBharatAI Cloud).
 *
 * MONEY DISCIPLINE IS INHERITED, NOT REINVENTED: this module mirrors hostingPlan.ts (the ₹99 Custom
 * Domain plan) — same wallet doc, same pure `computeDebitedWallet` debit, same idempotency-via-
 * ledger-buildRef, same lazy renewal, same no-overdraft rule. It deliberately does NOT touch or
 * generalise that live, battle-tested module (absolute rule 1 — never break the working plan); the
 * shared money primitives (walletDebit, payments) ARE the single source of truth both lean on. If a
 * third plan ever appears, THEN the plan lifecycle gets extracted once, with all three as tests.
 *
 * The plan record lives on the wallet doc (`user_token_wallets/{uid}.backendHostingPlan`) for the
 * same reason the domain plan does: purchase must debit and grant ATOMICALLY — one transaction over
 * one doc, one place money and entitlement can never disagree.
 *
 * LIFECYCLE: active → (expiry) → 3-day grace (app keeps serving; a late recharge renews silently)
 * → lapsed (the subdomain router answers 402 and deploys refuse until re-purchase). Renewal is LAZY:
 * attempted transactionally whenever the plan is read server-side after expiry. v1 has no reminder
 * sweep — recorded in PROGRESS.md as the known follow-up, not silently missing.
 */

import { doc, runTransaction, getServerDb } from './serverDb';
import { computeDebitedWallet } from './walletDebit';
import { inrToDebitTokens } from './payments';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';
import { getDoc } from './serverDb';
import { envFlag } from './envFlag';

export const BACKEND_PLAN_ID = 'managed_backend';
export const BACKEND_PLAN_DAYS = 30;
/** Days after expiry the app keeps serving while a recharge can still save it. */
export const BACKEND_PLAN_GRACE_DAYS = 3;

export function backendPlansEnabled(): boolean {
  return envFlag('AGENTV3_MANAGED_BACKEND', false);
}

/** ₹ per 30 days. Env-tunable so a price change never needs a deploy. */
export function backendPlanPriceInr(): number {
  const v = Number(process.env.BACKEND_HOSTING_PLAN_PRICE_INR);
  return Number.isFinite(v) && v > 0 ? v : 199;
}

export interface BackendPlanRecord {
  id: string;
  purchasedAt: string;
  expiresAt: string;
  autoRenew: boolean;
  lapsedAt?: string | null;
}

/** Pure: plan active at `nowMs` (grace NOT included — grace is a serving decision, not an active one). */
export function backendPlanActive(wallet: Record<string, any> | null | undefined, nowMs: number = Date.now()): boolean {
  const p = wallet?.backendHostingPlan as BackendPlanRecord | undefined;
  if (!p || p.id !== BACKEND_PLAN_ID || typeof p.expiresAt !== 'string') return false;
  const exp = Date.parse(p.expiresAt);
  return Number.isFinite(exp) && exp > nowMs;
}

/** Pure: may the app still SERVE traffic? Active, or expired within the grace window. */
export function backendPlanServes(wallet: Record<string, any> | null | undefined, nowMs: number = Date.now()): boolean {
  if (backendPlanActive(wallet, nowMs)) return true;
  const p = wallet?.backendHostingPlan as BackendPlanRecord | undefined;
  if (!p || p.id !== BACKEND_PLAN_ID) return false;
  const exp = Date.parse(p.expiresAt);
  return Number.isFinite(exp) && nowMs - exp <= BACKEND_PLAN_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

export type BackendPlanPurchaseOutcome =
  | { ok: true; wallet: Record<string, any>; plan: BackendPlanRecord; charged: boolean }
  | { ok: false; reason: 'insufficient' | 'disabled'; shortfallTokens?: number };

/**
 * PURE purchase/extension — an active plan extends from its current expiry (paying early never loses
 * days); an expired/absent one starts fresh from `now`. Idempotent per period via the ledger ref.
 */
export function computeBackendPlanPurchase(
  current: Record<string, any>,
  nowIso: string,
): BackendPlanPurchaseOutcome {
  if (!backendPlansEnabled()) return { ok: false, reason: 'disabled' };
  const w = current || {};
  const nowMs = Date.parse(nowIso);
  const price = backendPlanPriceInr();
  const needed = inrToDebitTokens(price);
  const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  if (balance < needed) {
    return { ok: false, reason: 'insufficient', shortfallTokens: Math.ceil(needed - balance) };
  }

  const prior = w.backendHostingPlan as BackendPlanRecord | undefined;
  const priorExp = prior?.id === BACKEND_PLAN_ID ? Date.parse(prior.expiresAt) : NaN;
  const periodStartMs = Number.isFinite(priorExp) && priorExp > nowMs ? priorExp : nowMs;
  const expiresAt = new Date(periodStartMs + BACKEND_PLAN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const debited = computeDebitedWallet(w, {
    billedInr: price,
    buildRef: `backendplan_${BACKEND_PLAN_ID}_${periodStartMs}`,
    description: 'Hosting plan — Managed Backend (30 days)',
  }, nowIso);

  const plan: BackendPlanRecord = {
    id: BACKEND_PLAN_ID,
    purchasedAt: (prior?.id === BACKEND_PLAN_ID && prior.purchasedAt) || nowIso,
    expiresAt,
    autoRenew: prior?.id === BACKEND_PLAN_ID ? prior.autoRenew !== false : true,
    lapsedAt: null,
  };

  return { ok: true, wallet: { ...debited.wallet, backendHostingPlan: plan }, plan, charged: debited.applied };
}

/**
 * PURE lazy renewal — an EXPIRED plan with autoRenew on re-purchases 30 days from `now` (never
 * back-dated; the lapsed gap was not service). Idempotency ref keyed on the OLD expiry so two
 * concurrent reads renew once. Insufficient balance / autoRenew off ⇒ untouched.
 */
export function computeBackendLazyRenewal(
  current: Record<string, any>,
  nowIso: string,
): { wallet: Record<string, any>; renewed: boolean; applied: boolean } {
  const w = current || {};
  if (!backendPlansEnabled()) return { wallet: w, renewed: false, applied: false };
  const p = w.backendHostingPlan as BackendPlanRecord | undefined;
  if (!p || p.id !== BACKEND_PLAN_ID || p.autoRenew === false) return { wallet: w, renewed: false, applied: false };
  const nowMs = Date.parse(nowIso);
  const exp = Date.parse(p.expiresAt);
  if (!Number.isFinite(exp) || exp > nowMs) return { wallet: w, renewed: false, applied: false };

  const price = backendPlanPriceInr();
  const needed = inrToDebitTokens(price);
  const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  if (balance < needed) return { wallet: w, renewed: false, applied: false };

  const debited = computeDebitedWallet(w, {
    billedInr: price,
    buildRef: `backendplan_renew_${p.expiresAt}`,
    description: 'Hosting plan — Managed Backend (auto-renewal, 30 days)',
  }, nowIso);
  if (!debited.applied) return { wallet: w, renewed: false, applied: false };

  const plan: BackendPlanRecord = {
    ...p,
    expiresAt: new Date(nowMs + BACKEND_PLAN_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    lapsedAt: null,
  };
  return { wallet: { ...debited.wallet, backendHostingPlan: plan }, renewed: true, applied: true };
}

async function canonicalId(db: any, uid: string): Promise<string> {
  if (!walletMergeResolveEnabled()) return uid;
  return resolveCanonicalWalletId(async (u) => {
    const s = await getDoc(doc(db, 'user_token_wallets', u));
    return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
  }, uid).catch(() => uid);
}

export interface BackendPlanStatus {
  enabled: boolean;
  active: boolean;
  /** Expired-but-in-grace apps still serve; the UI names this state honestly. */
  serving: boolean;
  plan: BackendPlanRecord | null;
  priceInr: number;
  days: number;
}

/** Read (and lazily renew) a user's backend plan. Never throws; store failure = inactive + null. */
export async function readBackendPlanStatus(db: any, userId: string, nowIso?: string): Promise<BackendPlanStatus> {
  const base: BackendPlanStatus = {
    enabled: backendPlansEnabled(), active: false, serving: false, plan: null,
    priceInr: backendPlanPriceInr(), days: BACKEND_PLAN_DAYS,
  };
  if (!db || !userId) return base;
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const now = nowIso ?? new Date().toISOString();
    const wallet = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      if (!snap.exists()) return null;
      const renewal = computeBackendLazyRenewal(snap.data(), now);
      if (renewal.applied) t.set(ref, renewal.wallet);
      return renewal.wallet;
    });
    if (!wallet) return base;
    const nowMs = Date.parse(now);
    const plan = (wallet.backendHostingPlan as BackendPlanRecord | undefined) ?? null;
    return {
      ...base,
      active: backendPlanActive(wallet, nowMs),
      serving: backendPlanServes(wallet, nowMs),
      plan: plan && plan.id === BACKEND_PLAN_ID ? plan : null,
    };
  } catch {
    return base;
  }
}

export type BackendPlanPurchaseResult =
  | { ok: true; plan: BackendPlanRecord; tokenBalance: number; charged: boolean }
  | { ok: false; error: string; reason: 'insufficient' | 'disabled' | 'unavailable'; shortfallTokens?: number };

/** Atomic purchase: debit + grant in one wallet transaction. Never throws. `nowIso` injectable. */
export async function purchaseBackendPlan(db: any, userId: string, nowIso?: string): Promise<BackendPlanPurchaseResult> {
  if (!backendPlansEnabled()) {
    return { ok: false, error: 'Managed backend hosting is not available right now.', reason: 'disabled' };
  }
  if (!db || !userId) return { ok: false, error: 'Please try again in a moment.', reason: 'unavailable' };
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const outcome = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      const result = computeBackendPlanPurchase(current, nowIso ?? new Date().toISOString());
      if (result.ok) t.set(ref, result.wallet);
      return result;
    });
    if (!outcome.ok) {
      if (outcome.reason === 'insufficient') {
        return {
          ok: false, reason: 'insufficient', shortfallTokens: outcome.shortfallTokens,
          error: 'Your wallet balance is not enough for the Managed Backend plan — please recharge first.',
        };
      }
      return { ok: false, error: 'Managed backend hosting is not available right now.', reason: 'disabled' };
    }
    _probeCache.delete(userId);
    return {
      ok: true, plan: outcome.plan, charged: outcome.charged,
      tokenBalance: typeof outcome.wallet.tokenBalance === 'number' ? outcome.wallet.tokenBalance : 0,
    };
  } catch {
    return { ok: false, error: 'Could not complete the purchase — nothing was charged. Please try again.', reason: 'unavailable' };
  }
}

// ---------- cheap cached probe for the hot path (the subdomain router runs per request) ----------

const PROBE_TTL_MS = 60 * 1000; // shorter than the domain plan's 5 min: a lapse must bite within a minute
const _probeCache = new Map<string, { serving: boolean; known: boolean; at: number }>();

export function _clearBackendPlanCacheForTests(): void {
  _probeCache.clear();
}

/**
 * May this user's managed apps serve right now? Cached 60s, bounded 3s, never throws.
 * `known:false` on store failure — the ROUTER treats unknown as "serve" (rule 1: an outage on OUR
 * side must never take a paying user's live site down; the lapse enforcement waits for a known answer).
 */
export async function probeBackendPlanServes(userId: string | null | undefined): Promise<{ serving: boolean; known: boolean }> {
  if (!userId) return { serving: false, known: true };
  if (!backendPlansEnabled()) return { serving: false, known: true };
  const hit = _probeCache.get(userId);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return { serving: hit.serving, known: hit.known };
  try {
    const db = getServerDb();
    if (!db) return { serving: false, known: false };
    const status = await Promise.race([
      readBackendPlanStatus(db, userId),
      new Promise<null>((r) => setTimeout(() => r(null), 3_000)),
    ]);
    if (!status) return { serving: false, known: false };
    const probe = { serving: status.serving, known: true, at: Date.now() };
    _probeCache.set(userId, probe);
    return { serving: probe.serving, known: true };
  } catch {
    return { serving: false, known: false };
  }
}
