// WHICH DAY IS BEING BILLED, AND FOR HOW MUCH (ROADMAP §11 slice 2.1 / §13 item 2.1).
//
// Slice 2 measured a hosted app and reported what it WOULD be billed, with nobody's wallet touched —
// deliberately, so the switch would be flipped against real numbers rather than against a plan. This
// is the other half: the decision of what to actually debit, kept pure so every rule below is
// testable without a clock, a network or a wallet.
//
// 🔴 THE ONLY WAY A BILLING JOB GOES REALLY WRONG IS BY BILLING THE SAME THING TWICE, and the two
// ways that happens are both addressed here rather than in the job:
//
//   1. AN OPEN-ENDED WINDOW. "The last 24 hours", evaluated at whatever moment the job happens to
//      run, overlaps itself whenever a run is late, retried, or fired twice by two instances — and
//      under-counts whenever one is early. So the window is a WHOLE, CLOSED, PAST UTC DAY, named by
//      its date. Running the job twice asks Google about the identical stretch of time and produces
//      the identical number, which is what makes the idempotency key below meaningful.
//
//   2. A KEY THAT IS NOT THE WINDOW. The store's guard has to be `<app>_<that same day>`, or a
//      second run bills the same hours under a different name.
//
// 🔒 D3 — THE FREE ALLOWANCE, decided and stated rather than left implicit. There is NO separate
// hosting allowance, and that is the decision, not an omission: THE ONE-WALLET LAW says a user has
// one balance and everything they do draws it down, and the gifted welcome balance is already the
// free allowance for everything else they can do. A second, hosting-only pot would be a second
// currency to explain, to top up and to keep in sync — the exact thing the one-wallet law exists to
// prevent. A user with credit hosts an app; a user without credit is told so by the same balance
// they already watch.
//
// PURE — no I/O, no clock it was not given.

/** The ledger bucket a day's hosting rolls into: one row per user per day, like the assistants row. */
export function hostingLedgerRef(day: string): string {
  return `hosting_${day}`;
}

/** Ledger text. NavBharatAI's own words — never a vendor name (White-Label Law §2). */
export const HOSTING_LEDGER_LABEL = 'NavBharatAI hosting';

export interface BillingWindow {
  /** `YYYY-MM-DD` — the day being billed, and the second half of the idempotency key. */
  day: string;
  startIso: string;
  endIso: string;
}

/**
 * The last COMPLETE UTC day before `nowMs`.
 *
 * Complete, and in the past, for the reason in the header: a partial day would be re-billed the next
 * time the job ran, and there is no honest way to bill "part of today" twice without either
 * double-counting or keeping a running high-water mark that a restart would lose.
 */
export function lastCompleteDay(nowMs: number): BillingWindow {
  const end = new Date(Number.isFinite(nowMs) ? nowMs : 0);
  end.setUTCHours(0, 0, 0, 0);              // midnight that began today
  const start = new Date(end.getTime() - 86_400_000);
  return {
    day: start.toISOString().slice(0, 10),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

/** The store key for one app's one day. The day is IN the key — see the header's second point. */
export function hostingBillKey(workspaceId: string, day: string): string {
  return `${workspaceId}_${day}`;
}

export type HostingDebitReason =
  | 'billing-off'    // NAVBHARAT_BILL_HOSTING is not on — we absorb it, and say so
  | 'nothing-to-bill' // measured, and it genuinely cost nothing (or no rate is set for what it used)
  | 'no-owner'       // an orphaned app with nobody to charge
  | 'charge';

export interface HostingDebitDecision {
  charge: boolean;
  reason: HostingDebitReason;
  /** ₹ to debit. Always 0 unless `charge`. */
  billedInr: number;
}

/**
 * Turn "what this app would be billed in USD" into "what to take from whose wallet, in ₹".
 *
 * 🔒 IT NEVER DECIDES THE USD ITSELF. `hostingBillableUsd` already applies both of the billing law's
 * conditions — the switch is on, and there is a real measured cost to mark up — and an unset rate
 * already contributes ZERO there rather than a guess. This function's whole job is the last two
 * questions: is there anybody to charge, and is the ₹ figure real. PURE.
 *
 * An ORPHANED app (the owner deleted their workspace, or the record predates user ids) is never
 * charged to somebody else and never charged to nobody — it is named, so it appears in the admin's
 * report as an app we are hosting for free rather than as a silent zero.
 */
export function decideHostingDebit(opts: {
  billableUsd: number;
  usdInr: number;
  ownerId: string | null;
  billingEnabled: boolean;
}): HostingDebitDecision {
  const no = (reason: HostingDebitReason): HostingDebitDecision => ({ charge: false, reason, billedInr: 0 });
  if (!opts.billingEnabled) return no('billing-off');
  if (!opts.ownerId) return no('no-owner');

  const usd = Number(opts.billableUsd);
  const rate = Number(opts.usdInr);
  if (!Number.isFinite(usd) || usd <= 0) return no('nothing-to-bill');
  if (!Number.isFinite(rate) || rate <= 0) return no('nothing-to-bill');

  const inr = Math.round(usd * rate * 100) / 100;
  // A charge that rounds to nothing IS nothing. Rounding it up to one paisa would be inventing a cost,
  // and doing that daily for every app would be a real, recurring, invented bill.
  if (inr <= 0) return no('nothing-to-bill');
  return { charge: true, reason: 'charge', billedInr: inr };
}

/** One line for the ADMIN report. Never shown to a user — it names our own infrastructure cost. */
export function hostingDebitNote(d: HostingDebitDecision, day: string): string {
  switch (d.reason) {
    case 'charge': return `Hosting for ${day}: charged ₹${d.billedInr.toFixed(2)}.`;
    case 'billing-off': return `Hosting for ${day}: absorbed by NavBharatAI (NAVBHARAT_BILL_HOSTING is off).`;
    case 'no-owner': return `Hosting for ${day}: no owner on the record, so nobody was charged.`;
    default: return `Hosting for ${day}: nothing to bill.`;
  }
}
