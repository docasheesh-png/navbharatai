/**
 * THE DEEP BUG HUNT IS OFFERED, NOT ASSUMED (admin 2026-10-13).
 *
 * Admin, verbatim: *"helper, verifier jo app banne ke bad last me check karta hai, ko optional kar do"* —
 * with a ❓ question button in the chat, "Yes" running the helper that already exists, and "No" meaning
 * the build is complete as it stands.
 *
 * 🔴 WHAT WAS ACTUALLY WRONG, AND IT IS WORSE THAN "NOT OPTIONAL". The post-build reviewer is a
 * multi-call model pass that the user ALREADY PAYS FOR, on every single build, without ever being
 * asked. The size of that is on the record — autopsy b6f88a72, quoted in the route beside the call:
 * *"40 calls, 523,374 input tokens = 34.4% of the build, `responseChars: 0` on every one, and then no
 * verdict at all — all of it billed at ×4"*. A third of a build's bill, for nothing, silently. So this
 * is not a new charge being introduced; it is an existing charge finally being shown to the person
 * paying it. The admin put it plainly: the real build costs x, the helper takes 4x.
 *
 * 🔒 WHAT IS *NOT* TOUCHED, AND WHY THAT IS THE POINT. The deterministic end-of-build checks — the tsc
 * gate, the lint gate, readiness, the playtest, the fake-feature scan, the journeys — spend no model
 * tokens, live in no billing phase, and are the EVIDENCE that the app was built at all. Making those
 * paid would mean a free build only ever yields "it probably works", which the second absolute rule
 * forbids outright. They stay free and they stay automatic. Only the model-driven hunt is offered.
 *
 * 🧬 THE CLASS THIS AVOIDS. A declined hunt must read as NOT RUN, never as PASSED — `playtestNotRunVerdict`'s
 * principle one level up: *a check that was never asked for is not a check that passed.* An app shipped
 * under a green tick that nobody earned is the failure mode the fifth absolute rule exists to kill.
 *
 * Everything here is PURE: no I/O, no clock, no env read except the one explicit kill switch.
 */

import type { ApprovalOutcome } from './Approvals';

/**
 * ⏱️ THE OFFER NEVER HOLDS THE END OF A BUILD (failedbr #2494, 2026-11-22; admin approved the fix the same day).
 *
 * The offer used to be a gate the finished build WAITED on — 90 s, then 30 s (autopsy 2f46a4d8). Build #2494 still
 * showed the cost of any wait at all: "Done", then "Waiting for your answer above", then 30 s later "the deep bug
 * hunt offer went unanswered, so it did not run". The app was finished; the user watched a spinner for a question
 * that changes nothing about it. 🧬 THE CLASS: a question about OPTIONAL extra work holding a finished turn open.
 * Shortening the wait never kills that class — only not waiting does.
 *
 * So the offer is now a standing ❗️ row (`bug_hunt_offer`, non-blocking), the turn ends the moment its work is
 * done, and the row's "Find and fix bugs" button starts a NEW turn that runs the hunt with the yes given up front
 * (`preApproved`, the path the ❗️ list already used for an expired offer). The user keeps the choice; nobody waits.
 * The retired wait (`AGENTV3_BUG_HUNT_WAIT_MS`) is gone, and `tests/aFinishedTurnHoldsNoQuestion.test.ts` fails if a
 * user wait reappears after the build's work.
 */

/** Kill switch. `off` restores today's behaviour exactly: the hunt runs, unasked, as it always has. */
export function bugHuntAskEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_BUG_HUNT_ASK ?? '').trim().toLowerCase() !== 'off';
}

export type BugHuntOffer =
  | { ask: true }
  | { ask: false; why: 'no-user' | 'ask-disabled' | 'review-not-eligible' | 'already-asked' };

/**
 * Whether to put the question in front of the user.
 *
 * 🔑 `reviewEligible` IS THE WHOLE GUARD AGAINST ASKING FOR A NO-OP. The reviewer already has a gate
 * (`reviewerShouldRun`) and several further conditions — the build succeeded, there is headroom left,
 * the review is not deferred to a Project Mode shell turn. Asking a user to spend credits on a pass
 * that was never going to run would be a charge for nothing, so this decision is made only once all of
 * that already says yes.
 *
 * An anonymous caller is never asked: there is no wallet to spend from, so the question could not be
 * honoured either way. PURE.
 */
export function bugHuntOfferDecision(input: {
  hasUser: boolean;
  askEnabled: boolean;
  reviewEligible: boolean;
  alreadyAsked: boolean;
}): BugHuntOffer {
  if (!input.reviewEligible) return { ask: false, why: 'review-not-eligible' };
  if (!input.askEnabled) return { ask: false, why: 'ask-disabled' };
  if (!input.hasUser) return { ask: false, why: 'no-user' };
  if (input.alreadyAsked) return { ask: false, why: 'already-asked' };
  return { ask: true };
}

/**
 * The question itself.
 *
 * 🔴 NO RUPEE FIGURE, AND THAT IS A CORRECTNESS DECISION, NOT A PRESENTATION ONE (admin 2026-10-13).
 * The hunt's cost is metered per token, so no honest number exists before it runs — a figure printed on
 * this button would be a fabricated quote, which `NO_FAKE_FEATURE_RULE` forbids as squarely as a fake
 * login. What the user is owed up front is that it COSTS and WHERE FROM; the exact amount reaches them
 * in the bill, priced by the settle's own function, exactly as today.
 *
 * 🔒 ENGLISH, DELIBERATELY. This is the PLATFORM speaking, not the AI, so `narrationCatalogue.ts`'s
 * rule applies: professional English (CLAUDE.md's Language standard, admin re-stated 2026-08-11). The
 * admin asked for the user's language here, and the reason this does not follow it is the admin's OWN
 * later correction: on 2026-09-14 they found a voice-chat PRICE rendered in Devanagari and asked
 * *"south india wale kaise padhenge isko??"*, which superseded three modules' "user's language"
 * behaviour. A price is the exact artefact of that correction, so translating this one would re-create
 * the thing they stopped. Raised with them rather than done quietly.
 */
export interface BugHuntOfferCopy {
  /** The short bold line. A question, because it is one. */
  title: string;
  /** The detail under it — what it does, that it spends credits, and that the app is already fine. */
  why: string;
  approveLabel: string;
  denyLabel: string;
}

export function bugHuntOfferCopy(): BugHuntOfferCopy {
  return {
    title: 'Find and fix bugs in your app?',
    why: 'A deep review reads your app\'s code, reports the real bugs it finds, and fixes what it can '
      + 'safely fix. It runs an AI engine, so it spends credits from your wallet — free and gift credits '
      + 'count. Your app is already built and working; this is an extra check, not a repair.',
    approveLabel: 'Find and fix bugs',
    denyLabel: 'Not now',
  };
}

/** Said when the user asked for the hunt but this turn's app never got to a state it can review. */
export function bugHuntCouldNotRunLine(): string {
  return 'You asked for the deep bug hunt, but it could not run this time: the app has to finish building and run '
    + 'first. Nothing was charged for it. Fix what stopped the build, then ask again.';
}

/** The standing offer's own words, as the `bug_hunt_offer` event carries them. No `action` string: it is not a gate. */
export interface BugHuntOfferEvent {
  title: string;
  why: string;
  approveLabel: string;
  denyLabel: string;
  callId: string;
}

/** What the gate decided, and the only thing the route needs back. */
export interface BugHuntResult {
  /** Run the post-build review? TRUE when it was not offered at all, so an un-offered build is unchanged. */
  runReview: boolean;
  /** `approved` only when the user started THIS turn as a bug hunt; `null` otherwise (nothing is waited on). */
  answer: ApprovalOutcome | null;
  /** TRUE when the standing ❗️ offer was put this turn — the hunt runs on a later turn, if the user taps it. */
  offered?: boolean;
}

/**
 * THE WHOLE FLOW, WITH ITS EFFECTS HANDED IN.
 *
 * 🔴 WHY IT LIVES HERE AND NOT IN THE ROUTE. The `/build` handler sits ON TypeScript's control-flow-
 * analysis ceiling (Q-979): the first version of this feature put its `let`, its nested `if`s and its two
 * `try`s inline, and the file stopped type-checking with TS2563 — the feature's own cost, paid by every
 * future change to that handler. Taking `offer` / `say` / `record` as arguments keeps the route at
 * one call and makes every branch below unit-testable without a server, a user or a clock.
 *
 * 🔑 THE FAIL-OPEN IS DELIBERATE AND IT IS THE SAFE DIRECTION. If anything here throws, `runReview` is
 * TRUE: the build behaves exactly as it did before this feature existed. The opposite default would let a
 * bug in an offer silently cancel the app's deepest check — a feature that quietly removes a safety net is
 * worse than one that fails loudly.
 */
export async function offerBugHunt(io: {
  /** Every other condition for the review already says yes. FALSE ⇒ nothing is offered and nothing changes. */
  eligible: boolean;
  hasUser: boolean;
  newCallId: () => string;
  /** Puts the standing offer in front of the user (a non-blocking ❗️ row). Nothing waits on it. */
  offer: (event: BugHuntOfferEvent) => void;
  say: (text: string) => void;
  record: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  /**
   * The user already said yes, from the ❗️ list, by starting THIS turn as a bug hunt (admin 2026-11-21: "click
   * karo, kuch bhi nahi hota"). A yes given up front is not asked again; an ineligible app is told why it did not run.
   */
  preApproved?: boolean;
}): Promise<BugHuntResult> {
  if (io.preApproved) {
    if (io.eligible) return { runReview: true, answer: 'approved' };
    io.say(bugHuntCouldNotRunLine());
    io.record('The user asked for the deep bug hunt, and it could not run: the app did not finish building and running this turn.');
    return { runReview: false, answer: 'approved' };
  }
  const offer = bugHuntOfferDecision({
    hasUser: io.hasUser,
    askEnabled: bugHuntAskEnabled(io.env ?? process.env),
    reviewEligible: io.eligible,
    alreadyAsked: false, // the offer is scoped to this turn, so the next edit offers again
  });
  if (!offer.ask) return { runReview: io.eligible, answer: null };

  try {
    const copy = bugHuntOfferCopy();
    io.offer({
      title: copy.title,
      why: copy.why,
      approveLabel: copy.approveLabel,
      denyLabel: copy.denyLabel,
      callId: io.newCallId(),
    });
  } catch {
    // Fail-open, as before: an offer that could not be shown must never silently cancel the app's deepest check.
    return { runReview: true, answer: null };
  }
  // Offered and not taken yet: it does not run THIS turn, and it is reported as NOT RUN — never as passed.
  io.record('The deep bug hunt was offered without holding the build open, and did not run this turn: the offer stays '
    + 'in the user\'s list and runs on a new turn only if they ask. The app\'s own end-of-build checks ran as always.');
  io.say(bugHuntOfferedLine());
  return { runReview: false, answer: null, offered: true };
}

/**
 * What the user reads at the end of a turn that offered the hunt. It says the hunt did NOT run (never a pass), that it
 * costs, and exactly where the choice is — the turn itself is already over.
 */
export function bugHuntOfferedLine(): string {
  return 'Your app is built. The deep bug hunt did not run, because it spends credits and runs only when you ask: '
    + 'open ❗️ and tap "Find and fix bugs" whenever you want it, and it will run on the app as it stands.';
}

/** The optional offer promises an extra check on an app that already ran, never an infrastructure repair.
 * Shared by the offer and paid-review doors; callers re-read Stop after waiting. No price/policy changes.
 */
export function completedAppReviewEligible(input: { ok: boolean; headroom: boolean; allowed: boolean;
  deferred: boolean; runProven: boolean; stopped: boolean }): boolean {
  return input.ok && input.headroom && input.allowed && !input.deferred && input.runProven && !input.stopped;
}

/**
 * 🐞 "FIND AND FIX BUGS" IS A HUNT, NOT A SIDE REMARK (admin 2026-11-21: "find and fix the bugs par click karne se sach me
 * bugs dhund ke fix kiye jaye!").
 *
 * 🧬 THE CLASS: the button sent one sentence, "Find and fix the bugs in my app.", and ran the ordinary post-build review —
 * which by design reads only the files THIS turn changed, is suggest-only on a working app, and does not run at all when the
 * turn wrote nothing. So a turn whose whole job was to hunt read almost nothing and fixed almost nothing. Three things change
 * when the USER pressed the button (`bugHunt: true`), and only then:
 *   1. the builder is handed a real hunting method (this brief) — it reads the WHOLE app, checks it, fixes each real bug;
 *   2. the review afterwards reads the whole app, not just this turn's edits (`bugHuntReviewScope`), and runs even when the
 *      builder found nothing to change;
 *   3. the review runs at full strength, and its functional findings go to the verified repair (re-checked in a real
 *      browser, undone if the app stops rendering) — never a silent rewrite of a working app.
 * An ordinary build is byte-identical.
 */
export const BUG_HUNT_TURN_BRIEF = [
  '[BUG HUNT — the user pressed "Find and fix bugs". Your whole job this turn is to FIND real bugs in the app that is here and FIX them.]',
  'Method — do every step:',
  '1. List the project files and READ every source file of the app (src/**, the server if there is one). Do not stop at the files you',
  '   changed before, and do not judge a file you have not opened.',
  '2. Run the typecheck/build and read the preview\'s console and network errors. Every error is a bug.',
  '3. Look for real defects: a button or control that does nothing, a handler that is never wired, state that never updates, data that is',
  '   never saved or loaded, a crash path (undefined access, missing import, wrong prop), a broken route, a loop that never ends, a',
  '   control that cannot be reached on a phone. In a game also: input that does not move the player, a camera that does not follow,',
  '   a feature listed in src/game/features/index.ts that never runs.',
  '4. Fix each real bug with the smallest change that fixes it, then re-check that it is fixed. Change NOTHING that is not a bug: no new',
  '   features, no restyling, no renaming, no "improvements". Never change a file of the game kit (the engine) — if the bug is there,',
  '   report it instead.',
  '5. Finish with an honest list in the user\'s language: each bug you found (file, what was wrong, what you changed), and what you',
  '   checked and found working. If you found no real bug, say so plainly — never invent one, and never claim a fix you did not make.',
].join('\n');


/** At most this many files are handed to the whole-app review (the reviewer reads the rest from the tree it is given). */
export const BUG_HUNT_REVIEW_MAX_FILES = 80;

/**
 * What the review reads: on a user-pressed hunt, the whole app's own source (never dependencies, build output, lockfiles or
 * the game kit's engine files); otherwise exactly the files this turn changed. PURE.
 */
export function bugHuntReviewScope(input: {
  askedByUser: boolean;
  allFiles: readonly string[];
  changed: () => string[];
  isKitFile?: (path: string) => boolean;
}): string[] {
  if (!input.askedByUser) return input.changed();
  const own = input.allFiles.filter((p) => typeof p === 'string'
    && /\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|py|css|html)$/i.test(p)
    && !/(^|\/)(?:node_modules|dist|build|\.next|coverage|\.git)\//.test(p)
    && !/\.(?:test|spec)\.[tj]sx?$/i.test(p)
    && !/\.d\.ts$/i.test(p)
    && !(input.isKitFile?.(p) ?? false));
  const changed = input.changed();
  // This turn's own edits first (the builder just touched them), then the rest of the app.
  return [...new Set([...changed.filter((p) => own.includes(p)), ...own])].slice(0, BUG_HUNT_REVIEW_MAX_FILES);
}
