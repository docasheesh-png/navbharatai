// TELLING THE USER ABOUT THE ₹1 BUILD-FILE CHARGE — before the download, and after it.
//
// ADMIN 2026-08-10: "apk download abhi free me ho raha hai — jabki maine kaha tha 1₹ per download!
// Aur HAR BAR USER KO BATAYA JAYE."
//
// TWO SEPARATE FINDINGS BEHIND THIS FILE, and only the second one is a defect:
//
//  1. It is NOT free. `/api/mobile-ship/download` has charged ₹1 per built file since 2026-08-06.
//     It reads free for the admin because their account is on `AGENTV3_FREE_LIST`, which is exempt
//     everywhere by design — the same reason Professionals looked free. A normal user IS charged.
//
//  2. THE REAL DEFECT: the user is never TOLD. The server fires the debit and streams the bytes; the
//     client just saves the file. So ₹1 leaves a real person's balance with no price shown before and
//     no confirmation after — money taken silently. That is the opposite of what the billing law asks
//     for ("the bill they see is 100% REAL"), and it is what this module fixes.
//
// The wording carries the one thing users always get wrong about this charge: it is per BUILD, not
// per download. Re-downloading the same file costs nothing, because the debit is keyed to the
// artifact's identity. Saying so up front prevents the "it charged me twice!" support message that a
// bare price would guarantee. PURE — no React, no network, so the sentences are unit-testable.

export type ChargeLang = 'en' | 'hi';

/**
 * The price the CLIENT shows before the click. It mirrors the server's `APK_CHARGE_INR` default of 1;
 * the authoritative number still comes back on the response headers, and the receipt below always
 * uses THAT, so a server-side price change can never make the receipt lie — only the pre-click hint
 * would lag until the next deploy, which is the safe direction to be wrong in.
 */
export const APK_PRICE_INR = 1;

/** What the DOWNLOAD BUTTON says, so the price is visible BEFORE the user commits. PURE. */
export function chargeButtonLabel(priceInr: number, lang: ChargeLang = 'en'): string {
  if (!(priceInr > 0)) return lang === 'hi' ? 'डाउनलोड' : 'Download';
  return lang === 'hi' ? `डाउनलोड · ₹${priceInr}` : `Download · ₹${priceInr}`;
}

/** The tooltip/subtitle that explains WHY it is not charged again. PURE. */
export function chargeHint(priceInr: number, lang: ChargeLang = 'en'): string {
  if (!(priceInr > 0)) return '';
  return lang === 'hi'
    ? `हर बनी हुई फ़ाइल के लिए ₹${priceInr} — यही फ़ाइल दोबारा डाउनलोड करने पर कुछ नहीं लगता।`
    : `₹${priceInr} for each build — downloading this same file again is free.`;
}

/**
 * What the user is told AFTER the file arrives. `applied` comes from the server, so this never claims
 * a charge that did not happen: a free-list account, an anonymous caller, or a price of 0 all report
 * honestly instead of printing a number nobody paid. PURE.
 */
export function chargeReceipt(
  opts: { priceInr: number; applied: boolean; lang?: ChargeLang },
): string {
  const lang = opts.lang ?? 'en';
  if (!opts.applied || !(opts.priceInr > 0)) {
    return lang === 'hi' ? 'फ़ाइल तैयार है — इसका कोई शुल्क नहीं लगा।' : 'Your file is ready — no charge for this one.';
  }
  return lang === 'hi'
    ? `फ़ाइल तैयार है · ₹${opts.priceInr} आपके बैलेंस से लिए गए। यही फ़ाइल दोबारा लेने पर कुछ नहीं लगेगा।`
    : `Your file is ready · ₹${opts.priceInr} was taken from your balance. Getting this same file again is free.`;
}

/** Response headers the download uses to report its own price honestly. */
export const CHARGE_PRICE_HEADER = 'x-navbharatai-charge-inr';
export const CHARGE_APPLIED_HEADER = 'x-navbharatai-charge-applied';

export interface ChargeReport {
  priceInr: number;
  applied: boolean;
}

/**
 * Read the charge back off a download response. Tolerant by design: a missing or malformed header
 * means "we were not told", which must read as NO charge rather than an invented one — the same rule
 * the wallet follows when a provider reports no usage. PURE.
 */
export function readChargeHeaders(get: (name: string) => string | null | undefined): ChargeReport {
  const price = Number((get(CHARGE_PRICE_HEADER) ?? '').trim());
  const applied = String(get(CHARGE_APPLIED_HEADER) ?? '').trim().toLowerCase() === 'true';
  return {
    priceInr: Number.isFinite(price) && price > 0 ? price : 0,
    applied: applied && Number.isFinite(price) && price > 0,
  };
}
