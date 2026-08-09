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

/** One purchasable token pack, as it exists in BOTH store consoles. */
export interface StorePack {
  /** Product id — must match App Store Connect AND Play Console exactly. */
  productId: string;
  /** Price in ₹ as configured in the store (display + the amount we credit against). */
  priceInr: number;
  /** Human label for the app's own UI. */
  label: string;
}

/**
 * The packs. Price points chosen for Indian users and for what both stores' tier tables support.
 * Env override (`STORE_PACKS`, JSON) so the admin can retune without a deploy — malformed JSON
 * falls back to these defaults rather than leaving the app with no packs at all.
 */
export const DEFAULT_STORE_PACKS: readonly StorePack[] = [
  { productId: 'nbai.tokens.99', priceInr: 99, label: '₹99 top-up' },
  { productId: 'nbai.tokens.249', priceInr: 249, label: '₹249 top-up' },
  { productId: 'nbai.tokens.499', priceInr: 499, label: '₹499 top-up' },
  { productId: 'nbai.tokens.999', priceInr: 999, label: '₹999 top-up' },
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
      if (!productId || !Number.isFinite(priceInr) || priceInr <= 0) continue;
      out.push({ productId, priceInr, label: typeof p?.label === 'string' && p.label ? p.label : `₹${priceInr} top-up` });
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
  return /^(on|true|1)$/i.test((process.env.STORE_BILLING || '').trim());
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
