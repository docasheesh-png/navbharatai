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
      startCheckout(sessionId, environment);
    };
    document.body.appendChild(script);
  }
};
