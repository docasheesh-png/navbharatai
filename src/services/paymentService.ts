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

  if ((window as any).Cashfree) {
    startCheckout(sessionId, environment);
  } else {
    const script = document.createElement('script');
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => {
      // Guard: if the script tag resolved but the global still isn't a function (blocked/partial
      // load), don't call into `undefined` and die silently — surface an honest error instead.
      if (typeof (window as any).Cashfree === 'function') {
        startCheckout(sessionId, environment);
      } else {
        window.alert('Payment gateway could not initialize. Please retry, or disable any script blocker and try again.');
      }
    };
    // Without onerror a blocked/failed SDK load (CSP, network, ad-blocker) fails SILENTLY — the
    // "Purchase" button appears to do nothing. Surface the real reason so it is never a silent dead-end.
    script.onerror = () => {
      console.error('Payment SDK failed to load from the gateway (blocked or offline).');
      window.alert('Could not load the secure payment gateway. Check your connection or any content/script blocker, then try again.');
    };
    document.body.appendChild(script);
  }
};
