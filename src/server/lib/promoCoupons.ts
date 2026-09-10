// PROMO COUPONS — who may be given free credit, and how much.
//
// 🔴 WHY THIS MODULE EXISTS (revenue audit 2026-09-10). The coupon table was five codes written
// straight into the payment route: FREE100, WELCOME100, NAVBHARAT50, FESTIVE2026, SAKUNI25. Each one
// minted real credit — ₹25 to ₹200 — and every one of them had three problems at once:
//
//   1. GUESSABLE. "FREE100" and "WELCOME100" are the first two things anybody would type into a promo
//      box. The codes were not distributed, they were waiting to be found.
//   2. NO EXPIRY. FESTIVE2026 would still have worked in 2030.
//   3. NO TOTAL CAP. One code reaching a deals site is ₹100 per signup, forever, with nothing in the
//      product able to stop it except a deploy.
//
// The redemption itself was already sound — atomic, one per user — so the leak was never a bug in the
// code. It was that the PRICE LIST lived in the source, where the admin could not reach it and an
// attacker could guess it.
//
// 🔒 THE DEFAULT IS NOW "NO COUPONS AT ALL." An unset PROMO_COUPONS pauses every code, which is what
// the admin asked for, and it also means a future deploy can never silently re-open the door: adding
// a code is now a deliberate act in Cloud Run, visible to whoever made it.

/** The most a single coupon may ever be worth, in ₹. */
export const MAX_COUPON_VALUE_INR = 5_000;

/**
 * Read the coupon table from the environment.
 *
 * FORMAT, chosen because the admin types it by hand into a Cloud Run field:
 *   `PROMO_COUPONS=DIWALI2026:100,PARTNER50:50`
 *
 * Everything that cannot be read is DROPPED rather than guessed at, and the reasoning is the same one
 * hostingCost.ts records for its rates: a malformed money value must never become a real number. A
 * typo that reads as junk gives away nothing; a typo silently treated as ₹0 or as some default would
 * either look broken or give away money nobody authorised.
 *
 * ⚠️ THE VALUE CAP IS THE ONE THAT MATTERS. `DIWALI:10000` where ₹100 was meant is a single missing
 * decimal that would hand ₹10,000 to every redeemer. Anything above MAX_COUPON_VALUE_INR is refused
 * outright, because no legitimate promo in this product is worth more than that and the cost of being
 * wrong is unbounded.
 *
 * PURE. Returns an empty table for absent, blank or wholly-malformed input — never throws.
 */
export function parsePromoCoupons(raw: string | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  const s = String(raw ?? '').trim();
  if (!s) return out;
  for (const part of s.split(',')) {
    const [codeRaw, valueRaw] = part.split(':');
    const code = String(codeRaw ?? '').trim().toUpperCase();
    // A code must look like a code: letters and digits only. This also stops a stray space or a
    // half-typed entry from becoming a redeemable word.
    if (!code || !/^[A-Z0-9_-]{3,32}$/.test(code)) continue;
    const value = Number(String(valueRaw ?? '').trim());
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value > MAX_COUPON_VALUE_INR) continue;
    out[code] = value;
  }
  return out;
}

/** The live coupon table. Empty ⇒ every code is refused, which is the default. */
export function promoCoupons(env: NodeJS.ProcessEnv = process.env): Record<string, number> {
  return parsePromoCoupons(env.PROMO_COUPONS);
}

/**
 * What one code is worth right now, or null when it is not redeemable.
 *
 * Codes are matched case-insensitively because a user typing a promo into a phone will not match our
 * capitalisation, and refusing them over it would be a support ticket for nothing.
 */
export function couponValueInr(code: string, env: NodeJS.ProcessEnv = process.env): number | null {
  const key = String(code ?? '').trim().toUpperCase();
  if (!key) return null;
  const table = promoCoupons(env);
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}
