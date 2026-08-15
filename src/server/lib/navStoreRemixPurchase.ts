// PAID REMIX — wallet-to-wallet, non-refundable, 80/20 (Kadam 3, admin-locked 2026-08-15).
//
// THE MODEL, as the admin decided it:
//   • The creator sets a price on their listing (or leaves it free — free stays the default and the
//     store's growth engine; a price is the creator's CHOICE).
//   • The buyer pays FROM THEIR WALLET. No new payment rails: topping up the wallet is the existing
//     Cashfree recharge, so this module never touches a card, a bank, or a payout — which is exactly
//     what keeps it shippable without KYC, TDS counsel, or an RBI licence.
//   • The creator earns 80% INTO THEIR WALLET. Wallet earnings are one-way by design (they are spent
//     on builds, never withdrawn) — that one-way-ness is what keeps the wallet a closed system and
//     the whole feature out of payment-regulation territory. The remaining 20% is the platform's,
//     taken by simply not crediting it.
//   • NON-REFUNDABLE, full stop ("ya likh de non refundable, baat khatam"). It is fair here in a way
//     it is not on Play: the whole app is free to RUN before buying, so nobody buys blind. The single
//     exception is billing law, not policy: a purchase where the files were never delivered is a
//     failed transaction, and the charge simply does not happen (files are copied FIRST, the debit
//     runs AFTER — the platform's standing "working result or free" order).
//
// MONEY RULES INHERITED FROM THE ONE-WALLET LAW, not re-invented:
//   • The debit rides debitWalletForBuild — the same doc, the same transaction, the same idempotency
//     (a purchase ref means a double-tap can never double-charge).
//   • Buying twice is impossible by construction: a purchase RECORD is checked first, and an owned
//     app remixes again for free, forever. Charging someone twice for one snapshot would be theft
//     with extra steps.
//   • An empty wallet is refused BEFORE anything is copied; a mid-flight race may overdraft slightly,
//     exactly as a build may — the debt is recorded honestly and the next gate blocks.
//   • A creator credit that fails AFTER the buyer was debited is never silently swallowed: it lands
//     in a pending-credits ledger the admin can reconcile. Losing the creator's 80% quietly would be
//     the platform stealing from its own sellers.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { TOKENS_PER_RUPEE } from './payments';
import { debitWalletForBuild } from './walletDebit';

/** ₹19 minimum (admin-locked): below this, ledger noise outweighs the money. 0 = free. */
export const MIN_REMIX_PRICE_INR = 19;
export const MAX_REMIX_PRICE_INR = 10_000;
/** The creator's share of every sale. The platform's 20% is taken by not being credited. */
export const CREATOR_SHARE = 0.8;

/**
 * Is this a price a listing may carry? Whole rupees only — fractional prices make the 80/20 split
 * produce sub-token remainders on BOTH sides of the trade, and the exactness machinery exists for
 * costs we cannot round, not for prices we can simply constrain.
 */
export function validateRemixPrice(price: unknown): { ok: boolean; priceInr: number; reason?: string } {
  if (price === undefined || price === null || price === 0 || price === '0') return { ok: true, priceInr: 0 };
  const n = typeof price === 'number' ? price : Number(price);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, priceInr: 0, reason: 'The price must be a whole number of rupees.' };
  if (n < MIN_REMIX_PRICE_INR) return { ok: false, priceInr: 0, reason: `The minimum price is ₹${MIN_REMIX_PRICE_INR} (or leave it free).` };
  if (n > MAX_REMIX_PRICE_INR) return { ok: false, priceInr: 0, reason: `The maximum price is ₹${MAX_REMIX_PRICE_INR}.` };
  return { ok: true, priceInr: n };
}

/** The exact split of one sale. Paisa-precise: 80% of a whole-rupee price has at most 2 decimals. */
export function splitRemixPrice(priceInr: number): { creatorInr: number; platformInr: number } {
  const creatorInr = Math.round(priceInr * CREATOR_SHARE * 100) / 100;
  return { creatorInr, platformInr: Math.round((priceInr - creatorInr) * 100) / 100 };
}

/**
 * THE UNDERCUT RULE (admin, 2026-08-15, replacing the flat re-list ban): a buyer MAY re-list a paid
 * remix — but NEVER at or below the original creator's price, however much they edited it. Admin
 * verbatim: "user B ka selling price hamesha user A se jyada hoga, chahe woh kitna bhi edit kar le."
 *
 * WHY a floor instead of a ban: a ban kills legitimate value-add (B buys A's billing app, builds a
 * pharmacy edition on it, sells the BIGGER thing) — while the floor kills exactly the abuse (B buys
 * A's ₹99 app and re-lists it at ₹49, or free, gutting A's market with A's own work). The floor is
 * the parent's CURRENT price, checked at every moment B sets a price — and "free" is the ultimate
 * undercut, so a paid remix can never be listed free either.
 *
 * Lineage makes this unavoidable rather than advisory: the parent travels with the workspace from
 * the moment of remix (recordRemixOrigin), so no amount of editing detaches it. Chains compose — C's
 * remix of B's listing floors against B, whose price already floors against A.
 */
export function resalePriceCheck(candidateInr: number, parentPriceInr: number): { ok: boolean; reason?: string } {
  if (parentPriceInr <= 0) return { ok: true }; // a FREE app's remix may price freely — that loop is the store's engine
  if (candidateInr <= parentPriceInr) {
    return {
      ok: false,
      reason: `This app is a paid remix — its price must be HIGHER than the original creator's current ₹${parentPriceInr} (that includes free). Selling someone's work cheaper than they do isn't allowed, however much you've changed it.`,
    };
  }
  return { ok: true };
}

/** The lowest lawful listing price for a paid remix: one rupee above the original. */
export function resalePriceFloor(parentPriceInr: number): number {
  return parentPriceInr + 1;
}

/** One purchase per buyer per app, forever — the doc id IS the idempotency. */
export function purchaseDocId(appId: string, buyerUid: string): string {
  return `${appId}__${buyerUid}`;
}

const PURCHASES = 'nav_store_purchases';
const PENDING_CREDITS = 'nav_store_pending_credits';

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

export async function hasPurchased(appId: string, buyerUid: string): Promise<boolean> {
  const d = db();
  if (!d) return false;
  try {
    return (await d.collection(PURCHASES).doc(purchaseDocId(appId, buyerUid)).get()).exists;
  } catch {
    return false;
  }
}

/**
 * The buyer's spendable balance covers the price? `null` balance (unreadable) FAILS CLOSED here —
 * deliberately the opposite of the build gate's fail-open. A build blocked on an infra blip strands
 * real work; a purchase blocked on one costs a retry. Charging someone whose balance we could not
 * read is the worse error.
 */
export async function canAffordRemix(buyerUid: string, priceInr: number): Promise<{ ok: boolean; reason?: string }> {
  const d = db();
  if (!d) return { ok: false, reason: 'The wallet is unavailable right now — try again in a moment.' };
  try {
    const snap = await d.collection('user_token_wallets').doc(buyerUid).get();
    const w = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    const bal = typeof w?.remaining_balance === 'number' && Number.isFinite(w.remaining_balance) ? w.remaining_balance : null;
    const tok = typeof w?.tokenBalance === 'number' && Number.isFinite(w.tokenBalance) ? w.tokenBalance / TOKENS_PER_RUPEE : null;
    // The same unified read the build gate uses: EITHER view showing money counts (the gift-token
    // lesson — a wallet holding 50,000 gifted tokens with ₹0 in the other field is not empty).
    const spendable = Math.max(bal ?? -Infinity, tok ?? -Infinity);
    if (!Number.isFinite(spendable)) return { ok: false, reason: 'Your wallet has no balance yet — add money first (Wallet → Recharge).' };
    if (spendable < priceInr) return { ok: false, reason: `This remix costs ₹${priceInr}; your wallet has ₹${Math.max(0, Math.floor(spendable))}. Add money first (Wallet → Recharge).` };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'The wallet is unavailable right now — try again in a moment.' };
  }
}

export interface RemixSettlement {
  charged: boolean;
  creatorCredited: boolean;
  /** Honest note when something in the money path degraded (never blocks the delivered remix). */
  note?: string;
}

/**
 * Settle one paid remix AFTER the files were delivered.
 *
 * Order inside: record the purchase → debit the buyer → credit the creator. The purchase record goes
 * FIRST because it is the idempotency anchor (transactional create — a concurrent double-tap loses
 * the race and is treated as already-owned, charging nothing). A debit failure after delivery means
 * the buyer got the remix free — the platform's standing "working result or free" law, applied here
 * on purpose rather than clawing back a delivered snapshot.
 */
export async function settleRemixPurchase(input: {
  appId: string;
  appName: string;
  buyerUid: string;
  creatorUid: string;
  priceInr: number;
}): Promise<RemixSettlement> {
  const d = db();
  if (!d) return { charged: false, creatorCredited: false, note: 'wallet unavailable — delivered free' };
  const { appId, appName, buyerUid, creatorUid, priceInr } = input;
  const { creatorInr } = splitRemixPrice(priceInr);
  const ref = `store_remix_${purchaseDocId(appId, buyerUid)}`;

  // 1) The purchase record — transactional create so exactly ONE settlement can ever exist.
  try {
    const docRef = d.collection(PURCHASES).doc(purchaseDocId(appId, buyerUid));
    const created = await d.runTransaction(async (t) => {
      const existing = await t.get(docRef);
      if (existing.exists) return false;
      t.set(docRef, { appId, buyerUid, creatorUid, priceInr, creatorInr, at: Date.now() });
      return true;
    });
    if (!created) return { charged: false, creatorCredited: false, note: 'already owned — no charge' };
  } catch {
    // If we cannot even record the purchase, we must not charge for it.
    return { charged: false, creatorCredited: false, note: 'purchase record failed — delivered free' };
  }

  // 2) Debit the buyer — the same idempotent path every build charge takes.
  const debit = await debitWalletForBuild(d, buyerUid, {
    billedInr: priceInr,
    buildRef: ref,
    // White-label + ledger honesty: the row names the APP the user bought, never internals.
    description: `Nav App Store — remix of "${appName}" (non-refundable)`,
  });
  if (!debit.ok) {
    return { charged: false, creatorCredited: false, note: 'debit failed after delivery — remix delivered free (working result or free)' };
  }

  // 3) Credit the creator's wallet with their 80% — same doc shape, additive, idempotent by ref.
  try {
    const creatorRef = d.collection('user_token_wallets').doc(creatorUid);
    await d.runTransaction(async (t) => {
      const snap = await t.get(creatorRef);
      const w = snap.exists ? (snap.data() as Record<string, any>) : { userId: creatorUid, tokenBalance: 0, remaining_balance: 0, walletLedger: [] };
      const ledger: Array<Record<string, unknown>> = Array.isArray(w.walletLedger) ? w.walletLedger : [];
      if (ledger.some((e) => e && (e as { ref?: unknown }).ref === ref)) return; // already credited
      const tokens = Math.round(creatorInr * TOKENS_PER_RUPEE);
      w.tokenBalance = (typeof w.tokenBalance === 'number' ? w.tokenBalance : 0) + tokens;
      w.remaining_balance = Math.round(((typeof w.remaining_balance === 'number' ? w.remaining_balance : 0) + creatorInr) * 100) / 100;
      ledger.push({ type: 'credit', ref, amountInr: creatorInr, tokens, description: `Nav App Store — your app "${appName}" was remixed`, at: new Date().toISOString() });
      w.walletLedger = ledger.slice(-500);
      t.set(creatorRef, w);
    });
    return { charged: true, creatorCredited: true };
  } catch {
    // NEVER silently lose the creator's share. The pending row is the reconciliation trail.
    try {
      await d.collection(PENDING_CREDITS).add({ appId, creatorUid, creatorInr, ref, at: Date.now() });
    } catch { /* even the trail failed — the purchase doc above still proves the sale */ }
    return { charged: true, creatorCredited: false, note: 'creator credit pending — recorded for reconciliation' };
  }
}
