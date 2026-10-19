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

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 THE TWO DISCOUNTS DO NOT STACK — a real-cost FLOOR (admin-mandated 2026-09-21).
//
// Admin, after I raised it three times and they asked for the fix rather than the risk:
// *"haan, floor + naya message bhej do."*
//
// 🔑 WHAT WAS WRONG, AND IT WAS NOT A RARE COMPOSITION — IT WAS EVERY STOPPED BUILD. Four days after
// the table above shipped, `previewEarnsMarkup.ts` (2026-09-18) began waiving the service margin on
// any build whose app was never seen running. The two modules read the SAME fact:
//
//     previewEarnsMarkup:     previewProven: buildObs.previewRendered === true
//     cancelledBuildBilling:  appRendered:   buildObs.previewRendered === true
//
// One expression. So the `files-saved` branch is reachable ONLY when `appRendered` is false — which
// is exactly when the markup has already been waived. The 50% was therefore never cutting into a
// margin; it was cutting into **our own out-of-pocket cost**, always.
//
//   a build whose real cost is $1.20 · decided bill $4.80 (tiered markup) · user presses Stop
//     before 2026-09-18:  $4.80 → 50% → $2.40 charged   · we spent $1.20 → +$1.20   ← the design
//     after  2026-09-18:  $4.80 → margin waived → $1.20 → 50% → $0.60 · we spent $1.20 → −$0.60
//
// Neither module is wrong. The 50% was designed against a bill that INCLUDED margin, and the waiver
// removed the very thing it was discounting. **The composition was never decided** — this is that
// decision, and it is the same shape as the double-negative class this repo keeps paying for: two
// locally-correct rules, and nothing asking what happens when both fire.
//
// 🔒 THE RULE: a cancellation discount may take our PROFIT and may never take our COST.
//     billedUsd = min(decided, max(realCost, decided / 2))
//
//   • margin waived (today's every Stop) ⇒ the floor IS the bill: the user pays exactly what the
//     build cost to run, we earn nothing and lose nothing. Both halves of the admin's own
//     instruction — *"DONO ka nuksan na ho, na mera na user ka"* — hold for the first time.
//   • margin intact (the kill switch off, or a real cost already above the bill) ⇒ half, byte for
//     byte as before.
//   • ⚠️ THE THREE ₹0 OUTCOMES ARE UNTOUCHED, deliberately: nothing written, template-only, and the
//     unverified edit each return BEFORE this arithmetic. Those are admin rulings about what the
//     user is holding, not discounts on a bill, and a floor under them would charge for a build that
//     delivered nothing — the one thing every rule above forbids.
//
// ⚠️ AND THE COST MUST BE PASSED IN, NOT ASSUMED. `realCostUsd`/`sandboxUsd` absent ⇒ floor 0 ⇒ the
// plain half, which is today's behaviour exactly. A module that guessed its own floor would be
// inventing a cost, which this repo's billing law forbids even when the guess flatters us.
// ───────────────────────────────────────────────────────────────────────────────────────────────────

import { seedKeptSentence, type AbortCause } from './buildAbortCause';

/** What the user is holding at the moment they stopped. */
/**
 * `seed-only` (autopsy 303e8a6f): files exist, but every one is the platform's own seed, untouched — a different
 * state from `nothing` (zero files written). It was filed as `nothing`, so the user of a seeded template heard
 * "Your workspace is exactly as it was" while the template sat in it and on screen.
 */
export type CancelledDelivery = 'working-app' | 'files-saved' | 'nothing' | 'seed-only' | 'unverified-edit' | 'running-not-before-stop';

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
   * When the app was first SEEN running (epoch ms), and when the user ASKED to stop (Stop button, or the message a
   * typed stop came from). Owner 2026-10-18 (r6–r10 autopsy): full price on a stop only when the app was running
   * BEFORE the request. Absent ⇒ unknown ⇒ it cannot be shown to have come first ⇒ at cost.
   * AGENTV3_STOP_FULL_NEEDS_GREEN_FIRST=off restores "rendered at all ⇒ full".
   */
  appRenderedAt?: number | null;
  stopRequestedAt?: number | null;
  /**
   * The stop was requested while OUR style-floor pass (`STYLE_RULES_RESUMED`) was running — after the model had
   * already declared the app finished. Owner 2026-10-18 (r6–r10 autopsy): never full price. At cost, not free:
   * the app had already passed the gate and the work was real, but the user stopped polish they never asked for,
   * often right after being told "Not finished yet", so our margin on it is ours to lose.
   * AGENTV3_STYLE_PASS_STOP_AT_COST=off restores the (g) rule alone.
   */
  stoppedDuringOurStylePass?: boolean;
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
  /**
   * What the PROVIDERS really cost NavBharatAI on this build (USD, tokens) — the floor's first half.
   *
   * Absent means 0, i.e. no floor and the plain half: today's behaviour exactly. This module must
   * never derive its own figure — `realProviderCostUsd` is the one place that number is computed,
   * and a second estimate here would be an invented cost.
   */
  realCostUsd?: number;
  /** What the VM really cost (USD), already capped to this build's own window — the floor's second half. */
  sandboxUsd?: number;
}

export interface CancelledBuildBill {
  /** What to charge. Always ≤ `decidedBilledUsd`, never negative. */
  billedUsd: number;
  /**
   * The discount ACTUALLY applied, as a percentage of the decided bill. Reported so the admin's
   * ledger shows the reasoning rather than just a number.
   *
   * ⚠️ It was `0 | 50 | 100` until the real-cost floor existed. It is now derived from the two
   * numbers, because a floored charge is genuinely somewhere between 0% and 50% and printing a
   * hardcoded `50%` beside a bill that was not halved would make the ledger state something false —
   * on the one line an admin reads to judge whether a Stop cost them money.
   */
  discountPct: number;
  /**
   * True when the real-cost floor is what decided this charge, i.e. half would have billed the user
   * less than the build cost us. Drives the user's wording, which must not say "half" when it is not.
   */
  costFloorApplied: boolean;
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

function greenFirstRuleOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_STOP_FULL_NEEDS_GREEN_FIRST ?? '').trim().toLowerCase() !== 'off';
}

/** Was the app seen running strictly BEFORE the stop was requested? Unknown on either side ⇒ false. PURE. */
export function renderedBeforeStop(f: Pick<CancelledBuildFacts, 'appRenderedAt' | 'stopRequestedAt'>): boolean {
  const r = f.appRenderedAt; const s = f.stopRequestedAt;
  return typeof r === 'number' && Number.isFinite(r) && typeof s === 'number' && Number.isFinite(s) && r < s;
}

/** Close an open style-pass window (no-op when it never opened or is already closed). */
export function closeStylePassWindow(w: { startedAt: number | null; endedAt: number | null }, now: number): void {
  if (w.startedAt !== null && w.endedAt === null) w.endedAt = now;
}

/** Was the stop requested inside [start, end)? An open end means the window was still running. PURE. */
export function stopFellInWindow(stopAt: number | null, start: number | null, end: number | null): boolean {
  if (stopAt === null || start === null || !Number.isFinite(stopAt) || !Number.isFinite(start)) return false;
  return stopAt >= start && (end === null || stopAt < end);
}

const FREE: Omit<CancelledBuildBill, 'reason'> = {
  billedUsd: 0, discountPct: 100, delivery: null, applies: false, userMessage: null,
  costFloorApplied: false,
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
      billedUsd: 0, discountPct: 100, delivery: 'nothing', applies: true, costFloorApplied: false,
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
  const ourPassStopped = f.stoppedDuringOurStylePass === true
    && String(process.env.AGENTV3_STYLE_PASS_STOP_AT_COST ?? '').trim().toLowerCase() !== 'off';
  if (f.appRendered === true && ((!renderedBeforeStop(f) && greenFirstRuleOn()) || ourPassStopped)) {
    // It renders now, but it was not running when they asked to stop: the rest was finished after the request.
    // At cost — our margin goes, our cost never does (the same floor as below, without the half).
    const ourCost = money(f.realCostUsd) + money(f.sandboxUsd);
    const billedUsd = round(Math.min(decided, ourCost));
    return {
      billedUsd,
      discountPct: decided > 0 ? Math.round(((decided - billedUsd) / decided) * 100) : 100,
      delivery: 'running-not-before-stop', applies: true, costFloorApplied: billedUsd > 0,
      reason: ourPassStopped
        ? 'user stopped the build during OUR style-floor pass, after the model had finished — charged at our cost, never full price'
        : 'user stopped the build before the app was seen running (it rendered only after the stop request, or when is unknown) — charged at our cost, no service charge',
      userMessage: billedUsd > 0
        ? 'You stopped this build before the app was running. Your app is saved and you can keep using it. You have been charged only what the work actually cost to run — no service charge on top.'
        : null,
    };
  }
  if (f.appRendered === true) {
    return {
      billedUsd: round(decided), discountPct: 0, delivery: 'working-app', applies: true, costFloorApplied: false,
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
      billedUsd: 0, discountPct: 100, delivery: 'seed-only', applies: true, costFloorApplied: false,
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
      billedUsd: 0, discountPct: 100, delivery: 'unverified-edit', applies: true, costFloorApplied: false,
      reason: 'user stopped an edit of an existing app before it could be verified running — the app may be in a worse state than it started, so not charged',
      userMessage: null,
    };
  }

  // 🔒 THE FLOOR (see the header). A cancellation discount may take our PROFIT and never our COST.
  // The real cost is whatever the caller measured; absent ⇒ 0 ⇒ the plain half, exactly as before.
  const real = money(f.realCostUsd) + money(f.sandboxUsd);
  const halved = round(decided / 2);
  // `min(decided, …)` keeps RULE 3 structural: a real cost somehow above the decided bill cannot
  // raise the charge, it just leaves it where the rest of the billing path already put it.
  const billedUsd = round(Math.min(decided, Math.max(real, halved)));
  const costFloorApplied = billedUsd > halved;
  // Derived, never hardcoded — a bill that was not halved must not print "50%" in the ledger.
  const discountPct = decided > 0 ? Math.round(((decided - billedUsd) / decided) * 100) : 100;
  return {
    billedUsd,
    discountPct,
    delivery: 'files-saved',
    applies: true,
    costFloorApplied,
    reason: costFloorApplied
      ? 'user stopped the build with files saved but no app verified running — the service margin was already waived for the same reason, so the charge is floored at what the build really cost us rather than halved again (a cancellation may take our margin, never our cost)'
      : 'user stopped the build with files saved but no app verified running — charged half the work done',
    userMessage: billedUsd > 0
      ? (costFloorApplied
        // Deliberately NOT "half": it is not half, and the number on their bill would contradict the
        // sentence beside it. This is the same statement `previewEarnsMarkup` makes, and the route
        // suppresses that one when this fires so the user is never told twice.
        ? 'You stopped this build. Your files are saved and I can carry on from here whenever you like. '
          + 'Because the app was not finished, you have been charged only what the work done so far actually '
          + 'cost to run — no service charge on top, and nothing like a full build.'
        : 'You stopped this build. Your files are saved and I can carry on from here whenever you like. Because the app was not finished, you have been charged HALF of what the work done so far cost — not a full build.')
      : null,
  };
}

/**
 * The user's line when a stopped build costs nothing — chosen by WHAT THEY ARE HOLDING. PURE.
 *
 * 🔴 AUTOPSY 120eb52f (2026-09-30). A "Continue … finish the build" turn changed six files, made the
 * project compile, and was stopped by the user before the app was checked. RULE 5 above correctly made
 * it free — and the route then told them *"You stopped this build before anything was produced …
 * Your workspace is exactly as it was"*, one sentence for every free cancellation. Both clauses were
 * false. An unverified edit is free because we could not show it left the app better; the user must
 * hear that the changes are saved, not that nothing happened.
 */
export function freeCancellationMessage(delivery: CancelledDelivery | null): string {
  if (delivery === 'unverified-edit') {
    return '🛡️ You stopped this change before it could be checked, so it is FREE — no charge. What it had changed so far is saved; if your app does not work the way it did, send a message and I will fix it.';
  }
  if (delivery === 'seed-only') {
    // The workspace is NOT as it was: our untouched template is in it (autopsy 303e8a6f) — say so, and the way on the
    // router really takes: an untouched template is "only our starter", so the next message builds fresh.
    return `🛡️ You stopped this build before it changed anything, so it is FREE — no charge. ${seedKeptSentence('platform-template')}`;
  }
  return '🛡️ You stopped this build before anything was produced, so it is FREE — no charge. Your workspace is exactly as it was.';
}

/**
 * A STOP THAT LANDED AFTER THE BUILD HAD ALREADY SUCCEEDED — is it free? PURE.
 *
 * 🔴 THE GAP (pre-deploy review 2026-10-18, B2). The three ₹0 Stop outcomes above (`nothing`, `seed-only`,
 * `unverified-edit`) reached ₹0 only through the route's FAILED-build rule, `zeroBillForFailedBuild(result.ok)`.
 * A Stop always ends the runner with `ok: false`, so that was enough — until the Stop arrives AFTER the
 * runner has already returned `ok: true`, while the platform's own final checks are still running. Nothing
 * resets `ok` on that path (every post-run step merely stands down on an aborted signal), so the rule above
 * said "free", the failed-build rule did not fire, and the bill stayed the full decided amount — while the
 * user was told the Stop was free. The late Stop is the same user action as any other (Stop button, Unsend,
 * a typed "stop", a Stop pressed on another instance): it must get the same rules.
 *
 * Only the ₹0 outcomes need this; a charged Stop (`billedUsd > 0`) is already applied by the route whatever
 * `ok` says. `applies` is true only for an explicit `user-stop`, so no other build is touched.
 *
 * Kill switch: `AGENTV3_BILL_LATE_STOP_RULES=off` (read by the route, passed in here) restores the old
 * behaviour, where a late Stop on a successful build was billed in full.
 */
export function lateStopIsFree(bill: CancelledBuildBill | null | undefined, lateStopRulesEnabled: boolean): boolean {
  return lateStopRulesEnabled === true && bill?.applies === true && !(bill.billedUsd > 0);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// 🔒 ONE DECISION FOR EVERY BILLING POINT (pre-deploy review 2026-10-19, round 4).
//
// A build is settled at one of TWO places in routes/agentv3.ts: the normal settle at the end of the build,
// and `finalizeOnDeadline`, which settles a build whose wall-clock or advisory cap fired first. Round 3
// put the Stop rules on the first one only. The second billed every `ok` build in full, so a user Stop
// that did not also end the build's stream (a typed "stop", or a Stop pressed on another instance; the
// Stop button and Unsend set `rb.ended`, and the finalizer returns early for those) could be charged in
// full by whichever settle ran first. The debit is idempotent per buildRef, so the first settle wins.
// That is the "two locally correct rules, nothing asking what happens when both fire" shape again.
// The fix is not a second copy of the rules. Both points now call `settleStopOrFailure`, so they cannot
// diverge.
// ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The two kill switches, read in ONE place. `off` (any case, padded) disables; anything else is on. */
export interface StopBillingSwitches {
  /** `AGENTV3_BILL_CANCELLED`. Off: a Stop is not billed by the cancel rule at all (the pre-2026-09-14 behaviour). */
  billCancelled: boolean;
  /** `AGENTV3_BILL_LATE_STOP_RULES`. Off: the rules do not reach a Stop the build had already outlived (round 3/4). */
  lateStopRules: boolean;
}
export function stopBillingSwitches(env: Record<string, string | undefined>): StopBillingSwitches {
  const on = (v: string | undefined) => (v ?? '').trim().toLowerCase() !== 'off';
  return { billCancelled: on(env.AGENTV3_BILL_CANCELLED), lateStopRules: on(env.AGENTV3_BILL_LATE_STOP_RULES) };
}

/** How many seeded template files are still byte-identical in what the build wrote. One formula for both billing points. */
export function preseededUnchangedCount(preseeded: Iterable<[string, string]> | null | undefined, written: { get(p: string): string | undefined }): number {
  if (!preseeded) return 0;
  let n = 0;
  for (const [p, c] of preseeded) if (written.get(p) === c) n++;
  return n;
}

export type StopOrFailureSettlement =
  /** A user Stop the rules CHARGE: the bill becomes `billedUsd` (never more than decided). */
  | { kind: 'cancel-charge'; billedUsd: number; cancelBill: CancelledBuildBill }
  /** A build that did not succeed: ₹0 (the failed-build rule). `cancelBill` is set when it was a user Stop the rules made free. */
  | { kind: 'failed-free'; cancelBill: CancelledBuildBill | null }
  /** A user Stop the rules made free, arriving after the build had already succeeded. ₹0. */
  | { kind: 'late-stop-free'; cancelBill: CancelledBuildBill }
  /** Nothing here changes the bill. */
  | { kind: 'unchanged'; cancelBill: CancelledBuildBill | null };

/**
 * The single Stop/failure decision. PURE. Called by BOTH billing points in routes/agentv3.ts.
 *
 * The order is the route's original if/else chain, unchanged:
 *   1. a user Stop the rules charge → that charge, whatever `ok` says;
 *   2. otherwise a failed build (`failed`, i.e. `zeroBillForFailedBuild(ok)`) with something to zero → ₹0;
 *   3. otherwise a user Stop the rules made free (`lateStopIsFree`) → ₹0;
 *   4. otherwise unchanged.
 */
export function settleStopOrFailure(input: {
  failed: boolean;
  facts: CancelledBuildFacts;
  switches: StopBillingSwitches;
}): StopOrFailureSettlement {
  const cancelBill = input.switches.billCancelled ? decideCancelledBuildBill(input.facts) : null;
  const billed = money(input.facts.decidedBilledUsd);
  if (cancelBill?.applies && cancelBill.billedUsd > 0) return { kind: 'cancel-charge', billedUsd: cancelBill.billedUsd, cancelBill };
  if (input.failed === true && billed > 0) return { kind: 'failed-free', cancelBill };
  if (cancelBill && lateStopIsFree(cancelBill, input.switches.lateStopRules) && billed > 0) return { kind: 'late-stop-free', cancelBill };
  return { kind: 'unchanged', cancelBill };
}
