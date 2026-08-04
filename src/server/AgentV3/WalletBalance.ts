// AgentV3 — server-side WALLET BALANCE reader for the paid-public v5.0 gate (admin plan 2026-07-06).
//
// Reads a user's remaining ₹ balance so the affordability gate can compare it against a build's
// pre-flight estimate. The wallet is the same Firestore doc the wallet routes use:
//   collection `user_token_wallets`, doc id = userId, field `remaining_balance` (₹, number).
//
// TWO layers, so the decision logic is pure + unit-tested and the Firestore binding is thin:
//   • readWalletBalanceInr(read, userId) — PURE over an injected reader. Returns a number, or `null`
//     when the balance CANNOT be determined (no reader result, missing doc, non-numeric field, or the
//     read threw). `null` is the honest "unknown" signal — the gate treats it as FAIL-OPEN (proceed),
//     so a Firestore blip or a brand-new user (wallet not yet materialized) never wrongly blocks a build.
//   • firestoreWalletReader(db) — binds the pure reader to the shared Firestore handle (may be null when
//     Firebase isn't configured → reader yields null → unknown → proceed).

import { doc, getDoc, type Firestore } from '../lib/serverDb'; // admin-SDK binding — reads the owner-only wallet doc
import { TOKENS_PER_RUPEE } from '../lib/payments';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from '../lib/walletResolve';

/** Minimal shape we read off the wallet doc. `remaining_balance` is ₹; `tokenBalance` is the token mirror. */
export interface WalletDocData {
  remaining_balance?: unknown;
  /** Token balance (the wallet's primary unit). Used as the ₹-balance fallback when remaining_balance is absent. */
  tokenBalance?: unknown;
  /** Total ₹ ever spent buying tokens — used by free-tier routing to tell a paying user from a new one. */
  totalMoneySpent?: unknown;
}

/** Fetch the raw wallet doc for a user, or null if it doesn't exist / can't be fetched. Injected → testable. */
export type WalletReader = (userId: string) => Promise<WalletDocData | null>;

/**
 * The user's remaining ₹ balance, or `null` when it cannot be determined (unknown → the gate proceeds).
 * Pure over the injected reader: never throws — a reader error is swallowed into `null` (fail-open), and a
 * missing/non-finite `remaining_balance` is also `null`. A real numeric balance (including a negative one,
 * within the overdraft tolerance) passes straight through.
 */
export async function readWalletBalanceInr(read: WalletReader, userId: string): Promise<number | null> {
  if (!userId) return null;
  let data: WalletDocData | null;
  try {
    data = await read(userId);
  } catch {
    return null; // Firestore error → unknown → fail-open (never block a build on infra failure).
  }
  if (!data) return null; // no wallet doc at all → unknown → fail-open (brand-new user / infra blip).
  const bal = data.remaining_balance;
  const tok = data.tokenBalance;
  const balNum = typeof bal === 'number' && Number.isFinite(bal) ? bal : null;
  const tokInr = typeof tok === 'number' && Number.isFinite(tok) && TOKENS_PER_RUPEE > 0 ? tok / TOKENS_PER_RUPEE : null;
  // UNIFIED balance (GIFT-TOKEN bug, admin 2026-08-03: "₹0 + 50,000 tokens → app building off"). The wallet
  // has TWO views of the same value — `remaining_balance` (₹) and `tokenBalance` — and the admin gift path
  // bumped ONLY tokenBalance, leaving remaining_balance at 0. Reading ₹ ALONE (the old `if (bal) return bal`)
  // therefore returned 0 and the gate blocked a user holding 50,000 gifted tokens. Judge the SPENDABLE value:
  // if EITHER field shows money, the user can build → take the higher of the two when both exist. This never
  // wrongly blocks (a positive token balance now counts) and never wrongly passes a truly-empty wallet
  // (both 0 → 0). The gift path is also fixed at the source (admin.ts) to keep the ₹ mirror in sync; this is
  // the defense-in-depth so ANY future drift can't strand a user's real balance.
  // FALLBACK (money-bleed fix, admin 2026-07-12): a doc with NEITHER numeric field stays null (→ fail-open).
  if (balNum != null && tokInr != null) return Math.max(balNum, tokInr);
  if (balNum != null) return balNum; // ₹ present, no token mirror → ₹ as-is (preserves negative overdraft read)
  if (tokInr != null) return tokInr; // token-only wallet → derived ₹
  return null;
}

/**
 * Bind readWalletBalanceInr to the shared Firestore handle. A null handle (Firebase not configured) yields
 * a reader that always returns null → the gate proceeds. Reads the SAME doc path as the wallet routes.
 */
export function firestoreWalletReader(db: Firestore | null): WalletReader {
  return async (userId: string): Promise<WalletDocData | null> => {
    if (!db) return null;
    // One-wallet: read the CANONICAL wallet's balance if this account was merged into another, so the
    // affordability gate judges the unified balance (matches the wallet-read + debit resolution). No-op
    // unless WALLET_MERGE_RESOLVE=on; a resolver error falls back to the raw uid (fail-open, never blocks).
    let ownerId = userId;
    if (walletMergeResolveEnabled()) {
      ownerId = await resolveCanonicalWalletId(async (u) => {
        const s = await getDoc(doc(db as any, 'user_token_wallets', u));
        return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
      }, userId).catch(() => userId);
    }
    const snap = await getDoc(doc(db as any, 'user_token_wallets', ownerId));
    return snap.exists() ? (snap.data() as WalletDocData) : null;
  };
}
