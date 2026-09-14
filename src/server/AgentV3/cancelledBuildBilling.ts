// THE USER PRESSED STOP. WE DID THE WORK. WHO PAYS?
//
// ADMIN, 2026-09-14: "kabhi kabhi app 90% tab ban jati hai, aur user … build cancel kar deta hai. to
// bhi woh build fail me jati hai, aise case me bhi charge 0 aata hai. isko bhi fix karo! USER KI GALTI
// HAI, ISME HAMARI NAHI!" — then, crucially: "mai non technical hu … aap specialist ke tarah socho,
// aur isko aise fix karo ki DONO ka nuksan na ho, na mera (admin) na user ka."
//
// He is right about the gap, and it is a real one. `zeroBillForFailedBuild` makes EVERY `ok:false`
// build free, and it cannot tell two completely different things apart:
//
//   (a) WE failed — our engine broke, or a wrong verdict called a working app broken.
//       → Free, always. That is the "working app or free" law and nothing here touches it.
//   (b) THE USER stopped it — we spent real provider tokens and real sandbox minutes, produced real
//       files, and the user KEEPS them (a stopped build is saved and resumable: "send another message
//       and I'll continue from here").
//       → Free is wrong. Nobody failed; the user simply changed their mind.
//
// 🔴 WHERE I DISAGREED WITH THE ADMIN'S OWN NUMBERS, AND WHY IT PROTECTS HIM RATHER THAN THE USER.
// He proposed a percentage table: cancel with the app built ⇒ charge 100%; cancel with nothing built
// ⇒ charge 50%. The first half is exactly right and is implemented below. The second half would
// **over-charge, and by a lot** — because NavBharatAI does not price builds at a flat rate. Since Fix
// 65 the bill IS the real measured provider cost × the tiered markup. So:
//
//   • cancel at 90% → the real cost is already ~90% of a full build → the bill is already ~90%.
//     His "100% charge" is achieved by simply NOT zeroing it. No table needed.
//   • cancel at 5%  → the real cost is ~5% → a 50% charge would bill TEN TIMES what the work cost,
//     for an app the user cannot use. That is taking money for work never done, it breaks this repo's
//     own billing law ("never invent a cost"), and it is the single most refund-generating,
//     review-destroying thing a builder can do.
//
// So the percentages are not the mechanism — the real cost already is. What the tiers below decide is
// a DISCOUNT on that honest number, and the band is exactly the 0%–50% the admin asked for, applied
// where each end of it is defensible.
//
// ┌─ what the user is holding when they stop ──────────────┬─ discount ─┬─ why ────────────────────┐
// │ a WORKING app — we opened it and watched it render     │     0%     │ they have the product     │
// │ files saved and resumable, never seen running          │    50%     │ real code, not an app     │
// │ nothing at all                                         │   100%     │ charging for nothing is   │
// │                                                        │   (free)   │ indefensible — and costs  │
// │                                                        │            │ us almost nothing anyway  │
// └────────────────────────────────────────────────────────┴────────────┴───────────────────────────┘
//
// 🔒 THE FOUR SAFETY RULES, AND THEY MATTER FAR MORE THAN THE NUMBERS. Charging for our OWN failure
// would be worse than never charging at all — it is the one outcome that cannot be apologised away.
//
//   1. ONLY AN EXPLICIT `user-stop`. `buildAbortCause.ts` already exists for exactly this honesty
//      problem ("maine nahi roki, khud ruki hai bhai" — a watchdog stop reported as the user's). Six
//      other causes — watchdog, reaper, deploy-drain, lock-reclaimed, cost-cap — stay FREE.
//   2. `'unknown'` IS NEVER THE USER. That module's own header says an abort we cannot explain must
//      never be attributed to something the user did. An unknown cause bills nothing.
//   3. NEVER MORE THAN THE BUILD ALREADY COST. This can only ever REDUCE a charge; it cannot invent
//      one, and cancelling can never cost more than finishing.
//   4. WE ONLY EVER CHARGE FOR WHAT THE USER KEEPS. Zero files is zero rupees, whatever we spent.
//
// ⚠️ AND ONE THING THE ADMIN ASSUMED THAT THE CODE DOES NOT DO — worth stating so nobody "fixes" it:
// **closing the app does NOT cancel a build.** `req.on('close')` only drops the event subscriber; the
// build runs to completion on the server and bills normally. So a user on a train who loses signal is
// not cancelling anything and is never touched by this module. Only the Stop button reaches here.
//
// PURE — no clock, no I/O, no env. Every rule is unit-testable and cannot lie about what it did.

import type { AbortCause } from './buildAbortCause';

/** What the user is holding at the moment they stopped. */
export type CancelledDelivery = 'working-app' | 'files-saved' | 'nothing';

export interface CancelledBuildFacts {
  /** From `abortCauseOf(signal)` — never guessed, never defaulted to the user. */
  abortCause: AbortCause;
  /** How many files the build actually wrote and saved. */
  filesWritten: number;
  /** Did the platform OPEN the app in a real browser and see it render? */
  appRendered: boolean;
  /** The honest real-cost bill the normal billing model already computed for this build. */
  decidedBilledUsd: number;
}

export interface CancelledBuildBill {
  /** What to charge. Always ≤ `decidedBilledUsd`, never negative. */
  billedUsd: number;
  /** 0, 50 or 100. Reported so the admin's ledger can show the reasoning, not just a number. */
  discountPct: 0 | 50 | 100;
  /** What the user was holding. `null` when this was not a user cancel at all. */
  delivery: CancelledDelivery | null;
  /** True only when this module is the thing deciding the charge. */
  applies: boolean;
  /** Admin-facing. Recorded beside every other billing reason. */
  reason: string;
  /** User-facing, brand-safe, and never names a provider. `null` when nothing is charged. */
  userMessage: string | null;
}

function money(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function count(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Two decimal places of a US cent — the same precision the rest of the billing path carries. */
function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

const FREE: Omit<CancelledBuildBill, 'reason'> = {
  billedUsd: 0, discountPct: 100, delivery: null, applies: false, userMessage: null,
};

/**
 * Decide what a build the USER stopped should cost.
 *
 * Returns `applies: false` for everything that is not an explicit user cancel, which leaves the
 * existing "working app or free" rule in charge exactly as today.
 */
export function decideCancelledBuildBill(f: CancelledBuildFacts | null | undefined): CancelledBuildBill {
  if (!f) return { ...FREE, reason: 'no build facts — not charged' };

  // RULE 1 + 2. Anything but an explicit Stop is not the user's doing, and an abort we cannot explain
  // is never attributed to them. Both fall through to the unchanged free path.
  if (f.abortCause !== 'user-stop') {
    return { ...FREE, reason: 'not a user cancellation — the existing free rule applies' };
  }

  const decided = money(f.decidedBilledUsd);
  const files = count(f.filesWritten);

  // RULE 4. Nothing delivered, nothing charged — whatever it cost us. A misclick three seconds in
  // must not produce a bill, and under real-cost billing it would be a rounding error anyway.
  if (files === 0) {
    return {
      billedUsd: 0, discountPct: 100, delivery: 'nothing', applies: true,
      reason: 'user stopped the build before any file was produced — nothing delivered, not charged',
      userMessage: null,
    };
  }

  // RULE 3 is structural: every branch below starts from `decided`, so the charge can only ever be
  // reduced. There is no path that computes a number of its own.
  if (f.appRendered === true) {
    return {
      billedUsd: round(decided), discountPct: 0, delivery: 'working-app', applies: true,
      reason: 'user stopped the build after a working app had been delivered and seen rendering — charged in full for the work done',
      userMessage: decided > 0
        ? 'You stopped this build, and your app was already built and running — it is saved and you can keep using it. You have been charged for the work that was completed, not for a full build.'
        : null,
    };
  }

  const halved = round(decided / 2);
  return {
    billedUsd: halved, discountPct: 50, delivery: 'files-saved', applies: true,
    reason: 'user stopped the build with files saved but no app verified running — charged half the work done',
    userMessage: halved > 0
      ? 'You stopped this build. Your files are saved and I can carry on from here whenever you like. Because the app was not finished, you have been charged HALF of what the work done so far cost — not a full build.'
      : null,
  };
}
