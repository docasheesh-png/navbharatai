// THE PLATFORM FEE ON A WALLET RECHARGE — the SHARED, pure arithmetic.
//
// 🔴 WHY IT EXISTS (revenue audit 2026-09-10). The recharge path credited rupee-for-rupee —
// `balanceAdded: orderAmount`, with the comment "₹1 = ₹1 balance added to wallet". The payment
// gateway's own charge therefore came out of NavBharatAI's side of every card and netbanking payment
// and appeared NOWHERE in the books: there was no gateway-fee line anywhere in the codebase. On a
// ₹500 card recharge we credited ₹500 and received about ₹490.
//
// 🔒 ONE FLAT RATE, DISCLOSED BEFORE PAYMENT — and the reason it is flat is the interesting part.
// India's real gateway cost is not one number: UPI carries ZERO merchant discount rate by regulation,
// while cards and netbanking cost roughly 2% plus GST. Deducting the ACTUAL cost would mean the same
// ₹500 credits a different amount depending on a method the user only chooses on the NEXT screen —
// three prices for one product, none of them showable in advance. A single rate can be stated up
// front, which is the only version a user can agree to.
//
// It is called a PLATFORM fee, never a "gateway fee" or "Cashfree's charge". Same reasoning CLAUDE.md
// records for the Play Store fee label: the gateway's real charge on a given payment is a number no
// statement of ours will ever match, so naming it after them would be a claim we cannot support even
// when it flatters us. It is our fee, on our platform. (It also keeps the White-Label Law: a user-
// facing surface never names a third-party provider.)
//
// ⚠️ WHAT THIS MUST NEVER TOUCH — the Play/Apple store packs. Those are ALREADY priced with their fee
// inside (₹119 buys ₹99 of credit), and the billing panel promises in so many words that "your wallet
// is credited the full credit amount shown, never less". Applying this fee there would charge the user
// twice for one thing AND make that sentence a lie. Store purchases credit `pack.creditInr` and carry
// no `platformFeeInr` at all.
//
// A COUPON IS NOT A PAYMENT. No gateway is involved and no money arrives, so a redeemed coupon credits
// its full face value — charging a fee on a gift would be taking money in order to give money.
//
// 🔑 WHY THIS FILE IS SHARED (src/lib) RATHER THAN SERVER-ONLY. The user must be shown the SAME split
// the server will apply, before they pay. Two implementations of one money rule is exactly the drifted
// duplication CLAUDE.md's root-cause rule says to centralise: the arithmetic lives here once, the
// server wraps it with the env rate (src/server/lib/platformFee.ts) and the browser wraps it with the
// rate it reads from /api/public-config. Neither side does its own maths.
//
// PURE. No clock, no I/O, no env.

/** The default rate, in percent. Admin-confirmed 2026-09-10 ("2% flat theek hai"). */
export const DEFAULT_PLATFORM_FEE_PCT = 2;

/** The highest rate the code will accept, as a guard against a mistyped configuration. */
export const MAX_PLATFORM_FEE_PCT = 20;

/**
 * Coerce a configured/received rate into a usable one.
 *
 * The empty string is checked BEFORE `Number()`, for the reason hostingCost.ts records: `Number('')`
 * is 0, so a blank value would silently mean "no fee" while looking deliberately configured. An
 * unreadable or out-of-range value falls back to the default rather than being obeyed — a fee is
 * money, and a typo in a money field must not become a price.
 */
export function normalizeFeePct(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (s === '') return DEFAULT_PLATFORM_FEE_PCT;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PLATFORM_FEE_PCT) return DEFAULT_PLATFORM_FEE_PCT;
  return n;
}

export interface PaymentSplit {
  /** What the user actually pays. */
  paidInr: number;
  /** Our platform fee, deducted from that. */
  feeInr: number;
  /** What reaches their wallet. */
  creditInr: number;
}

/**
 * Split a payment into fee and credit at a given rate.
 *
 * 🔑 THE FEE IS ROUNDED AND THE CREDIT IS THE REMAINDER — never the other way round, and never both
 * rounded independently. Rounding both would let `fee + credit` disagree with what the user paid by a
 * paisa, and a wallet whose two halves do not add up to the payment is the exact drift the debit-carry
 * fix was written to end. This way the identity holds exactly, always.
 *
 * A non-finite or non-positive amount yields zeroes rather than a negative credit.
 */
export function splitPaymentAtPct(paidInr: number, pct: number): PaymentSplit {
  const paid = Number(paidInr);
  if (!Number.isFinite(paid) || paid <= 0) return { paidInr: 0, feeInr: 0, creditInr: 0 };
  const rate = normalizeFeePct(pct);
  const rounded = Math.round(paid * (rate / 100) * 100) / 100;
  // Defensive: a fee can never exceed the payment, whatever the configured rate.
  const fee = Math.min(rounded, paid);
  return { paidInr: paid, feeInr: fee, creditInr: Math.round((paid - fee) * 100) / 100 };
}

/** The line shown to the user BEFORE they pay. Never says "gateway" and never names a provider. */
export function platformFeeNoticeAtPct(paidInr: number, pct: number): string {
  const s = splitPaymentAtPct(paidInr, pct);
  if (s.paidInr <= 0) return '';
  if (s.feeInr <= 0) return `₹${s.creditInr.toFixed(2)} will be added to your wallet.`;
  return `₹${s.creditInr.toFixed(2)} will be added to your wallet (₹${s.feeInr.toFixed(2)} platform fee).`;
}

/**
 * The rate this server is charging, read from GET /api/public-config.
 *
 * Falls back to the default on ANY failure. That is deliberate and is the safe direction: the default
 * is what the server itself falls back to, so an unreachable config route shows the user the number
 * they will actually be charged rather than a cheerful ₹0 fee the server would then contradict.
 */
export async function fetchPlatformFeePct(): Promise<number> {
  try {
    const res = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
    if (!res.ok) return DEFAULT_PLATFORM_FEE_PCT;
    const body = (await res.json()) as { platformFeePct?: unknown };
    return normalizeFeePct(body?.platformFeePct);
  } catch {
    return DEFAULT_PLATFORM_FEE_PCT;
  }
}
