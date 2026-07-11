/**
 * Payment Service - Cashfree Integration
 */

export const startCheckout = (sessionId: string, environment?: string) => {
  try {
    const isTestSession = sessionId.includes('_test_') || sessionId.startsWith('TEST') || sessionId.toLowerCase().includes('test') || sessionId.toLowerCase().includes('sim');
    const mode = environment || (isTestSession ? 'sandbox' : 'production');
    
    console.log('Initializing Cashfree SDK under Mode:', mode);
    const cashfree = (window as any).Cashfree({
      mode: mode
    });
    
    cashfree.checkout({
      paymentSessionId: sessionId,
      redirectTarget: "_self"
    });
  } catch (e: any) {
    console.error('Cashfree SDK initiation failed:', e);
    // Alert is discouraged, but maintaining requested functionality for now
    window.alert('Failed to boot Cashfree dynamic gateway: ' + e.message);
  }
};

export const triggerCashfreeCheckout = (sessionId: string, environment?: string) => {
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
      console.error('Cashfree SDK failed to load from sdk.cashfree.com (blocked or offline).');
      window.alert('Could not load the secure payment gateway. Check your connection or any content/script blocker, then try again.');
    };
    document.body.appendChild(script);
  }
};
