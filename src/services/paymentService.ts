/**
 * Payment Service — starting a checkout.
 *
 * 🔴 WHY THIS FILE HAS TWO PATHS (admin report 2026-09-20/21). On the WEB the gateway's JavaScript
 * SDK is loaded into the page and started there, exactly as it always has been. In the ANDROID app
 * that cannot work, and no console setting can make it work:
 *
 *   the app is a Capacitor shell in BUNDLED mode, so its WebView origin is `https://localhost`; the
 *   JS SDK identifies its merchant by PAGE ORIGIN; and nobody can own or whitelist `localhost`.
 *
 * The admin whitelisted the app package `com.navbharat.ai` — APPROVED — and the error was unchanged,
 * because the JS SDK never sends a package name. The full reasoning lives beside the fix, in
 * `src/server/lib/checkoutHandoff.ts`.
 *
 * 🔑 So the native shell hands the checkout to the SYSTEM BROWSER, pointed at our own `/pay` page on
 * `navbharatai.com` — an origin the gateway has already approved. The SDK then runs where it is
 * allowed to run.
 *
 * 🔒 MONEY IS NOT AT RISK IN THE HAND-OFF, which is what makes this safe to do. The order already
 * exists server-side before any of this runs, and three independent paths credit it: the gateway's
 * webhook, the return redirect, and reconcile-on-sign-in. A user who pays in the browser and never
 * comes back is still credited on their next visit to the app — that safety net was built for the
 * UPI user who closes the app mid-payment, and it covers this case unchanged.
 */

import { Browser } from '@capacitor/browser';
import { isNativeShell, NATIVE_API_ORIGIN } from '../lib/apiBase';
import { checkoutHandoffUrl, checkoutMode } from '../server/lib/checkoutHandoff';

/** The web path: load the SDK into THIS page and start it here. Unchanged behaviour. */
export const startCheckout = (sessionId: string, environment?: string) => {
  try {
    const isTestSession = sessionId.includes('_test_') || sessionId.startsWith('TEST') || sessionId.toLowerCase().includes('test') || sessionId.toLowerCase().includes('sim');
    const mode = environment || (isTestSession ? 'sandbox' : 'production');

    console.log('Initializing payment SDK under Mode:', mode);
    const cashfree = (window as any).Cashfree({
      mode: mode
    });

    cashfree.checkout({
      paymentSessionId: sessionId,
      redirectTarget: "_self"
    });
  } catch (e: any) {
    console.error('Payment SDK initiation failed:', e);
    // Alert is discouraged, but maintaining requested functionality for now
    window.alert('Failed to boot the secure payment gateway: ' + e.message);
  }
};

/**
 * Should this runtime hand the checkout to the system browser instead of running it in-page? PURE,
 * so the decision is testable without a device.
 *
 * ⚠️ It is `isNativeShell` AND an origin that is not already ours. A hypothetical HOSTED native shell
 * (WebView origin = navbharatai.com) is ALREADY on an approved origin and must keep the in-page path
 * — handing it to the browser would add a jarring app-exit for no reason at all. This is the same
 * two-part test `needsApiRewrite` makes, for the same underlying reason.
 */
export function shouldHandOffCheckout(nativeShell: boolean, currentOrigin: string, apiOrigin: string = NATIVE_API_ORIGIN): boolean {
  return nativeShell && currentOrigin !== apiOrigin;
}

/** The gateway's own SDK. A third-party origin, so `index.html` preconnects to it. */
const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

/** One in-flight load, shared. `null` again after a FAILURE so a retry is really a retry. */
let sdkLoad: Promise<boolean> | null = null;
/** True when the last attempt failed to ARRIVE (network/blocked), as against arriving broken. */
let sdkFailedToArrive = false;

/**
 * LOAD THE CHECKOUT SDK, ONCE — and off the critical path.
 *
 * 🔴 WHY THIS IS SEPARATE FROM `triggerCashfreeCheckout` (admin 2026-09-21: *"button press aur
 * cashfree page par jane me 5-10 second lag rhe, hamare page par hi"*). The purchase used to be
 * strictly SERIAL and needlessly so:
 *
 *     click → await POST /api/payment/create-order   (our server → the gateway's orders API)
 *           → THEN create <script src=sdk…>          (cold DNS + TLS + download)
 *           → THEN checkout()
 *
 * **The SDK does not need the session id.** Nothing about downloading it depends on the order
 * existing, so it was queued behind a network round trip for no reason and the user watched our
 * own page for the sum of the two. `warmCheckout()` starts this at the moment the purchase begins,
 * so the download overlaps the order call instead of following it.
 *
 * 🔒 IDEMPOTENT BY CONSTRUCTION, which is what makes it safe to call from anywhere: repeated calls
 * share ONE promise and ONE `<script>` tag. Calling it and then pressing Purchase does not fetch
 * twice, and a second press while the first is still in flight joins the same load.
 *
 * ⚠️ A FAILED load clears the memo, deliberately. Caching "it failed" would turn one bad moment on
 * a train into a permanently dead Purchase button for the rest of the session; the user's retry
 * must be allowed to be a real retry. A SUCCESSFUL load is cached for ever — the global is there.
 */
export function preloadCheckoutSdk(): Promise<boolean> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return Promise.resolve(false);
  if (typeof (window as any).Cashfree === 'function') return Promise.resolve(true);
  if (sdkLoad) return sdkLoad;

  sdkLoad = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => {
      const ok = typeof (window as any).Cashfree === 'function';
      sdkFailedToArrive = false;
      if (!ok) sdkLoad = null;   // arrived broken — let a retry try again
      resolve(ok);
    };
    script.onerror = () => {
      sdkFailedToArrive = true;
      sdkLoad = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return sdkLoad;
}

/**
 * Start warming the checkout the moment a purchase begins, in PARALLEL with creating the order.
 *
 * 🔒 It deliberately does nothing on the native shell: there the checkout is handed to the system
 * browser (`shouldHandOffCheckout`), which never touches this SDK — so downloading it inside the
 * WebView would spend a mobile user's data on a script that can never run. The native/web decision
 * lives HERE rather than at the call site, so a fifth screen that starts a top-up cannot get it
 * wrong; the caller only has to say "a purchase is starting".
 *
 * Fire-and-forget on purpose: a warm-up that could reject would make a caller handle an error for
 * an optimisation, and the real load is awaited later by `triggerCashfreeCheckout` anyway.
 */
export function warmCheckout(): void {
  const native = (() => {
    try { return isNativeShell(window as any); } catch { return false; }
  })();
  if (native && shouldHandOffCheckout(native, window.location.origin)) return;
  void preloadCheckoutSdk();
}

export const triggerCashfreeCheckout = (sessionId: string, environment?: string) => {
  const native = (() => {
    try { return isNativeShell(window as any); } catch { return false; }
  })();

  if (shouldHandOffCheckout(native, window.location.origin)) {
    const url = checkoutHandoffUrl(NATIVE_API_ORIGIN, sessionId, checkoutMode(environment));
    // `Browser.open` is the system browser (Custom Tab on Android), NOT another WebView — a WebView
    // would carry the same unusable origin and change nothing.
    Browser.open({ url }).catch((e: unknown) => {
      console.error('Could not open the system browser for checkout:', e);
      window.alert('Could not open the secure payment page. Please check your connection and try again.');
    });
    return;
  }

  void preloadCheckoutSdk().then((ready) => {
    if (ready) {
      startCheckout(sessionId, environment);
    } else if (sdkFailedToArrive) {
      // Without this a blocked/failed SDK load (CSP, network, ad-blocker) fails SILENTLY — the
      // "Purchase" button appears to do nothing. Surface the real reason, never a dead end.
      console.error('Payment SDK failed to load from the gateway (blocked or offline).');
      window.alert('Could not load the secure payment gateway. Check your connection or any content/script blocker, then try again.');
    } else {
      // The script tag resolved but the global is not a function (a partial or tampered load).
      window.alert('Payment gateway could not initialize. Please retry, or disable any script blocker and try again.');
    }
  });
};
