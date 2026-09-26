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
