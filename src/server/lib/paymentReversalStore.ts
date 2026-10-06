// A REFUND OR A CHARGEBACK TAKES BACK THE TOKENS THAT PAYMENT BOUGHT — the I/O half (Q-614).
//
// The rules are in `paymentReversal.ts` (pure, tested on their own). This module does the two things
// that cannot be pure: it asks the GATEWAY what was really refunded or lost (never the webhook body),
// and it applies the result in ONE Firestore transaction together with the order's idempotency marker,
// so a retried webhook can never debit twice.
//
// 🔒 ONE ENTRY POINT FOR EVERY RAIL: `applyOrderReversal` takes a `payment_transactions` id and the
// authoritative reversed totals. The Cashfree webhook calls it today; a Play voided-purchase or an App
// Store refund notification would call it with the store's refunded amount the day that infrastructure
// exists (see `reversalPaidBasisInr` for the store basis). There is deliberately no unauthenticated
// endpoint for those rails here — see BUILD_REPORT_QUEUE.md Q-614 for what has to be configured first.
// UPDATE 2026-10-06 (Q-690): Google Play is now wired — a daily PULL of Play's Voided Purchases list
// (`playVoidedPurchases.ts`) calls `applyOrderReversal` with the purchase's full store price. No push
// endpoint was needed. App Store refunds are still not wired.

import axios from 'axios';
import { doc, getDoc, runTransaction } from './serverDb';
import { cashfreePaymentsAvailability } from './cashfreeCredentials';
import { orderCreditedTokens, type WalletCreditTx } from './orderCredit';
import { rupeesToTokens } from './walletMirror';
import { GIFT_CODE_COLLECTION } from './giftCodes';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';
import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import {
  REVERSAL_FIELDS, recordedReversedInr, reversalPaidBasisInr, clawbackTargetTokens, clawbackDeltaTokens,
  computeClawedBackWallet, sumSuccessfulRefundsInr, sumLostDisputesInr,
} from './paymentReversal';

function money(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** What the gateway says was reversed. `null` = that listing could not be read (never "zero"). */
export interface CashfreeReversalRead {
  refundedInr: number | null;
  disputeLostInr: number | null;
  /** Why a listing could not be read, for OUR log only. */
  errors: string[];
}

/**
 * Ask Cashfree itself what was refunded and what was lost in disputes on one order.
 *
 * Uses the PLATFORM credentials only (`cashfreePaymentsAvailability`, the same decision order creation
 * and verification use), with the same `x-api-version: 2023-08-01` headers `payments.ts` sends.
 *
 * ASSUMPTION: a 404 from the disputes listing means the order has no disputes (that is how Cashfree
 * answers "not found" for a listing with nothing in it); any other failure is reported as unreadable,
 * so a dispute event is retried rather than treated as "nothing lost".
 */
export async function readCashfreeReversals(orderId: string): Promise<CashfreeReversalRead> {
  const availability = cashfreePaymentsAvailability();
  if (!availability.ok) {
    return { refundedInr: null, disputeLostInr: null, errors: [availability.code] };
  }
  const base = availability.mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  const headers = {
    'x-client-id': availability.clientId,
    'x-client-secret': availability.clientSecret,
    'x-api-version': '2023-08-01',
  };
  const id = encodeURIComponent(orderId);
  const errors: string[] = [];

  let refundedInr: number | null = null;
  try {
    const res = await axios.get(`${base}/orders/${id}/refunds`, { headers });
    refundedInr = sumSuccessfulRefundsInr(res?.data, orderId);
  } catch (err: any) {
    errors.push(`refunds: ${err?.response?.status ?? err?.message ?? 'unreadable'}`);
  }

  let disputeLostInr: number | null = null;
  try {
    const res = await axios.get(`${base}/orders/${id}/disputes`, { headers });
    disputeLostInr = sumLostDisputesInr(res?.data, orderId);
  } catch (err: any) {
    if (err?.response?.status === 404) disputeLostInr = 0;
    else errors.push(`disputes: ${err?.response?.status ?? err?.message ?? 'unreadable'}`);
  }

  return { refundedInr, disputeLostInr, errors };
}

export type ReversalStatus =
  | 'unknown-order'
  /** Totals recorded; the order has not been credited (or its gift code not minted) yet — the credit applies them. */
  | 'recorded-before-credit'
  /** Nothing new to take: the target was already applied, or no money was reversed. */
  | 'nothing-new'
  /** A product that put no tokens in a wallet (the withdrawn Professional Pass). Totals recorded only. */
  | 'not-clawable'
  | 'clawed-back'
  | 'gift-code-reduced'
  | 'gift-code-voided';

export interface ReversalResult {
  status: ReversalStatus;
  targetTokens?: number;
  appliedTokens?: number;
  shortfallTokens?: number;
  /** For a gift order: the code's value after this reversal. */
  giftFaceInr?: number;
}

/**
 * Apply the authoritative reversed totals of one order, exactly once.
 *
 * `refundedInr` / `disputeLostInr` are what the gateway reported, or `null` when that listing could not
 * be read — then the order's stored figure stands (totals only ever grow), so an unreadable listing can
 * never shrink a reversal or give tokens back.
 *
 * In ONE transaction: re-read the order, compute the new target, write the marker, and debit the
 * wallet (or reduce / void an unredeemed gift code). Every read precedes every write, as Firestore
 * requires.
 *
 * WHOSE WALLET. A wallet order's tokens went to its buyer, so they come back from the buyer — through
 * the canonical wallet when accounts were merged, the same resolution every debit uses. A GIFT order:
 *   • code still UNUSED → its value is reduced by the reversal (voided at a full reversal), and no wallet
 *     moves: the money never reached anyone's balance yet;
 *   • code already REDEEMED → the recipient is never touched (they were given it in good faith, and a
 *     stranger's refund must not empty their wallet); the BUYER's wallet gives the value back instead,
 *     down to zero and never below, and any part that could not be taken is recorded as shortfall.
 */
export async function applyOrderReversal(
  db: any,
  input: {
    orderId: string;
    refundedInr: number | null;
    disputeLostInr: number | null;
    now?: string;
    /**
     * Facts about the reversal to keep ON the order, written with the totals in the same transaction —
     * e.g. a store's `voidedReason` / `voidedSource`. Never one of `REVERSAL_FIELDS` (those are this
     * function's own arithmetic, and a caller overwriting them would defeat the idempotency marker).
     */
    recordFields?: Record<string, string | number | boolean>;
    /** Plain words for the user's statement line (see `ClawbackInput.note`). */
    ledgerNote?: string;
  },
): Promise<ReversalResult> {
  const now = input.now ?? new Date().toISOString();
  const txRef = doc(db, 'payment_transactions', input.orderId);
  const pre = await getDoc(txRef);
  if (!pre.exists()) return { status: 'unknown-order' };

  // Resolve the wallet OUTSIDE the transaction, exactly as `walletDebit` does: the merge pointer is a
  // stable fact, and a resolver failure falls back to the raw uid rather than to nothing.
  const buyerUid = String((pre.data() as { userId?: unknown })?.userId ?? '');
  let walletOwner = buyerUid;
  if (walletOwner && walletMergeResolveEnabled()) {
    walletOwner = await resolveCanonicalWalletId(async (u) => {
      const s = await getDoc(doc(db, 'user_token_wallets', u));
      return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
    }, walletOwner).catch(() => buyerUid);
  }
  const walletRef = walletOwner ? doc(db, 'user_token_wallets', walletOwner) : null;

  return runTransaction(db, async (t: any): Promise<ReversalResult> => {
    // ── READS (all of them, before any write) ──
    const snap = await t.get(txRef);
    if (!snap.exists()) return { status: 'unknown-order' };
    const tx = snap.data() as Record<string, any>;
    const productType = String(tx.productType || '');
    const isGift = productType === 'gift_code';

    let codeRef: any = null;
    let code: Record<string, any> | null = null;
    if (isGift) {
      let codeId = typeof tx.giftCode === 'string' ? tx.giftCode : '';
      if (!codeId) {
        const pointer = await t.get(doc(db, GIFT_CODE_COLLECTION, `order_${input.orderId}`));
        if (pointer.exists()) codeId = String((pointer.data() as { code?: unknown })?.code ?? '');
      }
      if (codeId) {
        codeRef = doc(db, GIFT_CODE_COLLECTION, codeId);
        const codeSnap = await t.get(codeRef);
        code = codeSnap.exists() ? (codeSnap.data() as Record<string, any>) : null;
      }
    }
    const walletSnap = walletRef ? await t.get(walletRef) : null;

    // ── THE TOTALS: only ever grow ──
    const storedRefunded = money(tx[REVERSAL_FIELDS.refundedInr]);
    const storedDisputes = money(tx[REVERSAL_FIELDS.disputeLostInr]);
    const refunded = Math.max(storedRefunded, money(input.refundedInr));
    const disputeLost = Math.max(storedDisputes, money(input.disputeLostInr));
    const reserved = new Set<string>(Object.values(REVERSAL_FIELDS));
    const recordFields = Object.fromEntries(
      Object.entries(input.recordFields ?? {}).filter(([k]) => !reserved.has(k) && k !== 'reversalCheckedAt'),
    );
    const totals: Record<string, unknown> = {
      ...recordFields,
      [REVERSAL_FIELDS.refundedInr]: refunded,
      [REVERSAL_FIELDS.disputeLostInr]: disputeLost,
      reversalCheckedAt: now,
    };
    const priorReversed = recordedReversedInr(tx);
    const reversed = recordedReversedInr({ ...tx, ...totals });
    const newlyReversed = Math.round((reversed - priorReversed) * 100) / 100;
    const kind: 'refund' | 'chargeback' = disputeLost > storedDisputes ? 'chargeback' : 'refund';

    if (tx.paymentStatus !== 'SUCCESS') {
      t.update(txRef, totals);
      return { status: 'recorded-before-credit' };
    }
    if (productType === 'professional_pass') {
      // No tokens were credited for a pass, so there are none to take back. The pass itself is a
      // withdrawn product (admin 2026-08-10); revoking a running pass on refund is not built.
      t.update(txRef, totals);
      return { status: 'not-clawable' };
    }

    const credited = isGift ? rupeesToTokens(money(tx.giftFaceInr)) : orderCreditedTokens(tx as unknown as WalletCreditTx);
    const target = clawbackTargetTokens(credited, reversalPaidBasisInr(tx), reversed);
    const delta = clawbackDeltaTokens(target, tx[REVERSAL_FIELDS.clawbackTargetTokens]);
    if (delta <= 0) {
      t.update(txRef, totals);
      return { status: 'nothing-new', targetTokens: num(tx[REVERSAL_FIELDS.clawbackTargetTokens]) };
    }

    if (isGift) {
      if (!code || !codeRef) {
        // Paid but not minted yet: the fulfilment applies these totals right after it mints.
        t.update(txRef, totals);
        return { status: 'recorded-before-credit' };
      }
      if (code.status === 'unused') {
        const face = money(tx.giftFaceInr);
        const remaining = Math.round((face - target / TOKENS_PER_RUPEE) * 100) / 100;
        if (remaining <= 0) {
          t.update(codeRef, { status: 'voided', voidedAt: now, voidReason: kind === 'chargeback' ? 'payment_charged_back' : 'payment_refunded' });
          t.update(txRef, { ...totals, [REVERSAL_FIELDS.clawbackTargetTokens]: target });
          return { status: 'gift-code-voided', targetTokens: target, giftFaceInr: 0 };
        }
        t.update(codeRef, { faceInr: remaining, faceBeforeRefundInr: face, reducedAt: now });
        t.update(txRef, { ...totals, [REVERSAL_FIELDS.clawbackTargetTokens]: target });
        return { status: 'gift-code-reduced', targetTokens: target, giftFaceInr: remaining };
      }
      if (code.status !== 'redeemed') {
        // Already voided: nothing of its value is left anywhere to take.
        t.update(txRef, { ...totals, [REVERSAL_FIELDS.clawbackTargetTokens]: target });
        return { status: 'nothing-new', targetTokens: target };
      }
      // Redeemed: falls through to the BUYER's wallet below. Never the recipient's.
    }

    const priorApplied = num(tx[REVERSAL_FIELDS.clawedBackTokens]);
    const priorShortfall = num(tx[REVERSAL_FIELDS.clawbackShortfallTokens]);
    if (!walletRef || !walletSnap || !walletSnap.exists()) {
      // No wallet to take from: the whole delta is shortfall, recorded for the admin. No wallet document
      // is created just to hold a refund line.
      t.update(txRef, {
        ...totals,
        [REVERSAL_FIELDS.clawbackTargetTokens]: target,
        [REVERSAL_FIELDS.clawedBackTokens]: priorApplied,
        [REVERSAL_FIELDS.clawbackShortfallTokens]: priorShortfall + delta,
      });
      return { status: 'clawed-back', targetTokens: target, appliedTokens: 0, shortfallTokens: delta };
    }

    const out = computeClawedBackWallet(walletSnap.data(), {
      tokens: delta,
      reversedInr: newlyReversed > 0 ? newlyReversed : reversed,
      kind,
      reversalRef: input.orderId,
      ...(isGift ? { what: 'gift code purchase' } : {}),
      ...(input.ledgerNote ? { note: input.ledgerNote } : {}),
    }, now);
    t.set(walletRef, out.wallet);
    t.update(txRef, {
      ...totals,
      [REVERSAL_FIELDS.clawbackTargetTokens]: target,
      [REVERSAL_FIELDS.clawedBackTokens]: priorApplied + out.appliedTokens,
      [REVERSAL_FIELDS.clawbackShortfallTokens]: priorShortfall + out.shortfallTokens,
    });
    return { status: 'clawed-back', targetTokens: target, appliedTokens: out.appliedTokens, shortfallTokens: out.shortfallTokens };
  });
}

/**
 * The whole Cashfree reversal: re-read the gateway, then apply. Used by the signed webhook.
 *
 * `retry: true` means the webhook should answer non-2xx so Cashfree delivers it again: the listing the
 * EVENT is about could not be read, and acknowledging it would lose the reversal.
 */
export async function settleCashfreeReversal(
  db: any,
  orderId: string,
  event: 'refund' | 'dispute',
): Promise<{ ok: true; result: ReversalResult } | { ok: false; retry: boolean; error: string }> {
  const read = await readCashfreeReversals(orderId);
  const needed = event === 'refund' ? read.refundedInr : read.disputeLostInr;
  if (needed === null) {
    return { ok: false, retry: true, error: `Could not read the ${event === 'refund' ? 'refunds' : 'disputes'} for this order (${read.errors.join('; ')})` };
  }
  if (read.errors.length) {
    // The OTHER listing failed. What was read is still applied — totals only grow, so a missing figure
    // can only under-take for now, and the next event re-reads both.
    console.warn(`[REVERSAL] ${orderId}: partial read — ${read.errors.join('; ')}`);
  }
  const result = await applyOrderReversal(db, { orderId, refundedInr: read.refundedInr, disputeLostInr: read.disputeLostInr });
  return { ok: true, result };
}
