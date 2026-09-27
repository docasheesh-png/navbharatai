// A ₹150 WELCOME CREDIT the admin gives EVERY new user in one press (admin 2026-09-27: *"50₹ wala system
// hatao aur 1 click me new user ko 150₹ gift de aisa button bana do! only new user ke liye"*).
//
// History: this began on 2026-09-26 as a ₹50 button on each user's row. The admin asked the same day
// how to give it to 1,000 people ("ek ek kar ke du?"), and then replaced the row button and the amount
// with this one bulk press. The per-row button and its route are gone; `adminWelcomeGiftAt` is still
// the marker, so an account that received the old ₹50 is not paid again.
//
// 🔑 WHY IT EXISTS: every welcome grant except the referral ladder was deleted on 2026-09-26, so a new
// account opens at ₹0 until the ladder pays it. This is the admin's own bridge — a human press each
// time, never an automatic grant, so it adds no farming surface.
//
// 🔒 "NEW USER" IS DECIDED HERE AND RE-CHECKED INSIDE THE TRANSACTION — never by the panel. It means:
// no gift ever recorded (`freeGiftedTokens`), no credit of any kind ever added (`totalTokensPurchased`,
// which also carries every old welcome bonus), never paid, not a retired merge source, and not given
// this credit before. So every account opened before the welcome grants were deleted — which received
// one — is excluded by construction, and a second press pays nothing.
//
// 🔒 IT IS GIFT MONEY, COUNTED LIKE ALL GIFT MONEY: it adds to `freeGiftedTokens`, so the ₹400 lifetime
// gift ceiling (giftPolicy.ts) still holds — a user given ₹150 here can later earn at most ₹250 from
// referral steps, never ₹400 on top. "Ek paisa jyada nahi" must not have a side door.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';

export const ADMIN_WELCOME_GIFT_RUPEES = 150;
export const ADMIN_WELCOME_GIFT_TOKENS = ADMIN_WELCOME_GIFT_RUPEES * TOKENS_PER_RUPEE;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** PURE: is this wallet a NEW user who may receive the admin's welcome credit? */
export function welcomeGiftEligible(wallet: Record<string, unknown> | null | undefined): boolean {
  if (!wallet) return false;
  if (wallet.adminWelcomeGiftAt) return false;
  if (wallet.mergedInto) return false;
  if (num(wallet.freeGiftedTokens) > 0) return false;
  if (num(wallet.totalTokensPurchased) > 0) return false;
  if (hasEverPaid(wallet as { totalMoneySpent?: unknown })) return false;
  return true;
}

/** Why a wallet is NOT eligible, in the admin's words — for the refusal the panel shows. PURE. */
export function welcomeGiftRefusal(wallet: Record<string, unknown> | null | undefined): string {
  if (!wallet) return 'No wallet exists for this user yet.';
  if (wallet.adminWelcomeGiftAt) return 'This user has already received the admin welcome credit.';
  if (wallet.mergedInto) return 'This wallet was merged into another account.';
  if (num(wallet.freeGiftedTokens) > 0) return 'This user has already received gift credit.';
  if (hasEverPaid(wallet as { totalMoneySpent?: unknown })) return 'This user has already paid.';
  if (num(wallet.totalTokensPurchased) > 0) return 'This user has already received credit before.';
  return '';
}

// ── THE ONE PRESS ─────────────────────────────────────────────────────────────────────────────────
//
// Every account goes through one per-wallet transaction that re-reads eligibility, so an account can
// never be paid twice — not by two presses, and not by two admins pressing at once.
//
// 🔒 THE ADMIN CONFIRMS A NUMBER, AND THE SERVER HOLDS THEM TO IT. The panel first asks how many are
// eligible and shows "N users × ₹150 = ₹X". The press then carries that N, and a run that would pay MORE
// than the admin saw is refused — people keep signing up between the two clicks, and "₹150,000" must
// never quietly become "₹180,000". Fewer is fine: somebody got the single button meanwhile.
//
// 🔒 A banned account is never in the list: gift credit to an account we have shut out is a gift to
// the abuse we shut out.

/** At most this many accounts are paid per press; the rest are reported as remaining. */
export const BULK_WELCOME_GIFT_MAX = 2000;

/** PURE: the accounts one bulk press may pay, by wallet id. */
export function bulkWelcomeGiftCandidates(
  wallets: Array<{ id: string } & Record<string, unknown>>,
): string[] {
  return wallets
    .filter((w) => !!w.id && !w.banned && welcomeGiftEligible(w))
    .map((w) => w.id);
}

/**
 * PURE: may a bulk press pay `actual` accounts when the admin confirmed `expected`? `null` = yes,
 * otherwise the refusal. A missing or malformed number is a refusal, never "no limit".
 */
export function bulkWelcomeGiftRefusal(expected: unknown, actual: number): string | null {
  const n = Number(expected);
  if (expected === undefined || expected === null || expected === '' || !Number.isInteger(n) || n < 0) {
    return 'Check the eligible count first, then confirm it.';
  }
  if (actual > n) {
    return `${actual - n} more user(s) became eligible since you checked. Check again and confirm the new total.`;
  }
  return null;
}
