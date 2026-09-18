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
export type CancelledDelivery = 'working-app' | 'files-saved' | 'nothing' | 'unverified-edit';

export interface CancelledBuildFacts {
  /** From `abortCauseOf(signal)` — never guessed, never defaulted to the user. */
  abortCause: AbortCause;
  /** How many files the build actually wrote and saved. */
  filesWritten: number;
  /**
   * Of those, how many are PLATFORM template files the build never changed.
   *
   * 🔴 THE BUG THIS EXISTS TO KILL (autopsy 2b0a3ed5, 2026-09-17). The golden-scaffold pre-seed writes
   * its template straight into the build's `writtenFiles` map, so `filesWritten` counted 12 files the
   * user's build never produced. Rule 4 below — *"nothing delivered, nothing charged"* — therefore
   * could not fire for any prompt that HAS a template, which is precisely the set of builds where a
   * user may quit before anything of their own exists.
   *
   * What it cost: a user asked for a calculator, our tested template landed at second 6.7, the one
   * model call returned **27 tokens in 55.7 seconds**, they pressed Stop at 64 s having seen no
   * preview at all — and were billed 50% (₹0.65) for twelve files we wrote from our own template.
   *
   * ⚠️ The POLICY was never wrong and is unchanged. The INPUT to it was. Counted here rather than at
   * the call site so the rule keeps one address; absent means 0, which is exactly today's behaviour
   * for every caller that has no template.
   */
  preseededUnchanged?: number;
  /** Did the platform OPEN the app in a real browser and see it render? */
  appRendered: boolean;
  /**
   * Was this turn EDITING an app that already existed, rather than building a new one?
   *
   * 🔴 THE CASE THIS MODULE COULD NOT SEE (autopsy 95598899, 2026-09-18). A user with a working
   * 35-file marketplace was charged **₹23.81** at the `files-saved` rate for a turn that overwrote
   * four of its entry files, left the release gate RED and the app throwing on load. They typed
   * *"No parrot or no app, don't work on any project"* to stop it.
   *
   * `files-saved` reads "files were written" as "value was delivered", and on a FRESH build that is
   * fair: the user now holds something they did not have before and can resume from it. On an EDIT
   * it can be exactly backwards — **they may hold LESS than they started with**, and with no verified
   * render nobody, including us, can say which. Charging for an unverified mutation of an app that
   * was working is the precise thing *"working app or free"* exists to forbid.
   *
   * ⚠️ It is read AFTER `appRendered`, deliberately: an edit that WAS seen running is still charged
   * in full (admin 2026-09-15, *"app bani = preview chala"*). This only covers the unverified case.
   *
   * Absent means false — a caller that does not know is treated as a fresh build, which is today's
   * behaviour exactly.
   */
  editingExistingApp?: boolean;
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
  const written = count(f.filesWritten);
  // What the BUILD delivered of the USER's own app — our untouched template is not theirs. Clamped at
  // 0 so a miscounted caller can only ever be generous, never invent work that was not done.
  const files = Math.max(0, written - count(f.preseededUnchanged));

  // RULE 4, FIRST HALF — UNCHANGED, and it must stay ahead of everything. Nothing was written AT ALL,
  // so an `appRendered` flag here is contradictory evidence, and the existing suite pins that a
  // contradiction lands on the free side ("zero files is free even when the app somehow rendered").
  // Junk input reaches 0 through `count()` and lands here too, which is also pinned. Neither is mine
  // to flip: both say "when the evidence disagrees with itself, do not charge".
  if (written === 0) {
    return {
      billedUsd: 0, discountPct: 100, delivery: 'nothing', applies: true,
      reason: 'user stopped the build before any file was produced — nothing delivered, not charged',
      userMessage: null,
    };
  }

  // 🔴 A RENDERING APP IS BILLED WHATEVER WROTE IT — and this branch must stay ABOVE the
  // nothing-delivered rule, which is a loophole the moment `files` stops counting the template.
  // `CLAUDE.md` (autopsy 4efab9d7) settles the case in as many words: *"a zero-write turn that
  // renders is billed by it"* — the user is holding a working app on screen, and what produced it is
  // our business, not theirs. Without this ordering, "seed a template → let it render → press Stop"
  // would be free for ever.
  //
  // RULE 3 is structural: every branch from here starts from `decided`, so the charge can only ever
  // be reduced. There is no path that computes a number of its own.
  if (f.appRendered === true) {
    return {
      billedUsd: round(decided), discountPct: 0, delivery: 'working-app', applies: true,
      reason: 'user stopped the build after a working app had been delivered and seen rendering — charged in full for the work done',
      userMessage: decided > 0
        ? 'You stopped this build, and your app was already built and running — it is saved and you can keep using it. You have been charged for the work that was completed, not for a full build.'
        : null,
    };
  }

  // RULE 4, SECOND HALF — NEW (autopsy 2b0a3ed5). Files exist, but every one of them is the
  // platform's own template, untouched, and nothing rendered. That is a real and expected state, not
  // a contradictory one: the user asked for a calculator, our tested template landed at second 6.7,
  // and they stopped before the model produced anything of theirs. They are holding nothing they did
  // not already have by asking, so there is nothing to charge for.
  if (files === 0) {
    return {
      billedUsd: 0, discountPct: 100, delivery: 'nothing', applies: true,
      reason: 'user stopped the build before any file of their own was produced — only the platform template existed and nothing rendered, so not charged',
      userMessage: null,
    };
  }

  // 🔴 RULE 5 (autopsy 95598899) — AN UNVERIFIED EDIT MAY HAVE TAKEN SOMETHING AWAY.
  //
  // Every branch above asks "what is the user holding?" and this is the one answer the module could
  // not give: on an edit, files written with no verified render may mean their working app is now
  // broken. We cannot show it is not, and the party that cannot show it should not be the one paid.
  //
  // It sits below `appRendered` so a VERIFIED edit is still charged in full, and below `files === 0`
  // so a fresh build with only our template keeps its own, more specific reason.
  if (f.editingExistingApp === true) {
    return {
      billedUsd: 0, discountPct: 100, delivery: 'unverified-edit', applies: true,
      reason: 'user stopped an edit of an existing app before it could be verified running — the app may be in a worse state than it started, so not charged',
      userMessage: null,
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
