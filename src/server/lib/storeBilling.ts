/**
 * Apple / Google in-app purchases — the store-billing money path (admin 2026-08-09: "mujhe apple /
 * google payment setup karwao — app direct apple ya google se payment le sake").
 *
 * WHY THIS EXISTS: both stores REQUIRE their own billing for digital goods bought inside the app,
 * and NavBharatAI's wallet top-up is exactly that. Cashfree stays the WEB rail; this is the NATIVE
 * rail. One wallet, two funding rails — the credit itself flows through the SAME
 * `computeCreditedWallet` every purchase already uses, so there is one money model, not two.
 *
 * THE ONE SECURITY RULE: a client claim is never money. The device sends only an opaque receipt /
 * purchase token; the SERVER asks Apple or Google whether that purchase is real, for which product,
 * and whether it has already been consumed. Tokens are credited from the VERIFIED product's price —
 * never from anything the app sent. This mirrors the existing Cashfree rule (tokens derive from the
 * verified paid amount), and it is why the catalogue below lives on the server.
 *
 * IDEMPOTENCY: the store's own transaction id becomes the `payment_transactions` doc id, so a
 * retried verify (flaky network, app relaunch, store re-delivery) credits exactly once — the same
 * doc-id discipline the Cashfree path uses for its orderId.
 *
 * CONFIG-DRIVEN PACKS: the stores need FIXED price points (no "type any amount" like the web), so
 * the catalogue is data. Changing a price or adding a pack is a config edit + a store-console
 * product — never a code change here.
 */

import { envFlag } from './envFlag';

/**
 * One purchasable token pack. TWO amounts, deliberately separate (admin 2026-08-09: "Google aur
 * Apple apna % lete hai — hamare ₹ kam nahi hone chahiye"):
 *
 *   • `priceInr`  — what the STORE charges the user. Marked up so that after the store's commission
 *                   our net is unchanged from the web rail.
 *   • `creditInr` — what lands in the wallet. IDENTICAL to the web, so a user gets the same credit
 *                   for the same pack everywhere; only the toll differs.
 *
 * Why the markup and not a smaller credit: charging ₹99 and crediting ₹84 reads as being cheated
 * ("I paid 99, got 84?"). Charging ₹119 for ₹99 of credit, with the reason stated on screen, is the
 * same arithmetic told honestly — and it is what every large app does on mobile.
 */
export interface StorePack {
  /** Product id — must match App Store Connect AND Play Console exactly. */
  productId: string;
  /** What the store charges (₹). Must equal the price configured in BOTH consoles. */
  priceInr: number;
  /** What the wallet is credited (₹) — the same value the web rail gives for this pack. */
  creditInr: number;
  /** Human label for the app's own UI. */
  label: string;
}

/**
 * The store's commission, as a percentage. 15 is the correct default for BOTH stores on the first
 * $1M of yearly revenue — Google applies it automatically; Apple requires a one-time enrolment in
 * the App Store Small Business Program. ⚠️ WITHOUT that Apple enrolment the rate is 30, and these
 * prices would under-recover; `STORE_FEE_PCT` exists so the admin can retune the moment the FIRST
 * real payout shows the true number (India also has GST in the middle, which the stores collect and
 * remit — the payout report is the only honest source for the final rate).
 */
export function storeFeePct(): number {
  const v = Number(process.env.STORE_FEE_PCT);
  return Number.isFinite(v) && v >= 0 && v < 100 ? v : 15;
}

/**
 * What WE actually receive from a store sale, after commission. Pure — exported so the tests (and
 * the admin dashboard, later) can state the real number instead of anyone assuming it.
 */
export function netAfterStoreFee(priceInr: number, feePct = storeFeePct()): number {
  if (!Number.isFinite(priceInr) || priceInr <= 0) return 0;
  return Math.round(priceInr * (1 - feePct / 100) * 100) / 100;
}

/**
 * The smallest store price that still nets `creditInr` after the fee, rounded UP to a whole rupee.
 * Pure; this is the arithmetic behind the defaults below, kept in code so a future price change is
 * a calculation and not a guess.
 */
export function storePriceForCredit(creditInr: number, feePct = storeFeePct()): number {
  if (!Number.isFinite(creditInr) || creditInr <= 0) return 0;
  return Math.ceil(creditInr / (1 - feePct / 100));
}

/**
 * The packs. Store prices are marked up so the NET at 15% commission is at least the credit value
 * (₹119→₹101.15, ₹299→₹254.15, ₹599→₹509.15, ₹1199→₹1019.15 — each comfortably above its credit),
 * and they sit on round price points both stores' tier tables carry.
 *
 * Env override (`STORE_PACKS`, JSON) so the admin can retune without a deploy — malformed JSON falls
 * back to these defaults rather than leaving the app with no packs at all.
 */
export const DEFAULT_STORE_PACKS: readonly StorePack[] = [
  { productId: 'nbai.tokens.99', priceInr: 119, creditInr: 99, label: '₹99 of credit' },
  { productId: 'nbai.tokens.249', priceInr: 299, creditInr: 249, label: '₹249 of credit' },
  { productId: 'nbai.tokens.499', priceInr: 599, creditInr: 499, label: '₹499 of credit' },
  { productId: 'nbai.tokens.999', priceInr: 1199, creditInr: 999, label: '₹999 of credit' },
];

export function storePacks(): StorePack[] {
  const raw = (process.env.STORE_PACKS || '').trim();
  if (!raw) return [...DEFAULT_STORE_PACKS];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_STORE_PACKS];
    const out: StorePack[] = [];
    for (const p of parsed) {
      const productId = typeof p?.productId === 'string' ? p.productId.trim() : '';
      const priceInr = Number(p?.priceInr);
      // An omitted creditInr means "credit what the store charged" — the honest reading of a config
      // that names only one number, and it can never credit MORE than the user paid.
      const creditRaw = Number(p?.creditInr);
      const creditInr = Number.isFinite(creditRaw) && creditRaw > 0 ? Math.min(creditRaw, priceInr) : priceInr;
      if (!productId || !Number.isFinite(priceInr) || priceInr <= 0) continue;
      out.push({ productId, priceInr, creditInr, label: typeof p?.label === 'string' && p.label ? p.label : `₹${creditInr} of credit` });
    }
    return out.length > 0 ? out : [...DEFAULT_STORE_PACKS];
  } catch {
    return [...DEFAULT_STORE_PACKS]; // junk config must never leave the app with nothing to sell
  }
}

/**
 * The pack a VERIFIED product id refers to — the single place a product becomes money. Unknown ids
 * return null, so a purchase of something we do not sell credits nothing (a store console can
 * contain products we retired; crediting from an unrecognised id would be inventing money).
 */
export function packForProduct(productId: string | null | undefined): StorePack | null {
  const id = (productId || '').trim();
  if (!id) return null;
  return storePacks().find((p) => p.productId === id) ?? null;
}

export type StorePlatform = 'apple' | 'google';

export function storeBillingEnabled(): boolean {
  return envFlag('STORE_BILLING');
}

/** Is this platform's verification actually configured? Honest per-platform answer, never a guess. */
export function storePlatformConfigured(platform: StorePlatform): boolean {
  if (platform === 'apple') {
    return !!(process.env.APPLE_IAP_KEY_ID && process.env.APPLE_IAP_ISSUER_ID && process.env.APPLE_IAP_PRIVATE_KEY && process.env.APPLE_BUNDLE_ID);
  }
  return !!(process.env.GOOGLE_PLAY_SA_JSON && process.env.GOOGLE_PLAY_PACKAGE_NAME);
}

/** What a verifier reports back. `ok:false` never credits — the reason is for the server log. */
export type StoreVerifyResult =
  | { ok: true; productId: string; transactionId: string }
  | { ok: false; reason: string };

/**
 * Normalise a store's own transaction id into our `payment_transactions` doc id. Prefixed by
 * platform so an Apple and a Google id can never collide, and sanitised because it becomes a
 * Firestore document id. Pure.
 */
export function storeTransactionDocId(platform: StorePlatform, transactionId: string): string {
  const safe = (transactionId || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 120);
  return `store_${platform}_${safe}`;
}
