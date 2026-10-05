import { doc, getDoc, runTransaction } from './serverDb'; // admin-SDK binding (bypasses rules) — see serverDb.ts
import { inrToDebitTokens, TOKENS_PER_RUPEE } from './payments';
import { giftAfterSpend, giftRemaining } from './giftSpend';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';

// BILLING PHASE 1 (admin plan 2026-07-10) — the missing HALF of the money path.
//
// Before this module, `user_token_wallets` was only ever CREDITED (purchase / welcome bonus /
// promo). A v5.0 build recorded its cost to the display-only monthly total (UserCostStore) and
// to telemetry, but NEVER decremented the wallet — so the pre-flight affordability gate compared
// estimates against a balance that never went down: one recharge was effectively unlimited builds.
//
// This module is the DEBIT mirror of `computeCreditedWallet` (payments.ts): the same wallet doc,
// the same token unit, the same pure-compute + Firestore-transaction split, the same accumulate-
// on-retry contract. Tokens leave at the SAME rate purchases mint them (TOKENS_PER_RUPEE), so
// the wallet stays one honest unit end to end: ₹ in → tokens minted → tokens burned per build.
//
// Design rules:
//   • OVERDRAFT IS ALLOWED (balance may go negative). The pre-flight gate is deliberately
//     fail-open (WalletBalance.ts) and a build that was allowed to start always runs to
//     completion — so the tail of a build can legitimately exceed the remaining balance. The
//     debt is recorded honestly; the NEXT pre-flight gate then blocks until a recharge.
//   • IDEMPOTENT per build: a `buildRef` is stamped on the ledger entry and re-checked inside
//     the transaction, so an accidental double call for the same build can never double-charge.
//   • The ledger is BOUNDED (builds are frequent, unlike purchases; an unbounded array would
//     eventually overflow the 1 MiB Firestore doc limit). Balances/totals are never trimmed —
//     only the oldest ledger ENTRIES roll off.
//   • Never throws. A failed debit returns { ok: false } so the caller can log it loudly —
//     a money-path failure must never be silently swallowed, but must also never block the
//     user's build result.

import type { WalletFeature } from './walletFeature';
import { clampChargeToFloor, overdraftFloorInr, DEFAULT_OVERDRAFT_FLOOR_INR } from './walletFloor';
import {
  appendLedgerEntry, LEDGER_OPENING_FIELD, LEDGER_OPENING_AT_FIELD, LEDGER_DROPPED_FIELD,
  MAX_WALLET_LEDGER_ENTRIES, TOKEN_CARRY_FIELD,
} from './walletStatement';

/**
 * Re-exported from `walletStatement.ts`, which owns them now — see the note there. Kept exported
 * from here so every existing importer is unchanged.
 */
export { MAX_WALLET_LEDGER_ENTRIES, TOKEN_CARRY_FIELD } from './walletStatement';

export interface WalletDebitTx {
  /**
   * WHICH FEATURE took this money (admin 2026-09-13).
   *
   * Optional only so a row written before this existed stays readable; every live caller passes one,
   * and `spendByFeature` reports an untagged row as UNATTRIBUTED rather than guessing a feature for
   * it — see `walletFeature.ts`.
   */
  feature?: WalletFeature;
  /**
   * How far below zero this wallet may go, in ₹.
   *
   * 🔒 DEFAULTED INSIDE the debit, never left open. A caller that forgets it gets the built-in floor
   * rather than unlimited debt — the failure being fixed here IS a debit with no bound, so "unset"
   * must not be the one input that restores it.
   */
  floorInr?: number;
  /** The customer-facing ₹ amount to debit (billedUsd × USD→INR rate). */
  billedInr: number;
  /** Unique per build (e.g. `${workspaceId}_${buildStartedAt}`) — the idempotency key. */
  buildRef: string;
  /** Human-readable ledger line, shown in the wallet history. */
  description: string;
  /**
   * Whose money this charge comes out of (see `giftSpend.ts`).
   *
   * `gift-first` (the default, and what every build and chat turn uses) spends the welcome gift
   * before the user's own money. `paid-only` is for a PLAN, which the gift may not buy — the balance
   * still falls, but the gift figure is left alone, because the rupees that moved were paid ones.
   *
   * ⚠️ The CALLER must have already established that enough paid money exists (`checkPlanPayable`).
   * This field records which bucket the money came from; it is not itself the gate.
   */
  spends?: 'gift-first' | 'paid-only';
}

export interface DebitedWallet {
  wallet: Record<string, any>;
  /** Whole tokens removed from the balance. The sub-token remainder is carried, not rounded away. */
  tokensDebited: number;
  /**
   * True when this call actually applied the charge (so the caller must persist the wallet). A charge
   * smaller than one whole token debits 0 tokens but still moves the carry, so `tokensDebited > 0` is
   * NOT a safe test for "did anything change".
   */
  applied: boolean;
  /**
   * True when an ALL-OR-NOTHING charge (`allOrNothing`) was refused because the balance could not cover
   * it in full. Nothing was applied. Only a hold can see this; an ordinary debit clamps instead.
   */
  refused?: boolean;
}

/**
 * PURE debit computation: given the CURRENT wallet doc and a build's billed ₹, return the FULL
 * new wallet doc after debiting. No I/O. Exactly like computeCreditedWallet, the caller runs
 * read→compute→write INSIDE a Firestore transaction that re-reads `current` in-transaction, so a
 * concurrent credit (recharge mid-build) can't lost-update: on a concurrent commit the transaction
 * retries, re-reads the fresh balance, and re-applies this delta on top. Every field change is
 * `(current field) ± delta`, so accumulation is correct on retry. Tested.
 *
 * A non-finite or non-positive `billedInr`, or a `buildRef` already present in the ledger
 * (idempotency), returns the wallet UNCHANGED with tokensDebited 0.
 */

/**
 * Apply the overdraft floor to one charge, in ₹, against the balance the TOKEN column reports.
 *
 * Tokens, not `remaining_balance`: tokens are the unit the balance is actually kept in, so a floor
 * measured against them can never disagree with the number the gates read.
 */
function floorCharge(w: Record<string, any>, billedInr: number, floorInr: number | undefined) {
  const bal = typeof w.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance : 0;
  return clampChargeToFloor({
    balanceInr: bal / TOKENS_PER_RUPEE,
    billedInr,
    floorInr: Number.isFinite(floorInr as number) ? (floorInr as number) : DEFAULT_OVERDRAFT_FLOOR_INR,
  });
}

export function computeDebitedWallet(
  current: Record<string, any>,
  tx: WalletDebitTx,
  now: string,
): DebitedWallet {
  const w = current || {};
  const n = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (!Number.isFinite(tx.billedInr) || tx.billedInr <= 0) {
    return { wallet: w, tokensDebited: 0, applied: false };
  }
  const ledger: any[] = Array.isArray(w.walletLedger) ? w.walletLedger : [];
  if (tx.buildRef && ledger.some((e) => e && e.buildRef === tx.buildRef)) {
    return { wallet: w, tokensDebited: 0, applied: false }; // this build already charged — idempotent no-op
  }

  // EXACT accounting with a carried remainder. The charge is converted to a possibly-fractional token
  // amount, added to whatever fraction of a token the user's last charge left unbilled, and only the
  // WHOLE tokens are debited now; the rest waits for the next charge.
  //
  // The old code rounded the token debit UP while decrementing `remaining_balance` by the paisa-rounded
  // ₹ — two views of one balance, moving by different amounts, drifting a little further apart on every
  // build (and overcharging the user by up to ₹0.01 each time). Here the ₹ is DERIVED from the tokens
  // actually debited, so the two can never disagree again, and nothing is silently rounded away in
  // either direction: over any number of charges the total billed equals the total owed to the paisa.
  // 🔴 THE FLOOR, APPLIED BEFORE ANYTHING IS CONVERTED TO TOKENS (admin 2026-09-13, on a real account
  // at −₹506 and another at −₹1,198). A build that was legitimately allowed to start at ₹1 used to
  // settle for whatever it had cost, in one debit, with nothing bounding it.
  const floored = floorCharge(w, tx.billedInr, tx.floorInr);
  const carriedIn = Math.min(Math.max(n(w[TOKEN_CARRY_FIELD]), 0), 1); // defensive: 0 ≤ carry < 1
  // ⚠️ The CARRY follows what was actually CHARGED, never what was owed. Carrying the absorbed part
  // would quietly re-bill on the next charge the very rupees we just said we would eat.
  const owed = inrToDebitTokens(floored.chargedInr) + carriedIn;
  const tokens = Math.floor(owed);
  const carryOut = Math.round((owed - tokens) * 1e6) / 1e6; // keep the remainder free of float dust
  const billedInr = Math.round((tokens / TOKENS_PER_RUPEE) * 100) / 100;

  const ledgerEntry = {
    type: 'usage',
    amountCoinsOrTokens: -tokens,
    moneySpent: 0,
    timestamp: now,
    // A charge below one whole token says so plainly rather than showing the user a ₹0.00 line they
    // cannot account for — it really was charged, just on their next one.
    description: tokens > 0
      ? `${tx.description} — ${tokens.toLocaleString()} tokens (₹${billedInr.toFixed(2)})`
      : `${tx.description} — under ₹0.01, carried to your next charge`,
    buildRef: tx.buildRef,
    ...(tx.feature ? { feature: tx.feature } : {}),
    // Our own loss, on the row that caused it — never folded into the user's number.
    ...(floored.absorbedInr > 0 ? { absorbedInr: floored.absorbedInr } : {}),
  };
  // 🔒 THROUGH THE SHARED APPENDER, so whatever rolls off the 500-entry cap lands in the opening
  // balance instead of vanishing. Before this, `[...ledger, entry].slice(-500)` silently broke the
  // one invariant the statement rests on — opening + Σ rows = balance — from the 501st entry onward.
  const appended = appendLedgerEntry(w, ledgerEntry);
  const nextLedger = appended.ledger;

  const nextBalance = n(w.tokenBalance) - tokens;
  // WHOSE MONEY LEFT THE WALLET. Ordinary spending eats the gift first; a plan may not touch it. The
  // figure is clamped to the new balance either way, so it can never claim there is more gift left
  // than there is money — including on a wallet that went negative through build overdraft.
  const nextGift = tx.spends === 'paid-only'
    ? Math.max(0, Math.min(giftRemaining(w), nextBalance))
    : Math.max(0, Math.min(giftAfterSpend(w, tokens), nextBalance));

  const wallet: Record<string, any> = {
    ...w,
    tokenBalance: nextBalance,
    totalTokensUsed: n(w.totalTokensUsed) + tokens,
    remaining_balance: Math.round((n(w.remaining_balance) - billedInr) * 100) / 100,
    [TOKEN_CARRY_FIELD]: carryOut,
    giftTokensRemaining: nextGift,
    walletLedger: nextLedger,
    [LEDGER_OPENING_FIELD]: appended.openingTokens,
    [LEDGER_DROPPED_FIELD]: appended.droppedCount,
    ...(appended.droppedCount > n(w[LEDGER_DROPPED_FIELD]) ? { [LEDGER_OPENING_AT_FIELD]: now } : {}),
    updatedAt: now,
  };
  return { wallet, tokensDebited: tokens, applied: true };
}

export interface WalletRollupTx {
  /** Which feature this bucket belongs to — see WalletDebitTx.feature. */
  feature?: WalletFeature;
  /** How far below zero this wallet may go, in ₹. Defaults to the built-in floor — see below. */
  floorInr?: number;
  /** The customer-facing ₹ amount to debit for this one turn. */
  billedInr: number;
  /** The bucket this turn belongs to, e.g. `ai_2026-08-02`. Turns sharing a ref share ONE ledger row. */
  rollupRef: string;
  /** Ledger text for the bucket, e.g. "AI assistants". No provider names (white-label law). */
  description: string;
  /**
   * ALL OR NOTHING (Q-616, 2026-10-05). Unset, a charge the balance cannot cover is CLAMPED at the floor
   * and the rest absorbed — right for a charge settled after the work, which cannot be un-done. Set, the
   * charge is REFUSED instead (`refused: true`, nothing applied) — right for a price taken BEFORE the work,
   * where refusing costs nobody anything. A hold passes this with `floorInr: 0`, so it never overdraws.
   */
  allOrNothing?: boolean;
  /**
   * Makes this charge a HOLD that can be given back exactly once (`computeRolledUpRelease`). The id is
   * stamped on the bucket row's `openHolds`, which is what makes the release idempotent: a release that
   * finds no matching id has nothing to give back.
   */
  holdId?: string;
}

/**
 * One hold still open on a rollup row. `owed` is the charge in exact (possibly fractional) tokens, which
 * the release gives back to the token; `gift` is how much of it came out of the welcome gift.
 */
export interface OpenHold {
  id: string;
  owed: number;
  gift: number;
}

/**
 * How many open holds one bucket row remembers. A hold lives for one request (about a minute), and the
 * image route is rate-limited far below this per account, so only a hold already settled can roll off.
 */
export const MAX_OPEN_HOLDS = 50;

function openHoldsOf(row: unknown): OpenHold[] {
  const raw = (row as { openHolds?: unknown } | null | undefined)?.openHolds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is OpenHold => !!h && typeof h.id === 'string' && h.id !== ''
    && typeof h.owed === 'number' && Number.isFinite(h.owed) && h.owed >= 0);
}

/**
 * PURE debit for a SMALL, FREQUENT charge — a chat turn, a tool run — that rolls up into one ledger
 * row per bucket instead of writing its own.
 *
 * WHY THIS IS NOT computeDebitedWallet. A build happens a few times a day and deserves its own line.
 * A chat turn happens dozens of times, and one line each would fill the 500-entry ledger in a couple of
 * weeks — pushing the user's PURCHASE history off the end. Someone checking "did my ₹250 arrive?"
 * would find only a wall of ₹0.02 chat charges. So same-bucket turns accumulate into a single row that
 * shows the running total for the day.
 *
 * The other difference follows from that: a matching ref here means ADD to the existing row, whereas
 * for a build it means "already charged, do nothing". A build ref is an idempotency key; a rollup ref
 * is a bucket. They must never be confused, which is why this is a separate function rather than a
 * flag on the other one.
 *
 * Balance math, the carried sub-token remainder and the ₹-derived-from-tokens rule are identical to
 * computeDebitedWallet — the same wallet, the same unit, the same exactness.
 */
export function computeRolledUpDebit(
  current: Record<string, any>,
  tx: WalletRollupTx,
  now: string,
): DebitedWallet {
  const w = current || {};
  const n = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (!Number.isFinite(tx.billedInr) || tx.billedInr <= 0 || !tx.rollupRef) {
    return { wallet: w, tokensDebited: 0, applied: false };
  }

  const ledger: any[] = Array.isArray(w.walletLedger) ? w.walletLedger : [];
  const existingIndex = ledger.findIndex((e) => e && e.rollupRef === tx.rollupRef);
  const existingHolds = existingIndex >= 0 ? openHoldsOf(ledger[existingIndex]) : [];
  // A hold already on the row was already taken: idempotent, exactly like a build ref.
  if (tx.holdId && existingHolds.some((h) => h.id === tx.holdId)) {
    return { wallet: w, tokensDebited: 0, applied: false };
  }

  // The same floor, for the same reason — see computeDebitedWallet. A rollup can cross it just as a
  // build can: many small assistant charges in one day add up exactly like one large one.
  const floored = floorCharge(w, tx.billedInr, tx.floorInr);
  // An all-or-nothing charge is never partly taken: if the floor would bite, nothing moves at all.
  if (tx.allOrNothing && floored.clamped) {
    return { wallet: w, tokensDebited: 0, applied: false, refused: true };
  }
  const carriedIn = Math.min(Math.max(n(w[TOKEN_CARRY_FIELD]), 0), 1);
  const owedForThis = inrToDebitTokens(floored.chargedInr);
  const owed = owedForThis + carriedIn;
  const tokens = Math.floor(owed);
  const carryOut = Math.round((owed - tokens) * 1e6) / 1e6;

  const priorTokens = existingIndex >= 0 ? Math.abs(n(ledger[existingIndex]?.amountCoinsOrTokens)) : 0;
  const bucketTokens = priorTokens + tokens;
  const bucketInr = Math.round((bucketTokens / TOKENS_PER_RUPEE) * 100) / 100;
  const chargeInr = Math.round((tokens / TOKENS_PER_RUPEE) * 100) / 100;

  const rollupBalance = n(w.tokenBalance) - tokens;
  const nextGift = Math.max(0, Math.min(giftAfterSpend(w, tokens), rollupBalance));
  // Open holds ride along on EVERY rewrite of the row, a plain charge included — a row rewritten without
  // them would make an in-flight hold impossible to give back.
  const holds = tx.holdId
    ? [...existingHolds, { id: tx.holdId, owed: owedForThis, gift: Math.max(0, giftRemaining(w) - nextGift) }]
    : existingHolds;

  const row = {
    type: 'usage',
    amountCoinsOrTokens: -bucketTokens,
    moneySpent: 0,
    timestamp: now,
    description: `${tx.description} — ${bucketTokens.toLocaleString()} tokens (₹${bucketInr.toFixed(2)})`,
    rollupRef: tx.rollupRef,
    ...(tx.feature ? { feature: tx.feature } : {}),
    ...(floored.absorbedInr > 0 ? { absorbedInr: floored.absorbedInr } : {}),
    ...(holds.length > 0 ? { openHolds: holds.slice(-MAX_OPEN_HOLDS) } : {}),
  };

  // The updated row moves to the END so the ledger stays in time order and the ledger cap trims the
  // genuinely oldest activity — a bucket still being added to is not old. The shared appender does
  // the replace-and-trim, folding anything that rolls off into the opening balance; the bucket row
  // carries its RUNNING total, so replacing rather than appending is what stops it summing twice.
  const rolled = appendLedgerEntry(w, row, { replaceRollupRef: tx.rollupRef });
  const nextLedger = rolled.ledger;

  const wallet: Record<string, any> = {
    ...w,
    tokenBalance: rollupBalance,
    totalTokensUsed: n(w.totalTokensUsed) + tokens,
    remaining_balance: Math.round((n(w.remaining_balance) - chargeInr) * 100) / 100,
    [TOKEN_CARRY_FIELD]: carryOut,
    // A chat turn is ordinary spending, so it eats the gift first — there is deliberately no
    // `paid-only` option here: a rollup can only ever be assistant usage, never a plan.
    giftTokensRemaining: nextGift,
    walletLedger: nextLedger,
    [LEDGER_OPENING_FIELD]: rolled.openingTokens,
    [LEDGER_DROPPED_FIELD]: rolled.droppedCount,
    ...(rolled.droppedCount > n(w[LEDGER_DROPPED_FIELD]) ? { [LEDGER_OPENING_AT_FIELD]: now } : {}),
    updatedAt: now,
  };
  return { wallet, tokensDebited: tokens, applied: true };
}

export interface WalletReleaseTx {
  /** The bucket the hold was taken into. */
  rollupRef: string;
  /** The hold to give back. */
  holdId: string;
  /** Ledger text for the bucket — the same text the hold used. */
  description: string;
  feature?: WalletFeature;
}

export interface ReleasedWallet {
  wallet: Record<string, any>;
  /** Whole tokens put back on the balance. */
  tokensReturned: number;
  /** False when there was nothing to give back: never held, or already released. */
  applied: boolean;
}

/**
 * PURE: give back ONE hold taken by `computeRolledUpDebit` with a `holdId` (Q-616, 2026-10-05).
 *
 * 🔒 A REVERSAL IN THE SAME BUCKET, NOT A CREDIT. The money never really left: the picture it was held
 * for was not made. So the bucket row's total goes back DOWN by the held amount and the balance comes
 * back UP by the same tokens — the statement still balances (opening + Σ rows = balance), and the user
 * sees one image line for the day carrying only what they actually paid. A credit line instead would
 * show a charge and a refund for a picture that never existed, and `mirroredCreditPatch` is the wrong
 * tool for the same reason: it would raise the lifetime-credited figure for money nobody paid in.
 *
 * Exactly the inverse of the debit, field by field: tokens and ₹ move by the same money (₹ derived
 * from the tokens), `totalTokensUsed` falls back, the gift the hold ate is restored, and the carried
 * sub-token remainder is restored too, so a price that is not a whole number of tokens is returned to
 * the token rather than rounded.
 *
 * IDEMPOTENT: the hold's id is removed from the row as it is given back, so a second release finds
 * nothing and changes nothing. A transaction retry re-reads the row and re-applies the same delta.
 */
export function computeRolledUpRelease(
  current: Record<string, any>,
  tx: WalletReleaseTx,
  now: string,
): ReleasedWallet {
  const w = current || {};
  const n = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const noop: ReleasedWallet = { wallet: w, tokensReturned: 0, applied: false };
  if (!tx.rollupRef || !tx.holdId) return noop;
  const ledger: any[] = Array.isArray(w.walletLedger) ? w.walletLedger : [];
  const row = ledger.find((e) => e && e.rollupRef === tx.rollupRef);
  if (!row) return noop;
  const holds = openHoldsOf(row);
  const hold = holds.find((h) => h.id === tx.holdId);
  if (!hold) return noop;

  // Give back exactly what was owed. The debit took floor(owed + carry) whole tokens and kept the rest
  // as carry; the inverse returns the smallest whole number of tokens that, with the carry, repays it.
  const carriedIn = Math.min(Math.max(n(w[TOKEN_CARRY_FIELD]), 0), 1);
  const tokens = Math.max(0, Math.ceil(hold.owed - carriedIn - 1e-9));
  const carryOut = Math.min(Math.max(Math.round((carriedIn + tokens - hold.owed) * 1e6) / 1e6, 0), 0.999999);

  const priorTokens = Math.abs(n(row.amountCoinsOrTokens));
  const bucketTokens = Math.max(0, priorTokens - tokens);
  const bucketInr = Math.round((bucketTokens / TOKENS_PER_RUPEE) * 100) / 100;
  const returnedInr = Math.round((tokens / TOKENS_PER_RUPEE) * 100) / 100;
  const stillOpen = holds.filter((h) => h.id !== tx.holdId);

  const nextRow = {
    type: 'usage',
    amountCoinsOrTokens: -bucketTokens,
    moneySpent: 0,
    timestamp: now,
    description: `${tx.description} — ${bucketTokens.toLocaleString()} tokens (₹${bucketInr.toFixed(2)})`,
    rollupRef: tx.rollupRef,
    ...(tx.feature ? { feature: tx.feature } : (row.feature ? { feature: row.feature } : {})),
    ...(n(row.absorbedInr) > 0 ? { absorbedInr: row.absorbedInr } : {}),
    ...(stillOpen.length > 0 ? { openHolds: stillOpen } : {}),
  };
  const rolled = appendLedgerEntry(w, nextRow, { replaceRollupRef: tx.rollupRef });

  const nextBalance = n(w.tokenBalance) + tokens;
  const wallet: Record<string, any> = {
    ...w,
    tokenBalance: nextBalance,
    totalTokensUsed: Math.max(0, n(w.totalTokensUsed) - tokens),
    remaining_balance: Math.round((n(w.remaining_balance) + returnedInr) * 100) / 100,
    [TOKEN_CARRY_FIELD]: carryOut,
    giftTokensRemaining: Math.max(0, Math.min(giftRemaining(w) + Math.min(hold.gift, tokens), nextBalance)),
    walletLedger: rolled.ledger,
    [LEDGER_OPENING_FIELD]: rolled.openingTokens,
    [LEDGER_DROPPED_FIELD]: rolled.droppedCount,
    ...(rolled.droppedCount > n(w[LEDGER_DROPPED_FIELD]) ? { [LEDGER_OPENING_AT_FIELD]: now } : {}),
    updatedAt: now,
  };
  return { wallet, tokensReturned: tokens, applied: true };
}

/**
 * PURE: close ONE hold whose work was delivered. The money stays taken; only the hold's id leaves the row,
 * so a later release finds nothing to give back. The row keeps its place — nothing was charged now.
 */
export function computeRolledUpSettle(
  current: Record<string, any>,
  tx: { rollupRef: string; holdId: string },
  now: string,
): { wallet: Record<string, any>; applied: boolean } {
  const w = current || {};
  const ledger: any[] = Array.isArray(w.walletLedger) ? w.walletLedger : [];
  const row = ledger.find((e) => e && e.rollupRef === tx.rollupRef);
  const holds = openHoldsOf(row);
  if (!row || !holds.some((h) => h.id === tx.holdId)) return { wallet: w, applied: false };
  const stillOpen = holds.filter((h) => h.id !== tx.holdId);
  const { openHolds: _closed, ...rest } = row;
  const nextRow = stillOpen.length > 0 ? { ...rest, openHolds: stillOpen } : rest;
  return {
    wallet: { ...w, walletLedger: ledger.map((e) => (e === row ? nextRow : e)), updatedAt: now },
    applied: true,
  };
}

export type WalletDebitResult =
  | { ok: true; tokensDebited: number; tokenBalance: number }
  | { ok: false; error: string };


/**
 * Record one charge against the PLATFORM's per-feature counters (admin 2026-09-13).
 *
 * 🔒 CALLED FROM HERE, THE ONE CHOKE POINT EVERY DEBIT PASSES THROUGH, rather than from each of the
 * nine callers. A counter wired call-by-call is one that a tenth caller silently never joins — and
 * the whole reason the admin could not see where money went is that per-call-site recording had
 * already drifted exactly that way.
 *
 * Dynamically imported so the store's firebase-admin graph never loads for a caller that only wants
 * the pure math, and fire-and-forget because telemetry must never cost a user their result.
 */
function recordFeatureSpend(tx: { feature?: WalletFeature; billedInr?: number }, userId: string): void {
  if (!tx.feature || !(Number(tx.billedInr) > 0)) return;
  void import('./FeatureSpendStore')
    .then((m) => m.featureSpendStore.record(tx.feature as WalletFeature, Number(tx.billedInr), userId))
    .catch(() => { /* telemetry only */ });
}

/**
 * The wallet a charge for `userId` lands on: the CANONICAL one when this account was merged into another
 * (no-op unless WALLET_MERGE_RESOLVE=on). Best-effort: on any resolver error the raw uid is used. One
 * copy, shared by every debit, hold and release, so a hold and its release can never resolve to two
 * different wallets.
 */
async function walletOwnerId(db: any, userId: string): Promise<string> {
  if (!walletMergeResolveEnabled()) return userId;
  return resolveCanonicalWalletId(async (u) => {
    const s = await getDoc(doc(db, 'user_token_wallets', u));
    return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
  }, userId).catch(() => userId);
}

/**
 * Atomically debit a user's wallet for a finished build. Reads + writes the SAME doc the wallet
 * routes and the payment credit path use (`user_token_wallets/{userId}`). A user whose wallet doc
 * doesn't exist yet is debited from a zeroed wallet — the debt is recorded honestly rather than
 * dropped. Never throws; a failure (no db, Firestore error) returns { ok: false, error }.
 */
export async function debitWalletForBuild(
  db: any,
  userId: string,
  tx: WalletDebitTx,
): Promise<WalletDebitResult> {
  if (!db) return { ok: false, error: 'Database not initialized' };
  if (!userId) return { ok: false, error: 'Missing userId' };
  if (!Number.isFinite(tx.billedInr) || tx.billedInr <= 0) {
    return { ok: false, error: `Non-debitable amount: ${tx.billedInr}` };
  }
  try {
    // One-wallet: debit the CANONICAL wallet if this account was merged into another, so a build on a
    // merged/retired account correctly charges the unified balance (matches the wallet-read resolution).
    const ownerId = await walletOwnerId(db, userId);
    const walletRef = doc(db, 'user_token_wallets', ownerId);
    const debited = await runTransaction(db, async (t: any) => {
      const snap = await t.get(walletRef);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      // The env-tunable floor is resolved HERE, in the I/O layer, so the pure function above stays
      // pure and testable while production still gets the configured value.
      const result = computeDebitedWallet(current, { ...tx, floorInr: tx.floorInr ?? overdraftFloorInr() }, new Date().toISOString());
      // `applied`, not `tokensDebited > 0`: a charge under one whole token debits nothing now but
      // moves the carried remainder, and losing that write would quietly forgive the charge.
      if (result.applied) t.set(walletRef, result.wallet);
      return result;
    });
    if (debited.applied) recordFeatureSpend(tx, userId);
    return {
      ok: true,
      tokensDebited: debited.tokensDebited,
      tokenBalance: typeof debited.wallet.tokenBalance === 'number' ? debited.wallet.tokenBalance : 0,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Wallet debit transaction failed' };
  }
}

/**
 * Atomically debit a user's wallet for one SMALL charge, rolled up into a per-bucket ledger row.
 *
 * The same wallet doc, the same transaction discipline and the same canonical-wallet resolution as
 * debitWalletForBuild — this is the small-charge sibling, not a second money path. Never throws.
 *
 * ⚠️ RENAMED from `debitWalletForAiUsage` (2026-09-12) when hosting became its second caller. Nothing
 * about it was ever AI-specific — the bucket and the ledger label are the CALLER's, which is exactly
 * what let hosting reuse it instead of opening a third money path. The old name would have made a
 * daily hosting charge read as an AI charge to whoever next opened this file.
 */
export async function debitWalletRolledUp(
  db: any,
  userId: string,
  tx: WalletRollupTx,
): Promise<WalletDebitResult> {
  if (!db) return { ok: false, error: 'Database not initialized' };
  if (!userId) return { ok: false, error: 'Missing userId' };
  if (!Number.isFinite(tx.billedInr) || tx.billedInr <= 0) {
    return { ok: false, error: `Non-debitable amount: ${tx.billedInr}` };
  }
  try {
    const ownerId = await walletOwnerId(db, userId);
    const walletRef = doc(db, 'user_token_wallets', ownerId);
    const debited = await runTransaction(db, async (t: any) => {
      const snap = await t.get(walletRef);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      const result = computeRolledUpDebit(current, { ...tx, floorInr: tx.floorInr ?? overdraftFloorInr() }, new Date().toISOString());
      if (result.applied) t.set(walletRef, result.wallet);
      return result;
    });
    if (debited.applied) recordFeatureSpend(tx, userId);
    return {
      ok: true,
      tokensDebited: debited.tokensDebited,
      tokenBalance: typeof debited.wallet.tokenBalance === 'number' ? debited.wallet.tokenBalance : 0,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Wallet debit transaction failed' };
  }
}

export type WalletHoldResult =
  | { ok: true; ownerId: string; tokensDebited: number; tokenBalance: number }
  /** The balance cannot cover the full charge. Nothing was taken. `balanceInr` is what it holds. */
  | { ok: false; insufficient: true; balanceInr: number; error: string }
  | { ok: false; insufficient?: false; error: string };

/**
 * TAKE A PRICE BEFORE THE WORK, ALL OR NOTHING (Q-616, 2026-10-05).
 *
 * The image generator used to READ the balance up front and debit after the picture, fire-and-forget,
 * clamped at the overdraft floor. Two pictures started together each saw ₹1 and each was drawn; the
 * second debit then pushed the wallet into overdraft or failed into a log line. A read and a later write
 * are two moments, and every concurrent request fits between them.
 *
 * 🔒 SO THE CHECK AND THE CHARGE ARE ONE TRANSACTION. Firestore serialises two transactions on the same
 * wallet, so the second one sees the first one's debit: with ₹1 in the wallet exactly one hold succeeds
 * and the other is refused with the real balance. `floorInr: 0` + `allOrNothing` means a hold never takes
 * a wallet below zero and is never partly taken.
 *
 * The same rollup bucket, the same ledger appender, the same wallet resolution as every other small
 * charge — this is `debitWalletRolledUp` with two settings, not a second money path. Feature-spend
 * telemetry is NOT recorded here: a hold may still be given back. `settleWalletHold` records it once the
 * work was delivered. Never throws.
 */
export async function holdWalletRolledUp(
  db: any,
  userId: string,
  tx: Omit<WalletRollupTx, 'floorInr' | 'allOrNothing'> & { holdId: string },
): Promise<WalletHoldResult> {
  if (!db) return { ok: false, error: 'Database not initialized' };
  if (!userId) return { ok: false, error: 'Missing userId' };
  if (!tx.holdId) return { ok: false, error: 'Missing holdId' };
  if (!Number.isFinite(tx.billedInr) || tx.billedInr <= 0) {
    return { ok: false, error: `Non-debitable amount: ${tx.billedInr}` };
  }
  try {
    const ownerId = await walletOwnerId(db, userId);
    const walletRef = doc(db, 'user_token_wallets', ownerId);
    const held = await runTransaction(db, async (t: any) => {
      const snap = await t.get(walletRef);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      const result = computeRolledUpDebit(current, { ...tx, floorInr: 0, allOrNothing: true }, new Date().toISOString());
      if (result.applied) t.set(walletRef, result.wallet);
      return result;
    });
    const tokenBalance = typeof held.wallet.tokenBalance === 'number' ? held.wallet.tokenBalance : 0;
    if (held.refused) {
      return { ok: false, insufficient: true, balanceInr: tokenBalance / TOKENS_PER_RUPEE, error: 'Balance does not cover the charge' };
    }
    return { ok: true, ownerId, tokensDebited: held.tokensDebited, tokenBalance };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Wallet hold transaction failed' };
  }
}

/**
 * GIVE A HOLD BACK — the work it was taken for did not happen. One transaction, on the wallet the hold
 * was taken from: `ownerId` from `holdWalletRolledUp` when the caller has it, otherwise resolved from
 * `userId` the same way the hold resolved it. Idempotent (see `computeRolledUpRelease`): calling it
 * twice, or for a hold that was never taken, returns `released: false` and changes nothing. Never throws.
 */
export async function releaseWalletHold(
  db: any,
  userId: string,
  tx: WalletReleaseTx,
  knownOwnerId?: string,
): Promise<{ ok: true; released: boolean; tokensReturned: number } | { ok: false; error: string }> {
  if (!db) return { ok: false, error: 'Database not initialized' };
  if (!userId && !knownOwnerId) return { ok: false, error: 'Missing userId' };
  try {
    const ownerId = knownOwnerId || await walletOwnerId(db, userId);
    const walletRef = doc(db, 'user_token_wallets', ownerId);
    const out = await runTransaction(db, async (t: any) => {
      const snap = await t.get(walletRef);
      if (!snap.exists()) return { applied: false, tokensReturned: 0 };
      const result = computeRolledUpRelease(snap.data(), tx, new Date().toISOString());
      if (result.applied) t.set(walletRef, result.wallet);
      return { applied: result.applied, tokensReturned: result.tokensReturned };
    });
    return { ok: true, released: out.applied, tokensReturned: out.tokensReturned };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Wallet release transaction failed' };
  }
}

/**
 * A hold's work was delivered: the money stays where it is — nothing more is charged, the balance does not
 * move. The hold's id leaves the row's `openHolds` (so the row says truthfully that nothing is in flight,
 * and no later release could give a delivered picture's money back), and the platform's per-feature spend
 * is recorded now — the step `holdWalletRolledUp` deliberately skipped. Never throws.
 */
export async function settleWalletHold(
  db: any,
  userId: string,
  tx: { rollupRef: string; holdId: string; feature?: WalletFeature; billedInr: number },
  knownOwnerId?: string,
): Promise<{ ok: true; settled: boolean } | { ok: false; error: string }> {
  recordFeatureSpend(tx, userId);
  if (!db) return { ok: false, error: 'Database not initialized' };
  try {
    const ownerId = knownOwnerId || await walletOwnerId(db, userId);
    const walletRef = doc(db, 'user_token_wallets', ownerId);
    const settled = await runTransaction(db, async (t: any) => {
      const snap = await t.get(walletRef);
      if (!snap.exists()) return false;
      const result = computeRolledUpSettle(snap.data(), tx, new Date().toISOString());
      if (result.applied) t.set(walletRef, result.wallet);
      return result.applied;
    });
    return { ok: true, settled };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Wallet settle transaction failed' };
  }
}
