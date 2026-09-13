// HOW FAR A BALANCE MAY GO NEGATIVE — the floor under every wallet.
//
// ADMIN 2026-09-13, holding two real accounts: one at **−₹506.03** with 0 apps built, another at
// **−₹1,198.41**. *"user ka bill -500₹ tak na jaye … -50₹ ya -100 tab chala jaye jitna ham jhel sakte
// hai. aise -500₹ har user ko diye to ham barbaad ho jayenge!!!"*
//
// 🔴 WHY THIS WAS UNBOUNDED, stated precisely so nobody re-derives it wrongly. Every START gate was
// already correct — `decideAffordability` refuses a NEW build at a balance of 0 or less, and a chat
// turn is refused on an empty wallet. What had no limit at all was the SETTLEMENT: a build that was
// legitimately allowed to start at ₹1 could run its full wall-clock and then debit whatever it had
// cost, in one go, at the end. The design said so in writing — "the debt is recorded honestly; the
// NEXT pre-flight gate then blocks until a recharge" — and that is exactly right about the next
// build and silent about the size of THIS one. `SESSION_COST_CAP_USD` ($5) is not that limit either:
// it only decides whether an EMPTY build may retry.
//
// 🔒 SO THE FLOOR LIVES AT THE DEBIT ITSELF, not in a gate. Nine different code paths take money out
// of a wallet; a limit written into the callers is a limit the tenth caller never gets. Applied
// inside the two functions every debit passes through, it is true by construction for all of them,
// including the ones nobody has written yet.
//
// ⚠️ IT IS A LAST LINE OF DEFENCE, NOT A SAVING. Clamping the debit stops the user's BILL growing; it
// does not un-spend what the model already cost us. What it guarantees is the bound the admin asked
// for — the most any one account can ever run up — and, just as importantly, that our real loss is
// RECORDED rather than hidden inside a number that was quietly made smaller.

/** What the floor is when nothing overrides it: a user may end at most ₹50 in debt. */
export const DEFAULT_OVERDRAFT_FLOOR_INR = 50;

/**
 * The widest floor an env value may set.
 *
 * ⚠️ A CEILING ON THE SETTING ITSELF, because the failure being fixed is unbounded debt: a typo of
 * `5000` in a Cloud Run box would restore precisely the behaviour that produced −₹1,198, and it would
 * do so silently. 500 is already ten times the default and far past anything the admin called
 * bearable.
 */
export const MAX_OVERDRAFT_FLOOR_INR = 500;

/**
 * How far below zero a wallet may go, in rupees (always returned POSITIVE — the floor is −this).
 *
 * A malformed or out-of-range value falls back to the DEFAULT rather than to "no limit". Someone who
 * wanted no limit would not be typing a number into a box called a floor, so an unreadable value can
 * never have meant "unlimited" — the same reasoning `parseRolloutPercent` already uses for a
 * malformed percentage.
 */
export function overdraftFloorInr(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.WALLET_OVERDRAFT_FLOOR_INR ?? '').trim().replace(/[₹,\s]/g, '');
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n < 0) return DEFAULT_OVERDRAFT_FLOOR_INR;
  return Math.min(n, MAX_OVERDRAFT_FLOOR_INR);
}

export interface ClampedCharge {
  /** What the user is actually billed — never enough to take them past the floor. */
  chargedInr: number;
  /**
   * What NavBharatAI ate instead.
   *
   * 🔒 RETURNED, NOT DISCARDED. A clamp that silently shrinks a number would make the platform's own
   * losses invisible on the exact screen the admin uses to judge them — the balance would look
   * healthier precisely when it was costing us most.
   */
  absorbedInr: number;
  /** True when the floor actually bit, so a caller can say so rather than infer it. */
  clamped: boolean;
}

/**
 * Split one charge into what the user may be billed and what we absorb. PURE.
 *
 * Room is measured from the CURRENT balance: a user at ₹10 with a ₹200 charge and a ₹50 floor is
 * billed ₹60 and we eat ₹140; a user already at −₹50 is billed nothing at all. A balance ALREADY past
 * the floor never gets pushed further, which is what stops a second bad build compounding a first.
 */
export function clampChargeToFloor(input: {
  balanceInr: number;
  billedInr: number;
  floorInr: number;
}): ClampedCharge {
  const billed = Number.isFinite(input.billedInr) && input.billedInr > 0 ? input.billedInr : 0;
  if (billed <= 0) return { chargedInr: 0, absorbedInr: 0, clamped: false };

  const balance = Number.isFinite(input.balanceInr) ? input.balanceInr : 0;
  const floor = Number.isFinite(input.floorInr) && input.floorInr >= 0 ? input.floorInr : DEFAULT_OVERDRAFT_FLOOR_INR;

  // How much may still be taken before the balance would pass −floor.
  const room = Math.max(0, balance + floor);
  if (billed <= room) return { chargedInr: billed, absorbedInr: 0, clamped: false };

  const charged = Math.round(room * 100) / 100;
  const absorbed = Math.round((billed - charged) * 100) / 100;
  return { chargedInr: charged, absorbedInr: absorbed, clamped: true };
}
