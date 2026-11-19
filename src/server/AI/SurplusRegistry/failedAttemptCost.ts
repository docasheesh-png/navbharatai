// Q-2920 / Q-2931 (failedbr #2449/#2450/#2475; admin decision 2026-11-19, option a). A Surplus attempt that FAILED and
// was retried is reported through `onTurnComplete` with zero tokens. That is not "a provider that answered without
// reporting usage" — it did not answer. Its cost lives on its receipt. PURE; reporting only — it never changes a bill.
import type { SurplusReceiptDecision } from './receiptPolicy';

/**
 * null — not a failed attempt (judge it as before);
 * 'known' — a failed attempt whose receipt carries a provider-reported actual cost (nothing to warn about);
 * 'unknown' — a failed attempt with no reported cost (unmeasured, never zero).
 */
export function failedAttemptCostVerdict(usage: { failedAttempt?: boolean; surplusReceipt?: SurplusReceiptDecision } | null | undefined): 'known' | 'unknown' | null {
  if (!usage || usage.failedAttempt !== true) return null;
  const r = usage.surplusReceipt;
  return r && r.expenseEvidence === 'provider-reported-actual' && r.actualCostUsd !== null && r.actualCostUsd !== undefined ? 'known' : 'unknown';
}
