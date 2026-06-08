import React, { useState } from 'react';

// Declare Cashfree type
declare global {
  interface Window {
    Cashfree: any;
  }
}

export const CheckoutButton: React.FC = () => {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);

    try {
      // 1. Create order on backend
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderAmount: 100, // Example amount
          customerId: 'cust_123',
          customerPhone: '9999999999'
        }),
      });

      const orderData = await res.json();
      const paymentSessionId = orderData.payment_session_id;

      // 2. Load SDK and Initialize
      const script = document.createElement('script');
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      script.onload = () => {
        const cashfree = new window.Cashfree();
        cashfree.checkout({
          paymentSessionId: paymentSessionId,
        });
        setLoading(false);
      };
      document.body.appendChild(script);

    } catch (error) {
      console.error('Checkout failed:', error);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleCheckout}
      className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      disabled={loading}
    >
      {loading ? 'Processing...' : 'Pay with Cashfree'}
    </button>
  );
};
