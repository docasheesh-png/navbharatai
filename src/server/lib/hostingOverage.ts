// WHAT A HOSTING PLAN HOLDER IS ACTUALLY CHARGED — the rule the user ticked, in code.
//
// 🔴 THIS REPLACES A DOUBLE CHARGE THAT WOULD HAVE SHIPPED. The daily hosting job priced every app
// at "our cost + 20%" (decision D5) and knew nothing about plans. But a ₹149 Starter holder has
// already been SOLD 5 GB of visitor traffic — it is written in the agreement they tick before paying:
// *"The plan includes 5 GB of visitor traffic every 30 days."* Billing them cost+20% from rupee one
// would have taken money for something they had already bought. The admin caught it by asking the
// right question: "to hum ₹149 ke plan me user ko kya de rahe hai?"
//
// 🔒 SO THE AGREEMENT WINS OVER D5, AND THAT IS THE WHOLE POINT OF THIS FILE. D5 is an internal
// decision about recovering our own cost; the agreement is a promise made to a paying customer. When
// they disagree, the promise is what the user is charged — one flat, quotable ₹/GB above a stated
// allowance, exactly as the ticked terms say. D5 does not disappear: `hostingCost.ts` still computes
// what the app REALLY costs us, and that number stays in the ADMIN report, where it answers the only
// question it was ever for — is ₹20/GB above our own cost or below it?
//
// 🔒 A LEGACY ₹99 PLAN IS NEVER CHARGED OVERAGE. Those plans predate the tier catalogue and carry no
// `agreedAt`, which means their holder was never shown the overage terms. `hostingPlan.ts` already
// states this as law; this module enforces it, because a charge nobody agreed to is not a charge.
//
// PURE — measured GB in, rupees out. No clock, no I/O, no store.

/** What this plan period has accumulated so far, read from the durable period record. */
export interface PeriodUsage {
  /** GB measured in this period BEFORE today's reading. */
  gbBefore: number;
  /** GB of this period that have ALREADY been charged for. */
  gbBilled: number;
}

export type OverageReason =
  | 'no-plan'           // nothing to bill against — and hosting should not be running at all
  | 'not-agreed'        // a legacy plan whose holder was never shown the overage terms
  | 'nothing-measured'  // the meter could not read this app's traffic; never invent it
  | 'within-allowance'  // still inside the GB the plan already sold them
  | 'charge';

export interface OverageDecision {
  charge: boolean;
  reason: OverageReason;
  /** GB above the allowance that have not been charged for yet. */
  billableGb: number;
  /** ₹ owed for those GB. Always 0 unless `charge`. */
  inr: number;
  /** Total GB this period, including today — what the period record should now hold. */
  periodGb: number;
}

const gb = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * What to charge for today's traffic.
 *
 * 🔒 IT BILLS THE DIFFERENCE, NOT THE DAY. The allowance is monthly and the job is daily, so "today's
 * GB minus the allowance" would be wrong in both directions — it would charge nothing until a single
 * day exceeded 5 GB, and then charge the allowance again on every later day. Instead the period's
 * RUNNING TOTAL is compared with the allowance, and what is already billed is subtracted. A user who
 * crosses 5 GB on the 19th is charged for the part above 5, once, and for each further GB after that.
 *
 * 🔒 AN UNMEASURED DAY CHARGES NOTHING AND ADDS NOTHING. `readHostingUsage` reports null rather than
 * zero when it cannot read a meter, and a gap treated as zero would silently shrink the total a user
 * is eventually billed on — under-charging, which is the safe direction, but only because the gap is
 * carried honestly rather than filled with a guess.
 */
export function decideOverage(opts: {
  /** GB measured for this app today, or null when the meter could not read it. */
  gbToday: number | null;
  usage: PeriodUsage;
  /** The plan's included GB per period. */
  includedGb: number;
  ratePerGb: number;
  /** Does the holder have an active plan at all? */
  hasPlan: boolean;
  /** Did they tick terms that included the overage rate? A legacy plan did not. */
  agreed: boolean;
}): OverageDecision {
  const before = gb(opts.usage?.gbBefore);
  const billed = gb(opts.usage?.gbBilled);
  const measured = typeof opts.gbToday === 'number' && Number.isFinite(opts.gbToday) && opts.gbToday >= 0;
  const periodGb = Math.round((before + (measured ? gb(opts.gbToday) : 0)) * 1e6) / 1e6;

  const no = (reason: OverageReason): OverageDecision => ({
    charge: false, reason, billableGb: 0, inr: 0, periodGb,
  });

  if (!opts.hasPlan) return no('no-plan');
  if (!opts.agreed) return no('not-agreed');
  if (!measured) return no('nothing-measured');

  const allowance = gb(opts.includedGb);
  const overSoFar = Math.max(0, periodGb - allowance);
  const billableGb = Math.round(Math.max(0, overSoFar - billed) * 1e6) / 1e6;
  if (billableGb <= 0) return no('within-allowance');

  const rate = gb(opts.ratePerGb);
  const inr = Math.round(billableGb * rate * 100) / 100;
  // A part-GB that rounds to nothing is nothing. Rounding it up to a paisa, every day, for every app,
  // would be a recurring invented charge — the same rule the build and hosting debits already follow.
  if (inr <= 0) return no('within-allowance');
  return { charge: true, reason: 'charge', billableGb, inr, periodGb };
}

// ── When the money does not arrive ───────────────────────────────────────────────────────────────

export type DebtAction = 'none' | 'warn' | 'take-offline';

/**
 * What to do about traffic that was charged and could not be paid.
 *
 * 🔴 THE AGREEMENT SAYS THIS HAPPENS, WHICH IS THE ONLY REASON IT MAY. The ticked terms read: *"If
 * your balance reaches ₹0 while extra traffic is owed, your site goes offline until you top up —
 * nothing is deleted."* Before this change the terms promised the OPPOSITE in capital letters
 * ("your apps KEEP RUNNING — nothing is switched off"), and switching a site off under that wording
 * would have been breaking a promise somebody paid for. The wording is changed in the same commit as
 * this rule, so no user is ever subject to a term they did not see.
 *
 * 🔒 A USER WHO OWES NOTHING IS NEVER TOUCHED, whatever their balance is. An empty wallet is not a
 * debt — a site inside its included GB costs its owner nothing, so ₹0 changes nothing for them. This
 * is the distinction that decides whether the feature is fair or catastrophic, and it is the first
 * line of the function for that reason.
 *
 * 🔒 AND THERE IS ALWAYS A WARNING FIRST. Going straight from "owed" to "offline" is the surprise the
 * admin objected to in the alert system, applied to something far worse than an email: somebody's
 * customers meeting a dead site. The grace days are counted from when the debt was FIRST recorded,
 * so the clock starts at the warning, never at the enforcement.
 */
export function decideDebtAction(opts: {
  owedInr: number;
  /** The owner's balance in ₹, or null when it could not be read. */
  balanceInr: number | null;
  /** Whole days since the debt was first recorded. */
  owedForDays: number;
  graceDays: number;
}): DebtAction {
  const owed = Number(opts.owedInr);
  if (!Number.isFinite(owed) || owed <= 0) return 'none';
  // Unreadable balance is not an empty one. A Firestore hiccup must never take a site off the
  // internet — the same fail-open direction every other money gate on this platform takes.
  if (typeof opts.balanceInr !== 'number' || !Number.isFinite(opts.balanceInr)) return 'none';
  if (opts.balanceInr > 0) return 'none';

  const days = Number(opts.owedForDays);
  const grace = Number(opts.graceDays);
  const graceDays = Number.isFinite(grace) && grace >= 0 ? grace : 3;
  return Number.isFinite(days) && days >= graceDays ? 'take-offline' : 'warn';
}

/** Days a debt is carried, with warnings, before the site is taken offline. */
export const HOSTING_DEBT_GRACE_DAYS = 3;

/**
 * Which plan PERIOD a date falls in, as the `YYYY-MM-DD` the allowance resets on.
 *
 * Derived from the plan's own expiry minus its length, NOT from the calendar month: a plan bought on
 * the 19th renews on the 19th, and an allowance that reset on the 1st would give that user a second
 * free 5 GB in the middle of every period they paid for.
 */
export function periodStartFrom(expiresAtIso: string | null | undefined, days: number): string {
  const end = Date.parse(String(expiresAtIso ?? ''));
  const len = Number(days);
  if (!Number.isFinite(end) || !Number.isFinite(len) || len <= 0) return '';
  return new Date(end - len * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days between two ISO instants, floored at 0. */
export function daysBetween(fromIso: string | null | undefined, nowMs: number): number {
  const from = Date.parse(String(fromIso ?? ''));
  if (!Number.isFinite(from) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - from) / 86_400_000));
}
