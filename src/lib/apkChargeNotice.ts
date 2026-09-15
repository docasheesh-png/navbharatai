// TELLING THE USER ABOUT THE ₹1 BUILD CHARGE — before it happens, and after.
//
// ADMIN 2026-08-10: "apk download abhi free me ho raha hai — jabki maine kaha tha 1₹ per download!
// Aur HAR BAR USER KO BATAYA JAYE."
//
// TWO SEPARATE FINDINGS BEHIND THIS FILE, and only the second one is a defect:
//
//  1. It is NOT free. ₹1 has been charged per built file since 2026-08-06. It reads free for the
//     admin because their account is on `AGENTV3_FREE_LIST`, which is exempt everywhere by design —
//     the same reason Professionals looked free. A normal user IS charged.
//
//  2. THE REAL DEFECT: the user is never TOLD. The server fires the debit and streams the bytes; the
//     client just saves the file. So ₹1 leaves a real person's balance with no price shown before and
//     no confirmation after — money taken silently. That is the opposite of what the billing law asks
//     for ("the bill they see is 100% REAL"), and it is what this module fixes.
//
// WHERE THE CHARGE MOVED, AND WHY (admin 2026-08-17: "app banane ka 1₹ lagna chahiye"). It used to
// fire on DOWNLOAD, which could not be enforced at all: the .apk is built by GitHub Actions in the
// user's own repository and GitHub keeps it for 14 days — a fact this very screen prints — so anyone
// could build here for nothing and collect the file from GitHub. Charging at the one step a user can
// skip meant only the honest ones paid. It now fires when the BUILD SUCCEEDS, which is both
// unavoidable and still honest about failure: GitHub publishes no artifact for a failed run, so a
// build that does not work still costs nothing.
//
// The wording therefore says per BUILD, and says the download is free — both now literally true.
// The debit is keyed to the artifact, so re-downloading or re-checking a finished build never adds a
// second charge. PURE — no React, no network, so the sentences are unit-testable.

// 🔴 ENGLISH ONLY (admin 2026-09-14): "ui me professional language (english only) honi chahiye …
// south india wale kaise padhenge isko??" A Tamil, Telugu, Kannada or Malayalam speaker cannot read
// Devanagari, so a Hindi-only string is not "the user's language" — it is one region's language shown
// to a national audience. English is the script every user of this app shares. See CLAUDE.md's
// language standard, and tests/uiLanguageEnglishOnly.test.ts, which now fails CI on any new one.

/**
 * The price the CLIENT shows before the click. It mirrors the server's `APK_CHARGE_INR` default of 1;
 * the authoritative number still comes back on the response headers, and the receipt below always
 * uses THAT, so a server-side price change can never make the receipt lie — only the pre-click hint
 * would lag until the next deploy, which is the safe direction to be wrong in.
 */
export const APK_PRICE_INR = 1;

/**
 * What the DOWNLOAD BUTTON says. No price on it any more: the download itself is free, and printing
 * "₹1" on a button that takes nothing would be the billing law's own complaint in reverse — a number
 * shown to somebody who is not being charged is as dishonest as a charge shown to nobody. PURE.
 */
export function chargeButtonLabel(_priceInr: number): string {
  return 'Download';
}

/** The tooltip/subtitle that explains WHY it is not charged again. PURE. */
export function chargeHint(priceInr: number): string {
  if (!(priceInr > 0)) return '';
  return `₹${priceInr} to build your app — once it is built, downloading it is free, however many times.`;
}

/**
 * What the user is told AFTER the file arrives. `applied` comes from the server, so this never claims
 * a charge that did not happen: a free-list account, an anonymous caller, or a price of 0 all report
 * honestly instead of printing a number nobody paid. PURE.
 */
export function chargeReceipt(
  opts: { priceInr: number; applied: boolean },
): string {
  if (!opts.applied || !(opts.priceInr > 0)) {
    return 'Your file is ready — no charge for this one.';
  }
  return `Your app is built · ₹${opts.priceInr} was taken from your balance. Downloading it is free.`;
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
