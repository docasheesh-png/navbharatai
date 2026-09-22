// THE RED DOT THAT LEADS A USER TO THE TOP-UP (admin 2026-09-22).
//
// Admin, verbatim: *"agar balat kahatam hai, to navigator dot, ko 3lins menu-> wallet and billing ->
// buy token -> purchage wallet token par ek red dot show hona chahiye!"* — a trail, not one badge:
// the ☰ button, the **Wallet & Billing** row, the **Buy tokens** tile and the **Purchase Wallet
// Tokens** button each carry the same dot, so a user who cannot use the app is walked to the one
// screen that fixes it instead of being left to find it.
//
// 🔒 ONE QUESTION, ONE ANSWER, FOUR READERS. Four places asking "is the balance finished?" in four
// slightly different ways is the drifted-copy class this repo has paid for five times (`safeRelPath`
// ×4, `tagsOnLine` ×2, the HTML boot guard ×2, `PLAYWRIGHT_BROWSERS_PATH` ×2, and the empty-balance
// sentence itself, earlier today). This module is the only one.
//
// 🔑 THE LINE IS THE SERVER'S OWN REFUSAL LINE (`walletTooEmptyForTurn`: `balanceInr <= 0`), and that
// is deliberate rather than convenient. A dot that appeared at ₹5 while builds still worked would be
// a nag; no dot at ₹0 while every paid action is refused would be useless. Tying it to the same
// number means the dot and the refusal can never disagree about whether the app works.
//
// ⚠️ IT DOES NOT WARN BEFORE THE WALL. "Your balance is running low" is a different, un-built thing
// (the push notification for it exists in `PushNotificationService` and has no caller) — and it is a
// different decision, because a warning has to obey the alert-noise rule. This dot states a fact that
// is true right now and disappears the moment it stops being true.

import { TOKENS_PER_RUPEE } from './walletPricing';

/** The shape the app's wallet object really has — both views of one balance, either possibly absent. */
export interface WalletLike {
  remaining_balance?: unknown;
  tokenBalance?: unknown;
}

function numeric(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The spendable balance in ₹, or `null` when it genuinely cannot be determined.
 *
 * 🔴 IT TAKES THE HIGHER OF THE TWO VIEWS, and that is not belt-and-braces — it is a bug this repo
 * has already paid for. The wallet holds one balance in TWO fields, and the gift path once bumped
 * `tokenBalance` alone (admin 2026-08-03: *"₹0 + 50,000 tokens → app building off"*). Reading ₹ alone
 * would paint a red "you have no money" dot across the whole app for a user holding ₹500 of gift
 * credit — on the interim welcome grant, that is every brand-new account. `readWalletBalanceInr` on
 * the server takes the max for exactly this reason; the client must not be stricter than the gate it
 * is describing.
 */
export function walletBalanceInr(wallet: unknown): number | null {
  if (!wallet || typeof wallet !== 'object') return null;
  const w = wallet as WalletLike;
  const inr = numeric(w.remaining_balance);
  const tokens = numeric(w.tokenBalance);
  const tokenInr = tokens !== null && TOKENS_PER_RUPEE > 0 ? tokens / TOKENS_PER_RUPEE : null;
  if (inr !== null && tokenInr !== null) return Math.max(inr, tokenInr);
  if (inr !== null) return inr;
  if (tokenInr !== null) return tokenInr;
  return null;
}

export interface TopUpDotInput {
  /** The wallet as the app holds it. `null`/undefined while signed out or not yet fetched. */
  wallet?: unknown;
  /** True while the wallet request is in flight — the dot must not flicker on during a refresh. */
  loading?: boolean;
}

/**
 * Should the top-up trail show its dot?
 *
 * 🔒 SILENT ON EVERY DOUBT. Not signed in, not fetched, still loading, or a wallet whose balance
 * cannot be read at all ⇒ **no dot**. A red dot is an accusation that the user cannot use what they
 * paid for; showing one because a fetch had not landed yet would put it on every cold start, on every
 * screen, for everybody — and a dot that is wrong once is a dot nobody reads again.
 */
export function walletNeedsTopUp(input: TopUpDotInput): boolean {
  if (input.loading) return false;
  const balance = walletBalanceInr(input.wallet);
  if (balance === null) return false;
  return balance <= 0;
}

/** The one sentence that explains the dot, for a tooltip and for a screen reader. */
export const TOP_UP_DOT_LABEL = 'Your balance is finished — add credit';
