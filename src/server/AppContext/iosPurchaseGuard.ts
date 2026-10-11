// THE iPHONE APP NEVER TEACHES A WAY TO PAY (admin 2026-10-11, Q-123: "stop it now" — the chat reads
// X-NBAI-Platform and, on iOS, never teaches the website top-up).
//
// The iPhone app sells nothing (`purchaseRail()` → 'none', App Store Guideline 3.1.1), and its screens were
// built that way. But every AI answers "how do I recharge?" from the knowledge base, which describes the
// web wallet's top-up, Cashfree, packs and plans — so the assistant inside the iPhone app could steer a user
// to buy outside the App Store, the exact thing 3.1.1 forbids. THE CLASS: a rule enforced on the screens and
// not on the words the app's AIs speak. The knowledge every AI is handed passes through here: on iOS, any
// sentence that teaches buying is removed before the model sees it, and the model is told plainly that the
// app has no way to add money. A deterministic filter, not a request the model may ignore.

export type ClientPlatform = 'ios' | 'android' | 'web';

/** The platform the client declared in `X-NBAI-Platform`. Anything else is the web. PURE. */
export function clientPlatform(header: unknown): ClientPlatform {
  const v = String(Array.isArray(header) ? header[0] : header ?? '').trim().toLowerCase();
  return v === 'ios' ? 'ios' : v === 'android' ? 'android' : 'web';
}

/**
 * A sentence that teaches how to pay or buy. Viewing a balance or a statement is not buying, and is kept.
 */
export const PURCHASE_TEACHING = /\b(?:recharg\w*|top[ -]?up|cashfree|upi|razorpay|google play billing|buy\b|purchas\w*|pay (?:with|by|on|via|for)|payment (?:method|page|link|gateway)|add (?:money|funds|balance|tokens)|token packs?|credit packs?|subscribe|subscription|(?:starter|growth) plan|checkout|₹\s?\d)/i;

/** Remove every sentence (and bullet) that teaches buying. PURE. */
export function withoutPurchaseTeaching(text: string): string {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => !PURCHASE_TEACHING.test(sentence)).join(' '))
    .filter((line) => line.trim() !== '' && !/^\s*(?:•|How to use:)\s*$/.test(line))
    .join('\n');
}

/** What every AI on the iPhone app is told, whatever the user asked. */
export const IOS_NO_PURCHASE_NOTE =
  '[THIS IS THE iPHONE APP] Money cannot be added in this app. If the user asks how to recharge, buy tokens, pay, ' +
  'subscribe or upgrade, say that adding money is not available in the iPhone app — and nothing more: never name ' +
  'a website, a link, a price to pay, a payment method or another app to pay in.';
