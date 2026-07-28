// Professional Pass — client helpers (admin 2026-07-15). Fetches the current user's pass/quota state
// and starts the ₹99/month Pass purchase, reusing the SAME Cashfree checkout the wallet recharge uses.

import axios from 'axios';
import { triggerCashfreeCheckout } from '../../services/paymentService';
import { auth } from '../../lib/firebase';
import { authedHeaders } from '../../App';

export interface PassStatus {
  enabled: boolean;
  signedIn: boolean;
  freeListed?: boolean;
  unlimited: boolean;
  hasPass: boolean;
  passExpiresAt?: string | null;
  plan?: string | null;
  freeDailyLimit: number;
  usedToday: number;
  remainingFree: number;
  priceInr: number;
  passDays: number;
}

/** The current user's Professional Pass + free-quota state, or null if the endpoint is unreachable. */
export async function fetchPassStatus(): Promise<PassStatus | null> {
  try {
    const res = await fetch('/api/professional/pass/status', { headers: await authedHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as PassStatus;
  } catch {
    return null;
  }
}

/**
 * Start the Professional Pass purchase. Creates a Cashfree order tagged as a professional_pass product
 * (server grants the pass on payment) and opens the same secure checkout the wallet recharge uses. In
 * the dev simulator (no real gateway) it verifies inline so the pass is granted for local testing.
 * Returns 'redirecting' (real gateway opened) or 'granted' (simulator). Throws if not signed in.
 */
export async function buyProfessionalPass(priceInr: number, passDays: number): Promise<'redirecting' | 'granted'> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in to buy the Professional Pass.');
  // The server derives BOTH the owner (from this token) and the number of days (from the amount it
  // verifies with the gateway) — `passDays` is sent only as a record of what the screen offered.
  const res = await axios.post('/api/payment/create-order', {
    amount: priceInr,
    userEmail: user.email || '',
    userName: user.displayName || 'NavBharat Client',
    productType: 'professional_pass',
    passPlan: 'monthly',
    passDays,
  }, { headers: await authedHeaders() });
  if (res.data?.isSimulator) {
    // Dev only: no real gateway — verify directly so the pass is granted for testing.
    await axios.post('/api/payment/verify-payment', { orderId: res.data.orderId });
    return 'granted';
  }
  triggerCashfreeCheckout(res.data.paymentSessionId, res.data.environment);
  return 'redirecting';
}
