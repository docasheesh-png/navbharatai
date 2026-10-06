// A REFUND OR A CHARGEBACK TAKES BACK THE TOKENS THAT PAYMENT BOUGHT — the pure half (Q-614).
//
// Admin decision, 2026-10-05, option (a): *"a refund or chargeback debits the tokens that payment
// bought, down to zero and never below."*
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// Before it, nothing handled a reversal at all. The Cashfree webhook treated every signed event as
// "fulfil this order", `purchaseLedger.ts` said in capitals that refunds were recorded nowhere, and a
// refunded or charged-back payment simply kept its tokens: the customer had their money back AND the
// credit it bought. The store rails only looked at refund state at the moment of the first verify.
//
// ── THE RULES THIS MODULE ENFORCES ───────────────────────────────────────────────────────────────
//   1. PROPORTIONAL. A refund of ₹R on an order that paid ₹P removes `credited × R/P` tokens, where
//      `credited` is what that order put in (`orderCreditedTokens` — the credit's own formula). A full
//      refund removes all of it; it can never remove more (the target is capped at `credited`).
//   2. DOWN TO ZERO, NEVER BELOW. The wallet gives up what it holds, up to the target, and no more. A
//      user who already spent the tokens is not put into debt by a refund; the part that could not be
//      taken is recorded as `clawbackShortfallTokens` on the order, for the admin, and named on the
//      user's own statement line rather than hidden.
//   3. MONOTONIC AND IDEMPOTENT. The order remembers the target it has already applied
//      (`clawbackTargetTokens`); each event applies only `newTarget − appliedTarget`, and a negative
//      delta does nothing. So a retried webhook never double-debits, two events for the same refund
//      take it once, and nothing here ever CREDITS a wallet back. The reversed totals themselves are
//      kept as the maximum ever seen, so one failed read can never shrink them.
//   4. AMOUNTS COME FROM THE GATEWAY'S OWN API, NEVER FROM THE WEBHOOK BODY. The parsers below read
//      Cashfree's refunds and disputes listings; the signed body only tells us WHICH order to re-read.
//
// PURE. No Firestore, no network, no clock. The I/O half is `paymentReversalStore.ts`.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { mirroredCreditPatch } from './walletMirror';
import { appendLedgerEntry, LEDGER_OPENING_FIELD, LEDGER_DROPPED_FIELD } from './walletStatement';

/** Fields a reversal writes on its `payment_transactions` document. Named once, read everywhere. */
export const REVERSAL_FIELDS = {
  /** ₹ refunded with status SUCCESS, as the gateway last reported it (max ever seen). */
  refundedInr: 'refundedInr',
  /** ₹ of disputes / chargebacks the merchant LOST or ACCEPTED (max ever seen). */
  disputeLostInr: 'disputeLostInr',
  /** Tokens the reversals so far entitle us to take back — the idempotency marker. */
  clawbackTargetTokens: 'clawbackTargetTokens',
  /** Tokens actually removed from a wallet (≤ target: never below zero). */
  clawedBackTokens: 'clawedBackTokens',
  /** Tokens the target asked for that the wallet no longer held. */
  clawbackShortfallTokens: 'clawbackShortfallTokens',
} as const;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function money(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

// ── 1. Classifying a signed Cashfree webhook ─────────────────────────────────────────────────────

export type CashfreeWebhookKind = 'payment' | 'refund' | 'dispute';

/**
 * What a signed Cashfree webhook is about.
 *
 * ASSUMPTION (Cashfree PG webhooks, API version 2023-08-01), written defensively: the event name is in
 * `type` — `PAYMENT_SUCCESS_WEBHOOK` / `PAYMENT_FAILED_WEBHOOK` / `PAYMENT_USER_DROPPED_WEBHOOK` for
 * payments, `REFUND_STATUS_WEBHOOK` / `AUTO_REFUND_STATUS_WEBHOOK` for refunds, `DISPUTE_CREATED` /
 * `DISPUTE_UPDATED` / `DISPUTE_CLOSED` for disputes and chargebacks. Matching is by SUBSTRING, so a
 * renamed or new refund/dispute event still lands on the reversal path rather than falling through to
 * "fulfil this order" — the one outcome that must never happen to a refund. A body with no `type`
 * that carries a `data.refund` or `data.dispute` object is classified by that object, for the same reason.
 * Everything else is a payment event and keeps the path it always had.
 */
export function classifyCashfreeWebhook(body: unknown): CashfreeWebhookKind {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const type = String(b.type ?? b.event ?? '').toUpperCase();
  if (type.includes('REFUND')) return 'refund';
  if (type.includes('DISPUTE') || type.includes('CHARGEBACK')) return 'dispute';
  const data = (b.data && typeof b.data === 'object' ? b.data : {}) as Record<string, any>;
  if (!type) {
    if (data.refund && typeof data.refund === 'object') return 'refund';
    if (data.dispute && typeof data.dispute === 'object') return 'dispute';
  }
  return 'payment';
}

/**
 * The order id a Cashfree webhook names.
 *
 * ASSUMPTION: payment events carry `data.order.order_id`; refund events `data.refund.order_id`; dispute
 * events `data.order_details.order_id` (some payloads nest it under `data.dispute`). Only a non-empty
 * string of at most 128 characters is accepted — the same bound `verify-payment` applies.
 */
export function cashfreeWebhookOrderId(body: unknown): string | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const d = (b.data && typeof b.data === 'object' ? b.data : {}) as Record<string, any>;
  const candidates = [
    d.order?.order_id,
    d.refund?.order_id,
    d.order_details?.order_id,
    d.dispute?.order_details?.order_id,
    d.dispute?.order_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c.length <= 128) return c.trim();
  }
  return null;
}

// ── 2. Reading the gateway's authoritative answer ────────────────────────────────────────────────

/** A listing response as an array, whatever envelope it arrived in. */
function listOf(body: unknown, keys: string[]): Record<string, any>[] {
  if (Array.isArray(body)) return body.filter((x) => x && typeof x === 'object');
  if (body && typeof body === 'object') {
    for (const k of keys) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Record<string, any>[];
    }
  }
  return [];
}

/**
 * ₹ actually refunded on an order, from Cashfree's `GET /pg/orders/{order_id}/refunds`.
 *
 * ASSUMPTION (2023-08-01): the response is an ARRAY of refund entities, each with `refund_amount`
 * (number, ₹), `refund_status` (`SUCCESS` | `PENDING` | `CANCELLED` | `ONHOLD`), `order_id`, and an id
 * (`cf_refund_id` / `refund_id`). An envelope (`{ refunds: [...] }` or `{ data: [...] }`) is accepted
 * too. ONLY `SUCCESS` counts — a pending refund has not moved money yet and may still be cancelled.
 * A row naming a DIFFERENT order is ignored, and duplicate ids are counted once.
 */
export function sumSuccessfulRefundsInr(body: unknown, orderId: string): number {
  const seen = new Set<string>();
  let total = 0;
  for (const r of listOf(body, ['refunds', 'data'])) {
    if (String(r.refund_status ?? '').toUpperCase() !== 'SUCCESS') continue;
    if (typeof r.order_id === 'string' && r.order_id && r.order_id !== orderId) continue;
    const id = String(r.cf_refund_id ?? r.refund_id ?? '');
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    total += money(r.refund_amount);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Is this dispute status one where the money went back to the customer?
 *
 * ASSUMPTION: Cashfree's dispute statuses end in `_MERCHANT_LOST` or `_MERCHANT_ACCEPTED` when the
 * merchant lost or accepted it (`DISPUTE_MERCHANT_LOST`, `CHARGEBACK_MERCHANT_ACCEPTED`,
 * `PRE_ARBITRATION_MERCHANT_LOST`, …). Everything else — created, docs received, under review, merchant
 * WON — leaves the money with us and takes nothing back. Precision first: a false clawback takes a
 * customer's credit for a dispute we went on to win, which is worse than a late one.
 */
export function isLostDisputeStatus(status: unknown): boolean {
  return /_MERCHANT_(LOST|ACCEPTED)$/.test(String(status ?? '').toUpperCase());
}

/**
 * ₹ of disputes/chargebacks lost or accepted on an order, from Cashfree's
 * `GET /pg/orders/{order_id}/disputes`.
 *
 * ASSUMPTION (2023-08-01): an ARRAY of dispute entities with `dispute_id`, `dispute_amount` (₹),
 * `dispute_status`, and the order under `order_details.order_id` (or `order_id`). Envelopes accepted.
 */
export function sumLostDisputesInr(body: unknown, orderId: string): number {
  const seen = new Set<string>();
  let total = 0;
  for (const d of listOf(body, ['disputes', 'data'])) {
    if (!isLostDisputeStatus(d.dispute_status)) continue;
    const named = d.order_details?.order_id ?? d.order_id;
    if (typeof named === 'string' && named && named !== orderId) continue;
    const id = String(d.dispute_id ?? d.cf_dispute_id ?? '');
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    total += money(d.dispute_amount);
  }
  return Math.round(total * 100) / 100;
}

// ── 3. The clawback arithmetic ───────────────────────────────────────────────────────────────────

/**
 * The ₹ basis a reversal is measured against: what the customer actually paid on THIS rail.
 *
 * Cashfree: `amountPaid` (the gross charged, reconciled against Cashfree at credit time). A Play or App
 * Store row records `amountPaid` as the CREDIT and the store's list price as `storePriceInr`, and a store
 * refund returns the store price — so that is the basis there.
 */
export function reversalPaidBasisInr(tx: Record<string, unknown>): number {
  const provider = String(tx.paymentProvider ?? '').toUpperCase();
  if (provider === 'GOOGLE_PLAY' || provider === 'APPLE_IAP') {
    const store = money(tx.storePriceInr);
    if (store > 0) return store;
  }
  return money(tx.amountPaid);
}

/** Total ₹ reversed on an order, from the totals recorded on it, capped at what was paid. */
export function recordedReversedInr(tx: Record<string, unknown>): number {
  const paid = reversalPaidBasisInr(tx);
  const reversed = money(tx[REVERSAL_FIELDS.refundedInr]) + money(tx[REVERSAL_FIELDS.disputeLostInr]);
  return Math.round(Math.min(paid, reversed) * 100) / 100;
}

/**
 * The tokens a reversal entitles us to take back: `credited × reversed/paid`, capped at `credited`.
 * Zero for anything non-finite, non-positive, or an order that credited nothing.
 */
export function clawbackTargetTokens(creditedTokens: number, paidInr: number, reversedInr: number): number {
  const credited = Math.max(0, Math.floor(num(creditedTokens)));
  const paid = num(paidInr);
  const reversed = num(reversedInr);
  if (credited <= 0 || paid <= 0 || reversed <= 0) return 0;
  const fraction = Math.min(1, reversed / paid);
  return Math.min(credited, Math.round(credited * fraction));
}

/**
 * The part of the target not yet applied. Never negative: a target that fell (a read that saw less)
 * applies nothing, and nothing here ever gives tokens back.
 */
export function clawbackDeltaTokens(targetTokens: number, alreadyAppliedTarget: unknown): number {
  return Math.max(0, Math.floor(num(targetTokens)) - Math.floor(num(alreadyAppliedTarget)));
}

export interface ClawbackInput {
  /** Tokens to take back on this event (a DELTA — see `clawbackDeltaTokens`). */
  tokens: number;
  /** ₹ newly reversed by this event, for the statement line. */
  reversedInr: number;
  kind: 'refund' | 'chargeback';
  /** Our order / transaction id, stamped on the ledger row for traceability. */
  reversalRef: string;
  /** Extra words for the statement line, e.g. "gift code purchase". */
  what?: string;
  /**
   * Why the payment was reversed, in plain words, for the statement line — e.g. the store's own reason
   * for a voided purchase ("accidental purchase; requested by you"). Shown in brackets after the label.
   */
  note?: string;
}

export interface ClawbackOutcome {
  wallet: Record<string, any>;
  /** Tokens actually removed. */
  appliedTokens: number;
  /** Tokens asked for that the wallet no longer held — forgiven, never owed (the admin's "never below"). */
  shortfallTokens: number;
}

/**
 * PURE: the wallet after taking back `tokens`, down to zero and never below.
 *
 * Both views move together through `mirroredCreditPatch` (the one wallet writer rule — CLAUDE.md:
 * "any new wallet writer must go through walletMirror.ts"), by EXACTLY the tokens that can be taken:
 * `min(requested, max(0, tokenBalance))`. A wallet already at or below zero (build overdraft) gives up
 * nothing — the refund never deepens a debt, and it never touches the overdraft either.
 *
 * The statement ALWAYS gets a "Refund" line when anything was owed, even if nothing could be taken,
 * through the shared appender, so `opening + Σ rows = balance` holds and the user can see why their
 * balance moved (or why it did not).
 *
 * `totalTokensPurchased` / `totalMoneySpent` / `total_balance` are history ("what was ever bought /
 * paid / credited") and are left alone, as `walletMirror` already does for every deduction.
 */
export function computeClawedBackWallet(
  current: Record<string, any> | null | undefined,
  input: ClawbackInput,
  now: string,
): ClawbackOutcome {
  const w = current || {};
  const requested = Math.max(0, Math.floor(num(input.tokens)));
  if (requested <= 0) return { wallet: { ...w }, appliedTokens: 0, shortfallTokens: 0 };

  const held = num(w.tokenBalance);
  const applied = Math.min(requested, Math.max(0, Math.floor(held)));
  const shortfall = requested - applied;

  const patch = applied > 0 ? mirroredCreditPatch(w, -applied, 'paid') : null;

  const label = input.kind === 'chargeback' ? 'Chargeback' : 'Refund';
  const inr = Math.round(num(input.reversedInr) * 100) / 100;
  const subject = (input.what ? ` of your ${input.what}` : '') + (input.note ? ` (${input.note})` : '');
  const removed = applied > 0
    ? `${applied.toLocaleString()} tokens (₹${(applied / TOKENS_PER_RUPEE).toFixed(2)}) removed`
    : 'no tokens removed';
  const unspent = shortfall > 0
    ? ` — ${shortfall.toLocaleString()} tokens it bought had already been used, and are not charged to you`
    : '';
  const ledgerEntry = {
    type: 'refund',
    amountCoinsOrTokens: -applied,
    moneySpent: 0,
    timestamp: now,
    description: `${label}${subject}: ₹${inr.toFixed(2)} returned to your payment method — ${removed}${unspent}`,
    reversalRef: input.reversalRef,
    ...(shortfall > 0 ? { shortfallTokens: shortfall } : {}),
  };
  const appended = appendLedgerEntry(w, ledgerEntry);

  return {
    wallet: {
      ...w,
      ...(patch ?? {}),
      walletLedger: appended.ledger,
      [LEDGER_OPENING_FIELD]: appended.openingTokens,
      [LEDGER_DROPPED_FIELD]: appended.droppedCount,
      updatedAt: now,
    },
    appliedTokens: applied,
    shortfallTokens: shortfall,
  };
}

/**
 * A reversal recorded on an order BEFORE its credit ran (the refund webhook arrived while the order was
 * still PENDING here), applied in the SAME transaction as the credit.
 *
 * Without it, crediting such an order later (the reconcile sweep, the buyer's own check) would add the
 * full amount and nothing would ever take it back — the refund event had already been handled.
 * Returns the wallet after the clawback and the order fields to write with it; `null` when nothing was
 * recorded or owed.
 */
export function settleRecordedReversalAtCredit(
  creditedWallet: Record<string, any>,
  tx: Record<string, unknown>,
  creditedTokens: number,
  orderId: string,
  now: string,
): { wallet: Record<string, any>; txPatch: Record<string, number> } | null {
  const reversed = recordedReversedInr(tx);
  if (reversed <= 0) return null;
  const target = clawbackTargetTokens(creditedTokens, reversalPaidBasisInr(tx), reversed);
  const delta = clawbackDeltaTokens(target, tx[REVERSAL_FIELDS.clawbackTargetTokens]);
  if (delta <= 0) return null;
  const out = computeClawedBackWallet(creditedWallet, {
    tokens: delta,
    reversedInr: reversed,
    kind: money(tx[REVERSAL_FIELDS.disputeLostInr]) > 0 && money(tx[REVERSAL_FIELDS.refundedInr]) <= 0 ? 'chargeback' : 'refund',
    reversalRef: orderId,
  }, now);
  return {
    wallet: out.wallet,
    txPatch: {
      [REVERSAL_FIELDS.clawbackTargetTokens]: target,
      [REVERSAL_FIELDS.clawedBackTokens]: num(tx[REVERSAL_FIELDS.clawedBackTokens]) + out.appliedTokens,
      [REVERSAL_FIELDS.clawbackShortfallTokens]: num(tx[REVERSAL_FIELDS.clawbackShortfallTokens]) + out.shortfallTokens,
    },
  };
}
