// WHAT A BOUGHT GIFT CODE LOOKS LIKE TO THE PERSON WHO BOUGHT IT, and the message they send with it.
//
// Shared by the payment hook and the Billing panel so the two cannot drift about the shape, and pure
// so the share text is testable without a browser.

export interface GiftCodeRow {
  code: string;
  /** What the recipient will receive. */
  faceInr: number;
  /** What the buyer paid, face + platform fee. */
  paidInr: number;
  status: 'unused' | 'redeemed';
  createdAt: string;
  redeemedAt: string | null;
}

/**
 * The message a buyer sends their friend.
 *
 * 🔒 IT NAMES NO PROVIDER AND MAKES NO PROMISE WE DO NOT KEEP — the White-Label Law reaches here too,
 * because this text leaves the app and lands in somebody else's chat. It says what the code is worth,
 * where to type it, and nothing about how any of it works.
 *
 * ⚠️ The redemption path is named EXACTLY as the screen is labelled ("Wallet & Billing → Promocode"),
 * because a person following these words has never seen this app before. A vaguer "redeem it in the
 * app" is the sentence that turns a gift into a support message.
 */
export function giftShareText(code: string, faceInr: number): string {
  const amount = Number(faceInr);
  const worth = Number.isFinite(amount) && amount > 0 ? `₹${amount.toLocaleString('en-IN')}` : '';
  return [
    `Here is ${worth} of NavBharatAI credit for you 🎁`,
    '',
    `Code: ${code}`,
    '',
    'To use it: open NavBharatAI → Wallet & Billing → Promocode → paste the code → Apply.',
  ].join('\n');
}

/** A WhatsApp share link for that message. Encoded once, here, rather than at each call site. */
export function giftWhatsAppUrl(code: string, faceInr: number): string {
  return `https://wa.me/?text=${encodeURIComponent(giftShareText(code, faceInr))}`;
}
