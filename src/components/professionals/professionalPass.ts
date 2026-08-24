// The professionals' daily free-allowance state — client helper.
//
// ADMIN 2026-08-10: "pass system hata do." This file used to ALSO start a ₹99/month "Professional
// Pass" purchase through Cashfree. That product is gone, and the purchase function with it — a screen
// that can open a checkout for something we do not sell is a promise the app cannot keep.
//
// WHY THE PASS WENT, in one line: it was a SECOND billing model competing with the one the platform
// actually adopted. THE ONE-WALLET LAW (2026-08-01) says every AI draws on the same balance and "the
// price of the thing IS the limit" — a flat monthly pass sits on top of that as a parallel promise of
// "unlimited", which the wallet cannot honour and the user should not have to reason about.
//
// What survives is the free-allowance COUNTER, which is real: it tells a signed-in user how many free
// messages they have left today. The response still carries `hasPass`/`priceInr`/`passDays` because
// the server endpoint is unchanged for now; nothing reads them any more.

import { authedHeaders } from '../../lib/authHeaders';
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

/** The current user's free-allowance state, or null if the endpoint is unreachable. */
export async function fetchPassStatus(): Promise<PassStatus | null> {
  try {
    const res = await fetch('/api/professional/pass/status', { headers: await authedHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as PassStatus;
  } catch {
    return null;
  }
}
