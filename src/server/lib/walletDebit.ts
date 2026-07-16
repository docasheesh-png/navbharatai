import { doc, getDoc, runTransaction } from './serverDb'; // admin-SDK binding (bypasses rules) — see serverDb.ts
import { inrToDebitTokens } from './payments';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';

// BILLING PHASE 1 (admin plan 2026-07-10) — the missing HALF of the money path.
//
// Before this module, `user_token_wallets` was only ever CREDITED (purchase / welcome bonus /
// promo). A v3.0 build recorded its cost to the display-only monthly total (UserCostStore) and
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

/** Oldest ledger entries roll off past this bound (doc-size protection; totals are unaffected). */
export const MAX_WALLET_LEDGER_ENTRIES = 500;

export interface WalletDebitTx {
  /** The customer-facing ₹ amount to debit (billedUsd × USD→INR rate). */
  billedInr: number;
  /** Unique per build (e.g. `${workspaceId}_${buildStartedAt}`) — the idempotency key. */
  buildRef: string;
  /** Human-readable ledger line, shown in the wallet history. */
  description: string;
}

export interface DebitedWallet {
  wallet: Record<string, any>;
  /** Whole tokens removed from the balance (billedInr × TOKENS_PER_RUPEE, rounded UP — see inrToDebitTokens). */
  tokensDebited: number;
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
export function computeDebitedWallet(
  current: Record<string, any>,
  tx: WalletDebitTx,
  now: string,
): DebitedWallet {
  const w = current || {};
  const n = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (!Number.isFinite(tx.billedInr) || tx.billedInr <= 0) {
    return { wallet: w, tokensDebited: 0 };
  }
  const ledger: any[] = Array.isArray(w.walletLedger) ? w.walletLedger : [];
  if (tx.buildRef && ledger.some((e) => e && e.buildRef === tx.buildRef)) {
    return { wallet: w, tokensDebited: 0 }; // this build already charged — idempotent no-op
  }

  const billedInr = Math.round(tx.billedInr * 100) / 100; // ₹ to the paisa — no float drift
  // Debit rounds UP (margin protection): a fractional token of build cost is charged as a whole token.
  const tokens = inrToDebitTokens(tx.billedInr);

  const ledgerEntry = {
    type: 'usage',
    amountCoinsOrTokens: -tokens,
    moneySpent: 0,
    timestamp: now,
    description: `${tx.description} — ${tokens.toLocaleString()} tokens (₹${billedInr.toFixed(2)})`,
    buildRef: tx.buildRef,
  };
  const nextLedger = [...ledger, ledgerEntry].slice(-MAX_WALLET_LEDGER_ENTRIES);

  const wallet: Record<string, any> = {
    ...w,
    tokenBalance: n(w.tokenBalance) - tokens,
    totalTokensUsed: n(w.totalTokensUsed) + tokens,
    remaining_balance: Math.round((n(w.remaining_balance) - billedInr) * 100) / 100,
    walletLedger: nextLedger,
    updatedAt: now,
  };
  return { wallet, tokensDebited: tokens };
}

export type WalletDebitResult =
  | { ok: true; tokensDebited: number; tokenBalance: number }
  | { ok: false; error: string };

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
    // No-op unless WALLET_MERGE_RESOLVE=on. Best-effort: on any resolver error we debit the raw uid.
    let ownerId = userId;
    if (walletMergeResolveEnabled()) {
      ownerId = await resolveCanonicalWalletId(async (u) => {
        const s = await getDoc(doc(db, 'user_token_wallets', u));
        return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
      }, userId).catch(() => userId);
    }
    const walletRef = doc(db, 'user_token_wallets', ownerId);
    const debited = await runTransaction(db, async (t: any) => {
      const snap = await t.get(walletRef);
      const current = snap.exists() ? snap.data() : { userId, tokenBalance: 0, totalTokensUsed: 0, remaining_balance: 0, walletLedger: [] };
      const result = computeDebitedWallet(current, tx, new Date().toISOString());
      if (result.tokensDebited > 0) t.set(walletRef, result.wallet);
      return result;
    });
    return {
      ok: true,
      tokensDebited: debited.tokensDebited,
      tokenBalance: typeof debited.wallet.tokenBalance === 'number' ? debited.wallet.tokenBalance : 0,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Wallet debit transaction failed' };
  }
}
