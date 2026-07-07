// AgentV3 — pre-flight AFFORDABILITY decision for paid public v3.0 builds (admin plan 2026-07-06).
//
// The rules the admin locked (verbatim intent):
//   • FREE-LIST (the 3 admin/tester accounts) → PROCEED exactly as today. No billing gate, no routing
//     change — their experience is untouched.
//   • balance ≥ estimate → PROCEED exactly as today. Nothing new; the normal engine/routing runs.
//   • floor < balance < estimate → PROCEED but on the ECONOMY engine (cheap provider), with an honest
//     "low balance — economy engine" notice, so a low-budget user's work is NEVER stopped.
//   • balance ≤ floor → BLOCK with "add credits". This is the ONE place a build is refused.
//
// KEY design guarantees this module encodes:
//   • The check happens BEFORE a build starts. Once a build is allowed to start it runs to completion —
//     this module never kills a build mid-way (settlement on the ACTUAL cost happens afterwards).
//   • GRACEFUL OVERDRAFT: `floor = -overdraft` (a small tolerance, ~₹20-equivalent). A build whose real
//     cost slightly overruns its estimate simply pushes the balance a little negative; the account is
//     then blocked for the NEXT build until top-up. This absorbs the unavoidable inaccuracy of a
//     pre-build cost estimate — it is the core of the design, not a patch.
// Pure + fully unit-tested. `balance`, `estimate`, `overdraft` are all in the SAME currency unit (the
// caller picks — e.g. INR from the wallet, or USD; this module never mixes units).

export type AffordabilityAction = 'proceed' | 'economy' | 'block';

export interface AffordabilityInput {
  /** Admin/tester free-list (verified identity). Free-list users bypass billing entirely. */
  isFreeUser: boolean;
  /** Current wallet balance (may be negative, within the overdraft tolerance). Same unit as estimate. */
  balance: number;
  /** Pre-flight estimated billed cost of THIS build (from the prompt/complexity). Same unit as balance. */
  estimate: number;
  /** Overdraft tolerance as a POSITIVE amount; the block floor is `-overdraft`. Default small (~₹20). */
  overdraft: number;
}

export interface AffordabilityDecision {
  action: AffordabilityAction;
  /** Machine reason (telemetry): 'free-list' | 'covers-estimate' | 'low-balance-economy' | 'below-floor'. */
  reason: string;
  /** User-facing notice — set for 'economy' (honest low-balance message) and 'block' (add-credits). */
  notice?: string;
}

/**
 * Decide whether a paid public v3.0 build may start, and on which engine. Pure. See the module header
 * for the exact rules. A non-finite/negative overdraft is treated as 0 (no tolerance).
 */
export function decideAffordability(input: AffordabilityInput): AffordabilityDecision {
  const { isFreeUser, balance, estimate } = input;
  const overdraft = Number.isFinite(input.overdraft) && input.overdraft > 0 ? input.overdraft : 0;
  const floor = -overdraft;

  // 1. Free-list (admin/testers) → exactly as today. No gate at all.
  if (isFreeUser) return { action: 'proceed', reason: 'free-list' };

  // 2. Already at/below the overdraft floor → the ONE place we refuse a build.
  if (balance <= floor) {
    return {
      action: 'block',
      reason: 'below-floor',
      notice: 'Your credits are used up. Add credits to start a new build — any build already running is unaffected.',
    };
  }

  // 3. Enough for the estimate → proceed exactly as today (no routing change).
  if (balance >= estimate) return { action: 'proceed', reason: 'covers-estimate' };

  // 4. Low balance but still above the floor → build on the economy engine so the work isn't stopped.
  return {
    action: 'economy',
    reason: 'low-balance-economy',
    notice: 'Low balance — building on the economy engine to keep your work going. Add credits for the full engine.',
  };
}
