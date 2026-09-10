// THE PLATFORM FEE — the SERVER's env-bound wrapper.
//
// All the arithmetic, and every word of the reasoning behind it, lives in the shared pure module
// (src/lib/platformFee.ts) so the browser can show the user the exact split this server will apply.
// This file adds one thing and only one thing: where the rate comes from on the server.
import {
  DEFAULT_PLATFORM_FEE_PCT,
  MAX_PLATFORM_FEE_PCT,
  normalizeFeePct,
  splitPaymentAtPct,
  platformFeeNoticeAtPct,
  type PaymentSplit,
} from '../../lib/platformFee';

export { DEFAULT_PLATFORM_FEE_PCT, MAX_PLATFORM_FEE_PCT };
export type { PaymentSplit };

/** The configured rate. `PLATFORM_FEE_PCT` in Cloud Run; unset means the admin-confirmed default. */
export function platformFeePct(env: NodeJS.ProcessEnv = process.env): number {
  return normalizeFeePct(env.PLATFORM_FEE_PCT);
}

/** Split a payment into our fee and the credit that reaches the wallet, at this server's rate. */
export function splitPayment(paidInr: number, env: NodeJS.ProcessEnv = process.env): PaymentSplit {
  return splitPaymentAtPct(paidInr, platformFeePct(env));
}

/** The line shown to the user before they pay. */
export function platformFeeNotice(paidInr: number, env: NodeJS.ProcessEnv = process.env): string {
  return platformFeeNoticeAtPct(paidInr, platformFeePct(env));
}
