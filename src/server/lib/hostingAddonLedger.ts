/**
 * Add-on purchases — debit and entitlement in ONE pure step, on the wallet doc.
 *
 * The law this file exists to keep (admin 2026-10-09):
 *   • Money moves only when the slot is written. A refused purchase returns the same wallet.
 *   • A second request with the same ref does not buy a second slot and does not charge again.
 *   • Gift money cannot buy an add-on. The welcome gift stays where it is.
 *   • An add-on we cannot deliver (`sellable: false`) is refused before any balance check that
 *     could be mistaken for a charge. The wallet is not written.
 *   • Removal refunds unused days ONLY when the slot is no longer in use. Still in use ⇒ nothing
 *     is refunded and the slot stays, so we never stop charging for a website or a domain that is
 *     still live, and we never take the money back while it is.
 *
 * Delivery of a slot IS the row on the wallet. The publish cap and the domain cap read that row.
 * There is no second "mark it active later" step in which the money and the slot could disagree.
 */

import { doc, getDoc, runTransaction } from './serverDb';
import { computeDebitedWallet } from './walletDebit';
import { ledgerPatch } from './walletStatement';
import { checkPlanPayable } from './giftSpend';
import { inrToDebitTokens, inrToWalletTokens, TOKENS_PER_RUPEE } from './payments';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';
import { hostingPlansEnabled } from './hostingPlan';
import {
  HOSTING_ADDONS, addonAgreementTerms, addonById, activeAddonCount, activeAddonRows, validAddonRef,
  type HostingAddon, type HostingAddonId, type HostingAddonRecord,
} from '../../lib/hostingAddons';

export type AddonPurchaseOutcome =
  | { ok: true; wallet: Record<string, any>; addon: HostingAddonRecord; charged: boolean }
  | {
      ok: false;
      reason: 'not_available' | 'agreement_required' | 'bad_ref' | 'at_cap' | 'insufficient' | 'gift_only' | 'disabled';
      shortfallTokens?: number;
      giftTokens?: number;
      paidTokens?: number;
    };

function rowsOf(wallet: Record<string, any> | null | undefined): HostingAddonRecord[] {
  const raw = wallet?.hostingAddons;
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object') as HostingAddonRecord[] : [];
}

/**
 * PURE purchase. `nowIso` is the clock, so a test does not rot when the calendar moves.
 * Does not look at whether the user is "using" anything — a new slot is room, not a live site.
 */
export function computeAddonPurchase(
  current: Record<string, any> | null | undefined,
  nowIso: string,
  addonId: string,
  opts: { agreedToTerms?: boolean; clientRef?: unknown },
): AddonPurchaseOutcome {
  if (!hostingPlansEnabled()) return { ok: false, reason: 'disabled' };
  const addon = addonById(addonId);
  if (!addon || !addon.sellable || !(addon.priceInr > 0) || addon.max <= 0) {
    return { ok: false, reason: 'not_available' };
  }
  if (!opts.agreedToTerms) return { ok: false, reason: 'agreement_required' };
  if (!validAddonRef(opts.clientRef)) return { ok: false, reason: 'bad_ref' };
  const clientRef = opts.clientRef;

  const w = current || {};
  const nowMs = Date.parse(nowIso);
  const existing = rowsOf(w).find((r) => r.ref === clientRef);
  if (existing && existing.addonId === addon.id) {
    return { ok: true, wallet: w, addon: existing, charged: false };
  }

  if (activeAddonCount(w, addon.id, nowMs) >= addon.max) return { ok: false, reason: 'at_cap' };

  const needed = inrToDebitTokens(addon.priceInr);
  const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  if (balance < needed) {
    return { ok: false, reason: 'insufficient', shortfallTokens: Math.ceil(needed - balance) };
  }
  const giftBlock = checkPlanPayable(w, needed);
  if (giftBlock) {
    return {
      ok: false,
      reason: 'gift_only',
      shortfallTokens: giftBlock.shortfallTokens,
      giftTokens: giftBlock.giftTokens,
      paidTokens: giftBlock.paidTokens,
    };
  }

  const periodStartMs = Number.isFinite(nowMs) ? nowMs : Date.parse(nowIso);
  const record: HostingAddonRecord = {
    ref: clientRef,
    addonId: addon.id,
    purchasedAt: nowIso,
    expiresAt: new Date(periodStartMs + addon.days * 24 * 60 * 60 * 1000).toISOString(),
    agreedAt: nowIso,
  };
  const debited = computeDebitedWallet(w, {
    billedInr: addon.priceInr,
    buildRef: `hostingaddon_${clientRef}`,
    feature: 'hosting-addon',
    description: `Hosting add-on — ${addon.name} (${addon.days} days)`,
    spends: 'paid-only',
  }, nowIso);

  const nextRows = rowsOf(debited.wallet).filter((r) => r.ref !== clientRef).concat(record);
  return {
    ok: true,
    charged: debited.applied,
    addon: record,
    wallet: { ...debited.wallet, hostingAddons: nextRows, hasHostingAddons: true },
  };
}

/** Add-ons that may be billed only after something real was handed over. Not the Billing "Add" button. */
const DELIVERED_ADDONS = new Set<HostingAddonId>(['server', 'dedicated_db']);

/**
 * Same debit as a slot, but ONLY for a server or a database, and ONLY with proof that it exists.
 * A missing proof is a refusal. The wallet is not written by this function; the caller writes it
 * in the same transaction, and only after the server URL or the database id is in hand.
 */
export function computeDeliveredAddonPurchase(
  current: Record<string, any> | null | undefined,
  nowIso: string,
  addonId: string,
  opts: { agreedToTerms?: boolean; clientRef?: unknown; proof?: unknown },
): AddonPurchaseOutcome {
  const addon = addonById(addonId);
  if (!addon || !DELIVERED_ADDONS.has(addon.id)) return { ok: false, reason: 'not_available' };
  const proof = typeof opts.proof === 'string' ? opts.proof.trim() : '';
  if (proof.length < 8) return { ok: false, reason: 'not_available' };
  if (!hostingPlansEnabled()) return { ok: false, reason: 'disabled' };
  if (!opts.agreedToTerms) return { ok: false, reason: 'agreement_required' };
  if (!validAddonRef(opts.clientRef)) return { ok: false, reason: 'bad_ref' };
  const clientRef = opts.clientRef;

  const w = current || {};
  const nowMs = Date.parse(nowIso);
  const existing = rowsOf(w).find((r) => r.ref === clientRef);
  if (existing && existing.addonId === addon.id) {
    return { ok: true, wallet: w, addon: existing, charged: false };
  }
  if (activeAddonCount(w, addon.id, nowMs) >= addon.max) return { ok: false, reason: 'at_cap' };

  const needed = inrToDebitTokens(addon.priceInr);
  const balance = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  if (balance < needed) return { ok: false, reason: 'insufficient', shortfallTokens: Math.ceil(needed - balance) };
  const giftBlock = checkPlanPayable(w, needed);
  if (giftBlock) {
    return { ok: false, reason: 'gift_only', shortfallTokens: giftBlock.shortfallTokens, giftTokens: giftBlock.giftTokens, paidTokens: giftBlock.paidTokens };
  }

  const periodStartMs = Number.isFinite(nowMs) ? nowMs : Date.parse(nowIso);
  const record: HostingAddonRecord = {
    ref: clientRef,
    addonId: addon.id,
    purchasedAt: nowIso,
    expiresAt: new Date(periodStartMs + addon.days * 24 * 60 * 60 * 1000).toISOString(),
    agreedAt: nowIso,
    proof,
  };
  const debited = computeDebitedWallet(w, {
    billedInr: addon.priceInr,
    buildRef: `hostingaddon_${clientRef}`,
    feature: 'hosting-addon',
    description: `Hosting add-on — ${addon.name} (${addon.days} days)`,
    spends: 'paid-only',
  }, nowIso);
  const nextRows = rowsOf(debited.wallet).filter((r) => r.ref !== clientRef).concat(record);
  return {
    ok: true,
    charged: debited.applied,
    addon: record,
    wallet: { ...debited.wallet, hostingAddons: nextRows, hasHostingAddons: true },
  };
}

/** ₹ of unused time on a live add-on, rounded DOWN so a refund never exceeds what was paid. */
export function unusedAddonValueInr(row: HostingAddonRecord, nowMs: number): number {
  const spec = addonById(row.addonId);
  if (!spec) return 0;
  const exp = Date.parse(row.expiresAt);
  if (!Number.isFinite(exp) || exp <= nowMs) return 0;
  const DAY = 24 * 60 * 60 * 1000;
  const remainingDays = Math.min(spec.days, (exp - nowMs) / DAY);
  const perDay = spec.priceInr / spec.days;
  return Math.max(0, Math.floor(remainingDays * perDay * 100) / 100);
}

export type AddonRemovalOutcome =
  | { ok: true; wallet: Record<string, any>; creditedInr: number; removed: HostingAddonRecord }
  | { ok: false; reason: 'not_found' | 'still_in_use' };

/**
 * PURE removal.
 *
 * `baseAllowance` is what the user keeps WITHOUT any add-on of this kind (the free cap, or the
 * plan's own domains). `inUse` is how many websites are live, or how many domains are connected.
 * The slot may go only when what remains still covers what is in use.
 */
export function computeAddonRemoval(
  current: Record<string, any> | null | undefined,
  nowIso: string,
  ref: string,
  baseAllowance: number,
  inUse: number,
): AddonRemovalOutcome {
  const w = current || {};
  const nowMs = Date.parse(nowIso);
  const all = rowsOf(w);
  const row = all.find((r) => r.ref === ref);
  if (!row || !addonById(row.addonId)) return { ok: false, reason: 'not_found' };

  const exp = Date.parse(row.expiresAt);
  const live = Number.isFinite(exp) && exp > nowMs;
  if (live) {
    const others = activeAddonCount(w, row.addonId, nowMs) - 1;
    const after = Math.max(0, Math.floor(baseAllowance)) + Math.max(0, others);
    const used = Number.isFinite(inUse) ? Math.max(0, Math.floor(inUse)) : Number.POSITIVE_INFINITY;
    if (used > after) return { ok: false, reason: 'still_in_use' };
  }

  const creditedInr = live ? unusedAddonValueInr(row, nowMs) : 0;
  const creditedTokens = inrToWalletTokens(creditedInr);
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let next: Record<string, any> = { ...w, hostingAddons: all.filter((r) => r.ref !== ref) };
  if (creditedTokens > 0) {
    const spec = addonById(row.addonId) as HostingAddon;
    next = {
      ...next,
      tokenBalance: n(next.tokenBalance) + creditedTokens,
      remaining_balance: n(next.remaining_balance) + creditedInr,
      ...ledgerPatch(w, {
        type: 'refund',
        amountCoinsOrTokens: creditedTokens,
        moneySpent: 0,
        timestamp: nowIso,
        description: `Unused days on ${spec.name}, returned because you removed it`,
      }),
    };
    // ledgerPatch reads the OLD ledger off `w`. Re-apply onto next without dropping the row filter.
    next.hostingAddons = all.filter((r) => r.ref !== ref);
  }
  return { ok: true, wallet: next, creditedInr, removed: row };
}

async function canonicalId(db: any, uid: string): Promise<string> {
  if (!walletMergeResolveEnabled()) return uid;
  return resolveCanonicalWalletId(async (u) => {
    const s = await getDoc(doc(db, 'user_token_wallets', u));
    return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
  }, uid).catch(() => uid);
}

export interface AddonMenu {
  addons: readonly HostingAddon[];
  active: HostingAddonRecord[];
}

export async function readHostingAddons(db: any, userId: string, nowMs: number = Date.now()): Promise<AddonMenu> {
  const empty: AddonMenu = { addons: HOSTING_ADDONS, active: [] };
  if (!db || !userId) return empty;
  try {
    const ownerId = await canonicalId(db, userId);
    const snap = await getDoc(doc(db, 'user_token_wallets', ownerId));
    if (!snap.exists()) return empty;
    return { addons: HOSTING_ADDONS, active: activeAddonRows(snap.data() as any, nowMs) };
  } catch {
    return empty;
  }
}

type AddonFailReason = Extract<AddonPurchaseOutcome, { ok: false }>['reason'];

export type AddonPurchaseResult =
  | { ok: true; addon: HostingAddonRecord; charged: boolean; tokenBalance: number; terms: readonly string[] }
  | { ok: false; reason: AddonFailReason; error: string; shortfallTokens?: number };

export async function purchaseHostingAddon(
  db: any,
  userId: string,
  addonId: string,
  opts: { agreedToTerms?: boolean; clientRef?: unknown },
  nowIso?: string,
): Promise<AddonPurchaseResult> {
  const addon = addonById(addonId);
  if (!hostingPlansEnabled()) {
    return { ok: false, reason: 'disabled', error: 'Add-ons are not available right now.' };
  }
  if (!addon?.sellable) {
    return {
      ok: false,
      reason: 'not_available',
      error: addon?.unavailableReason || 'That add-on is not for sale. Nothing was charged.',
    };
  }
  if (!db || !userId) return { ok: false, reason: 'disabled', error: 'Please try again in a moment.' };
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const when = nowIso ?? new Date().toISOString();
    const outcome = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      const result = computeAddonPurchase(current, when, addonId, opts);
      if (result.ok) t.set(ref, result.wallet);
      return result;
    });
    if (!outcome.ok) {
      if (outcome.reason === 'insufficient') {
        return { ok: false, reason: 'insufficient', shortfallTokens: outcome.shortfallTokens, error: 'Your wallet balance is not enough — please recharge first. Nothing was charged.' };
      }
      if (outcome.reason === 'gift_only') {
        const giftInr = Math.round(((outcome.giftTokens ?? 0) / TOKENS_PER_RUPEE) * 100) / 100;
        const shortInr = Math.round(((outcome.shortfallTokens ?? 0) / TOKENS_PER_RUPEE) * 100) / 100;
        return {
          ok: false,
          reason: 'gift_only',
          shortfallTokens: outcome.shortfallTokens,
          error: `Your welcome gift is for building apps, not for add-ons. ₹${giftInr.toFixed(2)} of your balance is the gift. Add ₹${shortInr.toFixed(2)} — nothing was charged.`,
        };
      }
      if (outcome.reason === 'agreement_required') {
        return { ok: false, reason: 'agreement_required', error: 'Please tick the terms before adding this. Nothing was charged.' };
      }
      if (outcome.reason === 'bad_ref') {
        return { ok: false, reason: 'bad_ref', error: 'Please try that again. Nothing was charged.' };
      }
      if (outcome.reason === 'at_cap') {
        return { ok: false, reason: 'at_cap', error: `You already have the maximum of ${addon.max}. Nothing was charged.` };
      }
      return { ok: false, reason: 'not_available', error: 'That add-on is not for sale. Nothing was charged.' };
    }
    return {
      ok: true,
      addon: outcome.addon,
      charged: outcome.charged,
      tokenBalance: typeof outcome.wallet.tokenBalance === 'number' ? outcome.wallet.tokenBalance : 0,
      terms: addonAgreementTerms(addon),
    };
  } catch {
    return { ok: false, reason: 'disabled', error: 'Could not complete that — nothing was charged. Please try again.' };
  }
}

export async function previewDeliveredCharge(
  db: any,
  userId: string,
  addonId: 'server' | 'dedicated_db',
  clientRef: string,
): Promise<{ active: Array<{ ref: string; proof?: string }> | null; canPay: boolean | null }> {
  if (!db || !userId) return { active: null, canPay: null };
  try {
    const ownerId = await canonicalId(db, userId);
    const snap = await getDoc(doc(db, 'user_token_wallets', ownerId));
    const data = snap.exists() ? (snap.data() as Record<string, any>) : { tokenBalance: 0, walletLedger: [] };
    const active = activeAddonRows(data)
      .filter((r) => r.addonId === addonId)
      .map((r) => ({ ref: r.ref, proof: r.proof }));
    const preview = computeDeliveredAddonPurchase(data, new Date().toISOString(), addonId, {
      agreedToTerms: true,
      clientRef,
      proof: 'preflight-ok',
    });
    if (!preview.ok) return { active, canPay: false };
    const exp = Date.parse(preview.addon.expiresAt);
    const stillPaid = Number.isFinite(exp) && exp > Date.now();
    return { active, canPay: preview.charged || stillPaid };
  } catch {
    return { active: null, canPay: null };
  }
}

export async function chargeDeliveredHostingAddon(
  db: any,
  userId: string,
  addonId: 'server' | 'dedicated_db',
  opts: { agreedToTerms?: boolean; clientRef?: unknown; proof?: unknown },
  nowIso?: string,
): Promise<AddonPurchaseResult> {
  const addon = addonById(addonId);
  if (!hostingPlansEnabled()) return { ok: false, reason: 'disabled', error: 'Add-ons are not available right now. Nothing was charged.' };
  if (!addon || !DELIVERED_ADDONS.has(addon.id)) {
    return { ok: false, reason: 'not_available', error: 'That is not sold this way. Nothing was charged.' };
  }
  if (typeof opts.proof !== 'string' || opts.proof.trim().length < 8) {
    return { ok: false, reason: 'not_available', error: 'Nothing was charged — there is no live server or ready database to pay for.' };
  }
  if (!db || !userId) return { ok: false, reason: 'disabled', error: 'Please try again in a moment. Nothing was charged.' };
  try {
    const ownerId = await canonicalId(db, userId);
    const ref = doc(db, 'user_token_wallets', ownerId);
    const when = nowIso ?? new Date().toISOString();
    const outcome = await runTransaction(db, async (t: any) => {
      const snap = await t.get(ref);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      const result = computeDeliveredAddonPurchase(current, when, addonId, opts);
      if (result.ok) t.set(ref, result.wallet);
      return result;
    });
    if (!outcome.ok) {
      if (outcome.reason === 'insufficient') {
        return { ok: false, reason: 'insufficient', shortfallTokens: outcome.shortfallTokens, error: 'Your wallet balance is not enough — please recharge first. Nothing was charged.' };
      }
      if (outcome.reason === 'gift_only') {
        const giftInr = Math.round(((outcome.giftTokens ?? 0) / TOKENS_PER_RUPEE) * 100) / 100;
        const shortInr = Math.round(((outcome.shortfallTokens ?? 0) / TOKENS_PER_RUPEE) * 100) / 100;
        return {
          ok: false,
          reason: 'gift_only',
          shortfallTokens: outcome.shortfallTokens,
          error: `Your welcome gift is for building apps, not for add-ons. ₹${giftInr.toFixed(2)} of your balance is the gift. Add ₹${shortInr.toFixed(2)} — nothing was charged.`,
        };
      }
      if (outcome.reason === 'agreement_required') {
        return { ok: false, reason: 'agreement_required', error: 'Please tick the terms before adding this. Nothing was charged.' };
      }
      if (outcome.reason === 'at_cap') {
        return { ok: false, reason: 'at_cap', error: `You already have the maximum of ${addon.max}. Nothing was charged.` };
      }
      return { ok: false, reason: outcome.reason, error: 'That could not be charged. Nothing was charged.' };
    }
    return {
      ok: true,
      addon: outcome.addon,
      charged: outcome.charged,
      tokenBalance: typeof outcome.wallet.tokenBalance === 'number' ? outcome.wallet.tokenBalance : 0,
      terms: addonAgreementTerms(addon),
    };
  } catch {
    return { ok: false, reason: 'disabled', error: 'Could not complete that — nothing was charged. Please try again.' };
  }
}

export async function removeHostingAddon(
  db: any,
  userId: string,
  ref: string,
  baseAllowance: number,
  inUse: number,
  nowIso?: string,
): Promise<{ ok: true; creditedInr: number; tokenBalance: number } | { ok: false; reason: string; error: string }> {
  if (!db || !userId || !validAddonRef(ref)) {
    return { ok: false, reason: 'not_found', error: 'That add-on was not found. Nothing was changed.' };
  }
  try {
    const ownerId = await canonicalId(db, userId);
    const docRef = doc(db, 'user_token_wallets', ownerId);
    const when = nowIso ?? new Date().toISOString();
    const outcome = await runTransaction(db, async (t: any) => {
      const snap = await t.get(docRef);
      if (!snap.exists()) return { ok: false as const, reason: 'not_found' };
      const result = computeAddonRemoval(snap.data(), when, ref, baseAllowance, inUse);
      if (result.ok) t.set(docRef, result.wallet);
      return result;
    });
    if (!outcome.ok) {
      if (outcome.reason === 'still_in_use') {
        return {
          ok: false,
          reason: 'still_in_use',
          error: 'This is still in use. Unpublish the extra website, or disconnect the extra domain, and then remove it. Nothing was refunded.',
        };
      }
      return { ok: false, reason: 'not_found', error: 'That add-on was not found. Nothing was changed.' };
    }
    return {
      ok: true,
      creditedInr: outcome.creditedInr,
      tokenBalance: typeof outcome.wallet.tokenBalance === 'number' ? outcome.wallet.tokenBalance : 0,
    };
  } catch {
    return { ok: false, reason: 'unavailable', error: 'Could not remove that. It is still active and nothing was refunded.' };
  }
}

export type { HostingAddonId };
