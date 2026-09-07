// Google Play in-app purchases — the PURE half (admin 2026-09-06: "google play policy ke anusar hi
// banao, par user ke bill me google ka charge add kar ke clear dikhao").
//
// WHY THIS EXISTS AT ALL: Google Play's Payments policy requires that digital goods CONSUMED INSIDE
// an app distributed on Play be sold through Play's own billing. NavBharatAI's wallet top-up is
// exactly that, and today the Android app sells it through the web rail (Cashfree) — which is the
// policy risk this rail closes. The server half (storeBilling.ts / storeVerify.ts / the
// /api/payment/store/verify route) was already built; this is the client's decision layer.
//
// EVERYTHING HERE IS PURE. No Capacitor, no DOM, no network — so every rule below is unit-testable
// without an Android device, which for money code is the difference between "we believe" and "we
// checked". The native bridge lives in playBillingNative.ts and the I/O in usePaymentEngine.

/** One purchasable pack, exactly as `GET /api/payment/store/packs` returns it (server is the source of truth). */
export interface StorePack {
  productId: string;
  /** What Google charges the user (₹). Must equal the price configured in the Play Console. */
  priceInr: number;
  /** What the wallet is credited (₹) — the SAME value this pack gives on the web. */
  creditInr: number;
  label: string;
}

/** What `GET /api/payment/store/packs` answers. Honest per-platform, never a guess. */
export interface StoreConfig {
  enabled: boolean;
  apple: boolean;
  google: boolean;
  packs: StorePack[];
}

/**
 * Which rail should this device buy on?
 *
 * ⚠️ THE FALLBACK IS DELIBERATELY THE WORKING PATH, NOT AN ERROR. A third state ("unavailable")
 * would be the *policy-purist* answer on Android — but it would also mean that the day this ships
 * with `STORE_BILLING` unset, every Android user loses the ability to top up at all. Breaking
 * buying for real users to satisfy a flag that the admin has not turned on yet is not a trade
 * anyone would accept if asked plainly.
 *
 * So the flag IS the migration: OFF ⇒ byte-identical to today (web rail everywhere, and the Play
 * policy exposure that already exists is unchanged); ON ⇒ Android buys through Play Billing and the
 * exposure is closed. Nothing about turning it on can strand a user, because it only ever switches
 * a rail that is proven configured (`enabled && google && packs.length && the native plugin answers`).
 */
export type PurchaseRail = 'play-billing' | 'web-gateway';

export function purchaseRail(input: {
  isNative: boolean;
  config: StoreConfig | null;
  /** Did the native Play Billing plugin actually answer? An older installed shell has no plugin. */
  pluginReady: boolean;
}): PurchaseRail {
  if (!input.isNative) return 'web-gateway';         // the web has no Play Billing to use
  if (!input.pluginReady) return 'web-gateway';      // an older .aab predates the plugin entirely
  const c = input.config;
  if (!c || !c.enabled || !c.google) return 'web-gateway';
  return c.packs.length > 0 ? 'play-billing' : 'web-gateway';
}

/**
 * The honest bill line the admin asked for, per pack.
 *
 * `storeFeeInr` is the REAL arithmetic difference between what Google charges and what the wallet
 * receives — computed, never typed in. It is labelled "Play Store fee" rather than "Google's fee"
 * on purpose: Google's own commission is ~15% of the price (₹17.85 on a ₹119 pack), and the
 * remainder is the rounding up to a price point Play's tier table actually carries. Printing
 * "Google's fee: ₹20" would be a number no payout report will ever match — a fabricated line, which
 * the billing law in CLAUDE.md forbids even when it flatters us. "Play Store fee" is true as
 * written: it is the surcharge that exists BECAUSE the purchase goes through the store.
 *
 * The internal split (Google's cut vs our margin) stays admin-only, per the same law — the server
 * already records `storeFeePct` and `storeNetInr` on the transaction for the admin's reconciliation.
 */
export interface PackBreakdown {
  /** What lands in the wallet — identical to the web price for the same pack. */
  creditInr: number;
  /** The visible surcharge for buying inside the app. Always ≥ 0. */
  storeFeeInr: number;
  /** What Google charges. */
  priceInr: number;
  /** True when the store adds nothing (credit == price) — then the fee line must not be rendered. */
  feeFree: boolean;
}

export function packBreakdown(pack: StorePack): PackBreakdown {
  const priceInr = Number.isFinite(pack.priceInr) && pack.priceInr > 0 ? pack.priceInr : 0;
  // A credit larger than the price can only be a misconfiguration; clamping keeps the fee line from
  // rendering a negative "fee", which would read as a discount we are not actually giving.
  const creditInr = Number.isFinite(pack.creditInr) && pack.creditInr > 0 ? Math.min(pack.creditInr, priceInr) : 0;
  const storeFeeInr = Math.round((priceInr - creditInr) * 100) / 100;
  return { creditInr, storeFeeInr, priceInr, feeFree: storeFeeInr <= 0 };
}

/**
 * What a finished purchase attempt did. Every outcome is NAMED — a money flow must never report a
 * bare boolean, because "false" cannot tell a user whether they were charged.
 */
export type PurchaseOutcome =
  /** Verified by the server and credited. */
  | 'credited'
  /** The store already delivered this one and the wallet already has it (a safe retry). */
  | 'already-credited'
  /** The user closed Google's sheet. No money moved. */
  | 'cancelled'
  /** Google took the payment but our server could not verify yet — it will be retried on next launch. */
  | 'paid-not-verified'
  /** Nothing was charged; the flow failed before payment. */
  | 'failed'
  /** This build/device cannot do Play Billing at all. */
  | 'unavailable';

/**
 * The sentence a person reads for each outcome. Kept here (pure, tested) rather than inline in the
 * panel so the WORDING of a money message is reviewable in one place — especially `paid-not-verified`,
 * which must never read like a loss.
 */
export function purchaseMessage(outcome: PurchaseOutcome): string {
  switch (outcome) {
    case 'credited':
      return 'Payment successful — your balance has been topped up.';
    case 'already-credited':
      return 'This purchase was already added to your balance.';
    case 'cancelled':
      return 'Purchase cancelled. You have not been charged.';
    case 'paid-not-verified':
      return 'Google confirmed your payment, but we could not finish adding the credit just now. '
        + 'It will be added automatically the next time you open the app — you will not be charged twice.';
    case 'failed':
      return 'That purchase could not be completed. You have not been charged.';
    case 'unavailable':
      return 'In-app purchases are not available in this version of the app.';
  }
}
