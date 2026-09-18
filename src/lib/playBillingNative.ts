// Google Play Billing — the NATIVE bridge. Pure decisions live in storePurchase.ts; this file is
// only the wire to the Android plugin (PlayBillingPlugin.java), and it is a no-op everywhere else —
// including iOS, which is native but has no such plugin (see isPlayBillingPlatform).
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

/**
 * The only platform this plugin exists on. Exported so the gate is testable without Capacitor.
 *
 * 🔴 IT USED TO ASK "IS THIS NATIVE?" — AND AN iPHONE IS NATIVE (admin Monitor capture, 2026-09-14:
 * `"PlayBilling" plugin is not implemented on ios @ unhandled promise`). So every iOS launch registered
 * the Android-only plugin, called `isAvailable()` on it, and Capacitor threw. Nothing was lost for the
 * user — `purchaseRail` still resolved to the web gateway — but a guaranteed error on every iOS launch
 * is exactly the kind of noise that hides a real one, and this file's own header said "a no-op
 * everywhere else", which was false for the platform that carries half the installed base.
 */
export function isPlayBillingPlatform(platform: string | null | undefined): boolean {
  return String(platform ?? '').trim().toLowerCase() === 'android';
}

/**
 * 🔴 A CAPACITOR PLUGIN PROXY MUST NEVER BE THE RESOLUTION VALUE OF A PROMISE.
 *
 * THE REPORT (user report, 2026-09-15, app build 117, Android 16 WebView):
 *     `"PlayBilling.then()" is not implemented on android @ unhandled promise`
 *
 * **The `.then()` in that message is the whole diagnosis, and no line in this file ever calls it.**
 * `registerPlugin` returns a PROXY that turns any property access into a native method call. This
 * helper was `async` and did `return cached`, so the async machinery — which resolves a returned
 * value by probing it for `.then` to see whether it is a thenable — read `.then` OFF THE PROXY.
 * The proxy dispatched a native call to a method named `then`, Android has no such method, and the
 * promise Capacitor made for it is held by nobody. Hence: unhandled, on every Android launch,
 * whether or not the installed shell carries the plugin at all.
 *
 * ⚠️ `try/catch` could not save it: the probe happens during the RESOLUTION of this function's own
 * promise, and the rejected promise it produces is never awaited. So a file whose header fairly
 * claims "every call try/caught into a NAMED outcome" still shipped a guaranteed unhandled
 * rejection — the guard was real and the leak was upstream of it.
 *
 * 🔎 The header also says this file "mirrors metaNativeConsent.ts exactly". It does not, and the
 * ONE difference is exactly this: that file uses the proxy locally and never returns it.
 * `deviceIntegrityNative.ts` had the identical defect and is fixed in the same change (rule 3).
 *
 * 🔒 THE FIX IS THE WRAPPER, AND IT MUST STAY ONE: the proxy is handed back INSIDE an object, so no
 * promise ever resolves to the proxy and nothing probes it for `.then`.
 */
/** The plugin handle, or null anywhere Play Billing does not exist (web, iOS, an older shell). Never throws. */
async function plugin(): Promise<{ api: PlayBillingPlugin } | null> {
  if (cached) return { api: cached };
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    // Android, not "native": Play Billing is a Google Play service, and iOS has no such plugin.
    if (!isPlayBillingPlatform(Capacitor.getPlatform())) return null;
    cached = registerPlugin<PlayBillingPlugin>('PlayBilling');
    return { api: cached };
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
    const held = await plugin();
    if (!held) return false;
    const res = await held.api.isAvailable();
    return res?.available === true;
  } catch {
    return false;
  }
}

/** Launch Google's purchase sheet for one product. Resolves with a NAMED status, never a throw. */
export async function launchPlayPurchase(productId: string): Promise<NativePurchase> {
  try {
    const held = await plugin();
    if (!held) return { status: 'unavailable' };
    return await held.api.purchase({ productId });
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
    const held = await plugin();
    if (!held) return [];
    const res = await held.api.queryPurchases();
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
    const held = await plugin();
    if (!held) return false;
    const res = await held.api.consume({ purchaseToken });
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
