// WHAT THE ADMIN SCREENS READ FROM WHOLE COLLECTIONS — and nothing more (performance audit 2026-10-11, D6).
//
// The admin analytics, users and purchases screens read EVERY wallet, and analytics reads every chat log ever
// written. A wallet document carries its 500-entry ledger, so a full read moved hundreds of KB per user through
// the same instance that serves users, only to use a dozen scalar fields. These are those fields; the routes
// read them with `select(...)`. `tests/adminReadsAreBounded.test.ts` runs the real readers (lifetime totals,
// the paid filter) on a projected wallet and checks they answer exactly as on the full one, so a reader that
// starts using a new field fails the test instead of silently reading `undefined`.

/** Every wallet field the admin screens and their helpers read. NOT the ledger. */
export const WALLET_SUMMARY_FIELDS = [
  'userId', 'userEmail', 'userName', 'remaining_balance', 'tokenBalance',
  'totalTokensUsed', 'total_output_tokens_used', 'totalTokensPurchased',
  'totalMoneySpent', 'total_money_spent', 'lastRechargeAt', 'banned', 'createdAt', 'updatedAt',
] as const;

/** Every `ai_usage_logs` field the analytics rollup (`summariseUsage` + the page) reads. */
export const USAGE_LOG_FIELDS = [
  'userId', 'createdAt', 'providerName', 'modelName', 'inputTokens', 'outputTokens', 'latencyMs', 'usageMeasured',
] as const;

/** A document reduced to the listed fields — what a `select(...)` returns. PURE (tests use it). */
export function project<T extends Record<string, unknown>>(doc: T, fields: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in doc) out[f] = doc[f];
  return out as Partial<T>;
}

/**
 * Today's revenue from today's orders: SUCCESS rows whose time — an epoch number OR an ISO string, both exist —
 * is at or after `fromMs`. The old badge parsed the ISO string with `Number()`, got NaN, and showed ₹0. PURE.
 */
export function revenueToday(rows: ReadonlyArray<Record<string, unknown>>, fromMs: number): number {
  let sum = 0;
  for (const tx of rows) {
    if (tx.paymentStatus !== 'SUCCESS') continue;
    const raw = tx.createdAt ?? tx.created_at;
    const at = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    if (Number.isFinite(at) && at >= fromMs) sum += Number(tx.amountPaid) || 0;
  }
  return sum;
}
