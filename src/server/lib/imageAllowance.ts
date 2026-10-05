// FIVE FREE IMAGES A DAY, THEN ₹1 EACH (admin 2026-09-30: "per day 5 image free for user, uske bad 1₹/image").
//
// ONE RULE FOR EVERY ENGINE. The count is of pictures DELIVERED to the user, whichever rung drew them,
// because the user sees one image generator, not a ladder. The price is the admin's own number, not a
// cost we worked out, so it does not contradict THE ONE-WALLET LAW's "never invent a cost": nothing is
// estimated here.
//
// 🔒 HOW THE MONEY MOVES (since Q-616, 2026-10-05 — `imageHold.ts` does it, for every door):
//  - BEFORE any engine is called: the day's count is incremented ATOMICALLY and the charge is decided from
//    the NEW count (`imageFeeForCount`), so two pictures at the same moment cannot both be the free fifth.
//    A priced one then has its ₹ HELD from the wallet in one all-or-nothing transaction; a wallet that
//    cannot cover it is refused (`imageNeedsCreditBody`) and the slot is given back.
//  - On delivery the hold is settled: nothing more is charged.
//  - A picture that failed gets its slot and its ₹ back, so it is never counted and never charged.
//
// 🔁 Until 2026-10-05 the first step was a READ (`decideImageStart`, removed) and the count and the charge
// moved only after delivery, fire-and-forget. Concurrent requests each passed the read, so extra pictures
// went uncharged or into overdraft (forensic audit Q-616). Do not bring a read-then-charge gate back.
//  - Free-listed accounts (the admin's own) are neither counted nor charged.
//  - A link the BROWSER fetches itself (`IMAGE_GEN_CLIENT_FETCH`) is not counted: we cannot see whether
//    it arrived, and charging for something that may not have arrived is the thing the billing law
//    forbids. It costs NavBharatAI nothing, since it is fetched on the user's own connection.
//
// 🔁 2026-09-30 to 2026-10-05 the screen had a Free / Paid toggle and this applied to Paid mode alone.
// Free mode was removed on 2026-10-05 (its provider's anonymous door answered 402 to everyone), so this
// allowance is the whole image generator again — charged only to a screen that showed it (`imageTier.ts`).
//
// 🔁 THIS REVERSES 2026-09-23, on the admin's word. That day the separate PAID image tier (a second
// engine behind a FREE/PRO switch) was removed and the tool renamed "Image Generator AI FREE". This is
// not that tier coming back: there is still one generator and one route. It now has a daily allowance
// and a price after it, and the word FREE left the name at the same time.
//
// `AI_IMAGE_PRICING=off` restores the previous behaviour exactly, with no deploy.

import { parseEnvNumber } from './envNumber';
import { walletEmptyBody } from './walletEmptyNotice';

export function imagePricingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AI_IMAGE_PRICING || '').trim().toLowerCase() !== 'off';
}

/** Free pictures per user per day (India's calendar day). Default 5; an unreadable value means 5. */
export function imageFreePerDay(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseEnvNumber(env.AI_IMAGE_FREE_PER_DAY);
  return n !== null && n >= 0 ? Math.floor(n) : 5;
}

/** The price of each picture after the free ones, in rupees. Default ₹1; unreadable means ₹1; capped at ₹50. */
export function imagePriceInr(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseEnvNumber(env.AI_IMAGE_PRICE_INR);
  return n !== null && n >= 0 ? Math.min(50, n) : 1;
}

function inr(n: number): string {
  return `₹${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

/** The refusal, carrying the wallet-empty code every client already turns into a top-up prompt. PURE. */
export function imageNeedsCreditBody(i: { freePerDay: number; priceInr: number; balanceInr: number | null }): Record<string, unknown> {
  const balance = typeof i.balanceInr === 'number' && Number.isFinite(i.balanceInr) ? i.balanceInr : null;
  const balanceText = balance === null ? '' : ` Your balance is ${balance < 0 ? '-' : ''}₹${Math.abs(balance).toFixed(2)}.`;
  const error = `You have used your ${i.freePerDay} free images for today. Each image after that costs `
    + `${inr(i.priceInr)} from your wallet.${balanceText} Add credit to carry on, or come back tomorrow `
    + `for ${i.freePerDay} more free images.`;
  return walletEmptyBody(
    { balanceInr: balance, priceInr: i.priceInr, what: 'this image' },
    { error, bucket: 'image', freePerDay: i.freePerDay, priceInr: i.priceInr },
  );
}

/**
 * The charge for the picture that made today's count `countAfter`. A count of 0 means the counter could
 * not be written (no database, an error) — that picture is not charged, the same fail-open the counter
 * already has. PURE.
 */
export function imageFeeForCount(countAfter: number, freePerDay: number, priceInr: number): number {
  if (!Number.isFinite(countAfter) || countAfter <= 0) return 0;
  return countAfter > freePerDay && priceInr > 0 ? priceInr : 0;
}

/** Free pictures left today after `countAfter`. PURE. */
export function freeImagesLeft(countAfter: number, freePerDay: number): number {
  return Math.max(0, freePerDay - Math.max(0, Math.floor(countAfter)));
}

/**
 * The rule in one phrase, for every AI that points a user at the image generator. One mode since
 * 2026-10-05: this allowance, then the price.
 */
export function imagePriceSentence(env: NodeJS.ProcessEnv = process.env): string {
  const free = imageFreePerDay(env);
  const price = imagePriceInr(env);
  if (!imagePricingEnabled(env) || price <= 0) return 'free';
  return `${free} free images a day, then ${inr(price)} each from the wallet`;
}
