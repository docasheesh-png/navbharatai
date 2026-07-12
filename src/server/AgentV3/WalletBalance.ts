// AgentV3 — server-side WALLET BALANCE reader for the paid-public v3.0 gate (admin plan 2026-07-06).
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
  if (typeof bal === 'number' && Number.isFinite(bal)) return bal;
  // FALLBACK (money-bleed fix, admin 2026-07-12): a wallet doc that EXISTS but has no numeric ₹ mirror
  // (only the token balance) must NOT read as "unknown" — that would fail-open and let a 0-balance user
  // build for free. Derive ₹ from the token balance at the shared rate. An existing wallet with 0 tokens
  // is a real ₹0 → the gate blocks it. Only a doc with NEITHER numeric field stays null (→ fail-open).
  const tok = data.tokenBalance;
  if (typeof tok === 'number' && Number.isFinite(tok)) {
    return TOKENS_PER_RUPEE > 0 ? tok / TOKENS_PER_RUPEE : 0;
  }
  return null;
}

/**
 * Bind readWalletBalanceInr to the shared Firestore handle. A null handle (Firebase not configured) yields
 * a reader that always returns null → the gate proceeds. Reads the SAME doc path as the wallet routes.
 */
export function firestoreWalletReader(db: Firestore | null): WalletReader {
  return async (userId: string): Promise<WalletDocData | null> => {
    if (!db) return null;
    const snap = await getDoc(doc(db, 'user_token_wallets', userId));
    return snap.exists() ? (snap.data() as WalletDocData) : null;
  };
}
