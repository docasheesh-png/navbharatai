// Which of a user's unfinished payments are worth re-checking with Cashfree (admin 2026-08-01).
//
// THE HOLE THIS FILLS. A Cashfree payment reaches the wallet by exactly two routes, and BOTH of them
// can miss:
//
//   1. The WEBHOOK, which Cashfree calls server-to-server. It is rejected outright unless
//      CASHFREE_WEBHOOK_SECRET is configured — the signature cannot be verified without it, and
//      accepting an unverified webhook would let anyone credit their own wallet. So with the secret
//      unset, this route delivers nothing at all.
//   2. The CLIENT REDIRECT, which only fires if the user comes back to the app carrying
//      `?payment=success&order_id=…` in the URL.
//
// So a user who pays by UPI and closes the app — which on a phone is the normal thing to do, because
// the UPI app is a different app — has genuinely paid and is never credited. Their order sits at
// PENDING forever. There was no third path and no sweep: nothing in the codebase ever revisited a
// pending order.
//
// This is that third path. On the user's next visit we ask Cashfree about their own unfinished orders
// and credit the ones that really were paid. It is a SAFETY NET, not a replacement: it needs no
// webhook secret, and it is idempotent because verifyPaymentInternal already short-circuits an order
// that is SUCCESS. Setting the webhook secret is still worth doing — it credits the user in seconds
// instead of on their next visit — but the money no longer depends on it.
//
// Pure — the caller supplies the records and `now`, and performs the verification.

/** The fields this decision needs from a `payment_transactions` doc. */
export interface PendingOrderRecord {
  transactionId?: string;
  paymentStatus?: string;
  /** ISO string, as written by the create-order route. */
  createdAt?: string;
}

/**
 * How long after an order is created it becomes worth asking about.
 *
 * An order created seconds ago is almost certainly still being paid — the user is looking at their UPI
 * app right now — and asking Cashfree about it would just spend a call to be told PENDING. The normal
 * redirect path handles the fast case; this sweep exists for the ones that never came back.
 */
export function reconcileMinAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const mins = Number(env.PAYMENT_RECONCILE_MIN_AGE_MINUTES);
  return Number.isFinite(mins) && mins > 0 ? Math.floor(mins * 60_000) : 2 * 60_000;
}

/**
 * How far back to look. A Cashfree order expires and can no longer be paid, so beyond this window a
 * PENDING record is an abandoned checkout rather than an uncredited payment.
 */
export function reconcileMaxAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.PAYMENT_RECONCILE_MAX_AGE_DAYS);
  return Number.isFinite(days) && days > 0 ? Math.floor(days * 86_400_000) : 7 * 86_400_000;
}

/** Most orders to verify in one sweep — each one is a network call to Cashfree. */
export function reconcileMaxOrders(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PAYMENT_RECONCILE_MAX_ORDERS);
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.floor(n)) : 5;
}

/**
 * Pick the order ids worth verifying, newest first. Pure.
 *
 * Only PENDING records are considered: an order already marked SUCCESS or FAILED has been settled and
 * re-asking would be a wasted call. A record with an unreadable or missing `createdAt` is SKIPPED
 * rather than guessed at — it cannot be placed inside or outside the window, and the cost of skipping
 * is that the user's next visit tries again, while the cost of guessing wrong is a pointless call on
 * every visit forever.
 */
export function ordersToReconcile(
  records: PendingOrderRecord[],
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const minAge = reconcileMinAgeMs(env);
  const maxAge = reconcileMaxAgeMs(env);
  const scored: Array<{ id: string; at: number }> = [];

  for (const r of records || []) {
    if (!r || typeof r.transactionId !== 'string' || !r.transactionId) continue;
    if (String(r.paymentStatus || '').toUpperCase() !== 'PENDING') continue;
    const at = Date.parse(String(r.createdAt ?? ''));
    if (!Number.isFinite(at)) continue;      // unknown age → leave it for next time
    const age = now - at;
    if (age < minAge || age > maxAge) continue;
    scored.push({ id: r.transactionId, at });
  }

  return scored
    .sort((a, b) => b.at - a.at) // newest first: the most likely to be a real, recent payment
    .slice(0, reconcileMaxOrders(env))
    .map((s) => s.id);
}

/**
 * The message the user sees after a sweep.
 *
 * Silence unless something actually landed. A user who simply opened the app must not be told anything
 * about payments, and a sweep that verified three orders and credited none has nothing to report —
 * saying "no payments found" would read as a failure to someone who never paid in the first place.
 * White-label: this names NavBharatAI and never Cashfree or any provider.
 */
export function reconcileMessage(creditedInr: number, orders: number): string | null {
  const amount = Number(creditedInr);
  if (!Number.isFinite(amount) || amount <= 0 || orders <= 0) return null;
  const money = `₹${(Math.round(amount * 100) / 100).toLocaleString('en-IN')}`;
  return orders === 1
    ? `We found a payment of ${money} that had not reached your wallet yet, and added it.`
    : `We found ${orders} payments totalling ${money} that had not reached your wallet yet, and added them.`;
}
