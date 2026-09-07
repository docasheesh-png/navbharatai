// Google Play Billing — the NATIVE bridge. Pure decisions live in storePurchase.ts; this file is
// only the wire to the Android plugin (PlayBillingPlugin.java), and it is a no-op everywhere else.
//
// Mirrors metaNativeConsent.ts exactly: dynamic `@capacitor/core` import, a native-platform guard,
// `registerPlugin<Interface>('PlayBilling')`, every call try/caught into a NAMED outcome rather than
// a thrown error. An older installed shell (an .aab built before this plugin existed) simply answers
// "unavailable", which `purchaseRail` then reads as "keep using the web rail" — so shipping this
// cannot strand a user who has not updated.

import type { PurchaseOutcome } from './storePurchase';

/** What Google's purchase sheet reported. `pending` is a real Play state (e.g. cash-at-store in India). */
export interface NativePurchase {
  status: 'purchased' | 'cancelled' | 'pending' | 'failed' | 'unavailable';
  purchaseToken?: string;
  orderId?: string;
  productId?: string;
  /** Google's own message, for the SERVER log — never rendered verbatim to a user. */
  message?: string;
}

interface PlayBillingPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  purchase(options: { productId: string }): Promise<NativePurchase>;
  /** Purchases Google still considers undelivered — the crash/offline safety net. */
  queryPurchases(): Promise<{ purchases: Array<{ purchaseToken: string; productId: string; orderId?: string }> }>;
  /** Consume AFTER our server has credited — never before. See buyStorePack in usePaymentEngine. */
  consume(options: { purchaseToken: string }): Promise<{ consumed: boolean }>;
}

let cached: PlayBillingPlugin | null = null;

/** The plugin handle, or null on web / an older shell that never registered it. Never throws. */
async function plugin(): Promise<PlayBillingPlugin | null> {
  if (cached) return cached;
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform() !== true) return null;
    cached = registerPlugin<PlayBillingPlugin>('PlayBilling');
    return cached;
  } catch {
    return null;
  }
}

/**
 * Can this device actually buy through Play right now? Answers false — never throws — on the web, on
 * an older shell, on a device with no Play Store, and when Google's billing service refuses to
 * connect. `purchaseRail` uses this to decide whether to offer the Play rail at all.
 */
export async function playBillingAvailable(): Promise<boolean> {
  try {
    const p = await plugin();
    if (!p) return false;
    const res = await p.isAvailable();
    return res?.available === true;
  } catch {
    return false;
  }
}

/** Launch Google's purchase sheet for one product. Resolves with a NAMED status, never a throw. */
export async function launchPlayPurchase(productId: string): Promise<NativePurchase> {
  try {
    const p = await plugin();
    if (!p) return { status: 'unavailable' };
    return await p.purchase({ productId });
  } catch (e) {
    return { status: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Purchases Google has NOT seen us consume yet.
 *
 * WHY THIS IS NOT OPTIONAL. A user pays, then the network drops before our verify call lands. Google
 * has their money; our wallet has nothing. Without this sweep the only thing that would eventually
 * happen is Google auto-refunding after three days — i.e. the user is made whole by Google, having
 * had a broken experience that we never noticed. With it, the credit simply appears the next time
 * they open the app. The server's verify route is idempotent on the store transaction id, so
 * replaying a purchase that WAS already credited adds nothing.
 */
export async function pendingPlayPurchases(): Promise<Array<{ purchaseToken: string; productId: string; orderId?: string }>> {
  try {
    const p = await plugin();
    if (!p) return [];
    const res = await p.queryPurchases();
    return Array.isArray(res?.purchases) ? res.purchases : [];
  } catch {
    return [];
  }
}

/**
 * Tell Google the goods were delivered, so the product can be bought again.
 *
 * 🔒 ORDERING IS THE WHOLE SAFETY PROPERTY: consume only AFTER our server has credited the wallet.
 * Consuming first and failing to credit would erase Google's record of a purchase the user paid for
 * — unrecoverable. Crediting first and failing to consume leaves the purchase replayable, which the
 * idempotent verify route absorbs harmlessly. One order loses money; the other cannot.
 */
export async function consumePlayPurchase(purchaseToken: string): Promise<boolean> {
  try {
    const p = await plugin();
    if (!p) return false;
    const res = await p.consume({ purchaseToken });
    return res?.consumed === true;
  } catch {
    return false;
  }
}

/** Map a native status to the user-facing outcome for the statuses the bridge can decide alone. */
export function outcomeForNativeStatus(status: NativePurchase['status']): PurchaseOutcome | null {
  switch (status) {
    case 'cancelled': return 'cancelled';
    case 'failed': return 'failed';
    case 'unavailable': return 'unavailable';
    // `pending` (Play's deferred payment) and `purchased` both need the SERVER's answer before any
    // outcome can honestly be claimed — the caller continues to verification.
    default: return null;
  }
}
