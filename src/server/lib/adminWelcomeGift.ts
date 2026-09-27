// A ONE-CLICK ₹50 WELCOME CREDIT the admin can give a new user who has never received any gift
// (admin 2026-09-26: *"tab tak admin panel se new user jinko kabhi koi token gift nahi mila hai, usko
// admin 50 ke token gift kar sake 1 click par, bina aab ke"*).
//
// 🔑 WHY IT EXISTS: until an app build that can really run the device check is live on Play, the
// referral ladder cannot pay anybody on a phone, so every new account sits at ₹0. This is a bridge the
// admin presses by hand, per person — a human decision each time, never an automatic grant, so it adds
// no farming surface.
//
// 🔒 ELIGIBILITY IS DECIDED HERE AND RE-CHECKED INSIDE THE TRANSACTION — never by the panel. "Never
// gifted" means: no gift ever recorded (`freeGiftedTokens`), no credit of any kind ever added
// (`totalTokensPurchased`, which also carries every old welcome bonus), never paid, not a retired merge
// source, and not given this credit before. A second press therefore pays nothing.
//
// 🔒 IT IS GIFT MONEY, COUNTED LIKE ALL GIFT MONEY: it adds to `freeGiftedTokens`, so the ₹400 lifetime
// gift ceiling (giftPolicy.ts) still holds — a user given ₹50 here can later earn ₹350 from referral
// steps, never ₹400 on top. "Ek paisa jyada nahi" must not have a side door.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';
import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';

export const ADMIN_WELCOME_GIFT_RUPEES = 50;
export const ADMIN_WELCOME_GIFT_TOKENS = ADMIN_WELCOME_GIFT_RUPEES * TOKENS_PER_RUPEE;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** PURE: may this wallet receive the admin's one-click welcome credit? */
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
  if (wallet.adminWelcomeGiftAt) return 'This user has already received the ₹50 welcome credit.';
  if (wallet.mergedInto) return 'This wallet was merged into another account.';
  if (num(wallet.freeGiftedTokens) > 0) return 'This user has already received gift credit.';
  if (hasEverPaid(wallet as { totalMoneySpent?: unknown })) return 'This user has already paid.';
  if (num(wallet.totalTokensPurchased) > 0) return 'This user has already received credit before.';
  return '';
}

// ── BULK: "ek ek kar ke du? 1000 user hai?" (admin 2026-09-27) ────────────────────────────────────
//
// The same credit, to every eligible account in one press. It changes WHO decides, not WHAT is paid:
// every account still goes through the single-user transaction, which re-reads eligibility, so an
// account can never be paid twice — not by two presses, not by a press racing the per-user button.
//
// 🔒 THE ADMIN CONFIRMS A NUMBER, AND THE SERVER HOLDS THEM TO IT. The panel first asks how many are
// eligible and shows "N users × ₹50 = ₹X". The press then carries that N, and a run that would pay MORE
// than the admin saw is refused — people keep signing up between the two clicks, and "₹50,000" must
// never quietly become "₹60,000". Fewer is fine: somebody got the single button meanwhile.
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
