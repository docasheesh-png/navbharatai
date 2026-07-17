// AgentV3 — pre-flight AFFORDABILITY decision for paid public v5.0 builds (admin plan 2026-07-06).
//
// The rules the admin locked (verbatim intent):
//   • FREE-LIST (the 3 admin/tester accounts) → PROCEED exactly as today. No billing gate, no routing
//     change — their experience is untouched.
//   • balance ≥ estimate → PROCEED exactly as today. Nothing new; the normal engine/routing runs.
//   • 0 < balance < estimate → PROCEED but on the ECONOMY engine (cheap provider), with an honest
//     "low balance — economy engine" notice, so a paying-but-low user's work is NEVER stopped, and the
//     unavoidable inaccuracy of a pre-flight estimate never wrongly refuses a user who has money.
//   • balance ≤ 0 → BLOCK with "add credits". This is the ONE place a build is refused.
//
// KEY design guarantees this module encodes:
//   • The check happens BEFORE a build starts. Once a build is allowed to start it runs to completion —
//     this module never kills a build mid-way (settlement on the ACTUAL cost happens afterwards).
//   • NO FREE BUILDS AT ZERO BALANCE (admin 2026-07-12, "0 balance par bhi app build ho rahi hai —
//     mere paise na khaye"): a build spends NavBharatAI's own paid model budget, so a non-free-list user
//     with NO positive balance is REFUSED. The welcome bonus gives new users a positive balance to spend;
//     once it (and any top-up) is exhausted they must recharge. The block floor is therefore 0 — a
//     balance that is exactly 0 or negative cannot start a new build. This matches the design's own stated
//     intent ("the account is then blocked for the NEXT build until top-up"); the earlier `-overdraft`
//     floor was a bug that granted ~₹20 of free full-price builds before blocking. The overdraft tolerance
//     now lives ONLY where it belongs — the post-build settlement debit, which may push an already-allowed
//     build's balance a little negative; the very next build is then blocked here.
// Pure + fully unit-tested. `balance`, `estimate` are in the SAME currency unit (the caller picks — e.g.
// INR from the wallet, or USD; this module never mixes units).

export type AffordabilityAction = 'proceed' | 'economy' | 'block';

export interface AffordabilityInput {
  /** Admin/tester free-list (verified identity). Free-list users bypass billing entirely. */
  isFreeUser: boolean;
  /** Current wallet balance (may be negative, within the overdraft tolerance). Same unit as estimate. */
  balance: number;
  /** Pre-flight estimated billed cost of THIS build (from the prompt/complexity). Same unit as balance. */
  estimate: number;
  /**
   * DEPRECATED for the start-gate (kept for call-site compatibility). The block floor is now a hard 0 —
   * a non-positive balance always blocks a NEW build. Any overdraft tolerance belongs to the post-build
   * settlement debit, not to starting a build. Ignored here.
   */
  overdraft?: number;
}

export interface AffordabilityDecision {
  action: AffordabilityAction;
  /** Machine reason (telemetry): 'free-list' | 'covers-estimate' | 'low-balance-economy' | 'below-floor'. */
  reason: string;
  /** User-facing notice — set for 'economy' (honest low-balance message) and 'block' (add-credits). */
  notice?: string;
}

/**
 * Decide whether a paid public v5.0 build may start, and on which engine. Pure. See the module header
 * for the exact rules. A non-finite/negative overdraft is treated as 0 (no tolerance).
 */
export function decideAffordability(input: AffordabilityInput): AffordabilityDecision {
  const { isFreeUser, balance, estimate } = input;

  // 1. Free-list (admin/testers) → exactly as today. No gate at all.
  if (isFreeUser) return { action: 'proceed', reason: 'free-list' };

  // 2. No positive balance → BLOCK. A build spends NavBharatAI's paid budget, so a non-free user with an
  //    empty (0 or negative) wallet cannot start a new build (admin 2026-07-12). The welcome bonus / a
  //    top-up gives a positive balance to spend; once exhausted the user must recharge. This is the ONE
  //    place a build is refused.
  if (balance <= 0) {
    return {
      action: 'block',
      reason: 'no-balance',
      notice: 'Your credits are used up. Add credits to start a new build — any build already running is unaffected.',
    };
  }

  // 3. Enough for the estimate → proceed exactly as today (no routing change).
  if (balance >= estimate) return { action: 'proceed', reason: 'covers-estimate' };

  // 4. Positive but below the estimate → build on the economy engine so a paying-but-low user's work is
  //    not stopped, and an over-cautious estimate never refuses a user who actually has money. Any real
  //    overrun settles negative post-build, and the very NEXT build is then blocked by rule 2 above.
  return {
    action: 'economy',
    reason: 'low-balance-economy',
    notice: 'Low balance — building on the economy engine to keep your work going. Add credits for the full engine.',
  };
}
