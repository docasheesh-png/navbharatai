// AgentV3 — the single pure decision point for the paid-public build gate (admin plan 2026-07-06).
//
// Composes the three inputs the route gathers (the master flag, the free-list status, the wallet balance
// vs the pre-flight estimate) into ONE affordability decision, so the route stays a thin call and the
// full branch matrix is unit-tested here. Reuses Affordability.decideAffordability for the money math —
// this module only adds the two "skip the gate entirely" short-circuits that come BEFORE billing:
//   1. flag OFF  → proceed (today's exact behavior; the money path is inert).
//   2. free-list → proceed (admin/testers are never billed).
//   3. balance unknown (null: Firestore blip / wallet not yet created) → proceed (FAIL-OPEN — never block
//      a build on infra failure or a not-yet-materialized wallet; the overdraft + post-build settlement
//      absorb it).
// Only once past those does it run the real proceed/economy/block affordability rules.

import { decideAffordability, type AffordabilityDecision } from './Affordability';

export interface PaidGateInput {
  /** Master switch (AGENTV3_PAID_PUBLIC). When false the gate is inert. */
  paidPublicEnabled: boolean;
  /** VERIFIED free-list membership (admin/testers → never billed). */
  isFreeUser: boolean;
  /** Wallet balance in ₹, or null when it can't be determined (→ fail-open proceed). */
  balanceInr: number | null;
  /** Pre-flight estimated billed cost of THIS build, in ₹. */
  estimateInr: number;
  /** Overdraft tolerance in ₹ (positive); the block floor is -overdraft. */
  overdraftInr: number;
}

/**
 * Decide whether a paid-public v5.0 build may start, and on which engine. Pure. See the module header
 * for the short-circuit order. Never throws.
 */
export function decidePaidGate(input: PaidGateInput): AffordabilityDecision {
  if (!input.paidPublicEnabled) return { action: 'proceed', reason: 'gate-off' };
  if (input.isFreeUser) return { action: 'proceed', reason: 'free-list' };
  if (input.balanceInr === null) return { action: 'proceed', reason: 'balance-unknown' };
  return decideAffordability({
    isFreeUser: false,
    balance: input.balanceInr,
    estimate: input.estimateInr,
    overdraft: input.overdraftInr,
  });
}
