// WHICH PART OF THE BUILD SPENT THIS MONEY — the dimension the provider ledger never had.
//
// ## The gap, as the admin found it
//
// Build `b6f88a72`: the post-build reviewer made 40 model calls, spent **523,374 input tokens = 34.4%
// of the build's LLM cost (≈₹12)**, returned `responseChars: 0` on every one of them, and then timed
// out with no verdict at all. The user paid the full 4× markup on all of it. The admin's question was
// *"kya ham ₹ kuch jyada hi charge to nahi kar rahe hai??"*, and the honest answer was that the
// markup is fine — charging it for work that delivered nothing is not.
//
// `unbilledTurns.ts` fixed the TURN-level half of that: a turn that produced no text and no tool call
// is our cost and never the user's bill. It deliberately could not fix this one, and said so: the
// reviewer's turns were NOT starved — they completed, made tool calls, and read files. Each turn
// produced something. **The PASS produced nothing.**
//
// And that was inexpressible, because `ProviderUsageLedger` records which VENDOR was paid and never
// what FOR. "Leave the reviewer's barren pass out of the bill" had nowhere to be written down.
//
// ## Why a zone, and why not `runInPass`
//
// The mechanism is the one `aiSpendZone.ts` and `noClaudeZone.ts` already use, for the reason
// `aiSpendZone` states: threading a label through every call site is fragile by design — one missed
// site is one silent mis-attribution, and the heal gates that forgot to thread `onTurnComplete` had
// their tokens filed under 'other' for months. A zone is inherited by every awaited descendant, so a
// pass is attributed by opening it ONCE.
//
// ⚠️ **`greenFreeze.ts`'s `runInPass` is the same MECHANISM answering a different QUESTION** — it
// decides whether a pass may WRITE to a green app. Overloading it to also carry money would tie two
// unrelated policies to one string: a pass that must be allowed to write but billed, or billed but
// not allowed to write, could not then be expressed. Same shape, separate zone, on purpose.
//
// ## The property that makes this correct for an ABANDONED pass
//
// `raceTimeout` gives up on the reviewer; the reviewer keeps running and keeps spending. Because the
// zone propagates through awaits, those late turns are still tagged — and because "this phase was
// barren" is applied at SETTLE rather than by mutating the ledger, tokens that arrive after the
// verdict are covered by it too. A pass we walked away from is exactly the money this exists to find.
//
// PURE mechanism: no clock, no I/O, no environment. Node built-in only.

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The post-build completeness reviewer.
 *
 * The only phase named today, and deliberately so: it is the only pass whose "delivered nothing"
 * verdict ALREADY EXISTS in the route (`REVIEW_INCOMPLETE`). Inventing that verdict for the other
 * passes would be a guess, and a guess that hands money back is still a guess. Adding a second phase
 * is one `runInBillingPhase` call plus the rule that decides it is barren — never a rule alone.
 */
export const PHASE_POST_BUILD_REVIEW = 'post-build-review';

const storage = new AsyncLocalStorage<{ name: string }>();

/**
 * Run `fn` inside a billing phase, so every model call it makes — directly or in any awaited
 * descendant — is attributed to `name`.
 *
 * Nesting takes the INNERMOST phase, which is the same rule `runInPass` uses: the nearest enclosing
 * label is the one that describes the work actually being done. A blank name opens no zone rather
 * than an unnamed one — an empty string as a key would silently merge with the un-phased turns it is
 * supposed to be distinguished from.
 */
export function runInBillingPhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return fn();
  return storage.run({ name: trimmed }, fn);
}

/** The phase currently executing, or null outside any. PURE. */
export function currentBillingPhase(): string | null {
  return storage.getStore()?.name ?? null;
}

/**
 * The phases whose spend a build will NOT pass on, accumulated as the build discovers them.
 *
 * A plain Set behind a named type, because the thing worth naming is the RULE: a phase goes in here
 * only when the engine has positively established that it delivered nothing a caller could use —
 * never because it was slow, expensive, or merely disappointing.
 */
export type BarrenPhases = ReadonlySet<string>;

/** An empty verdict set — the default, and exactly today's billing. */
export const NO_BARREN_PHASES: BarrenPhases = new Set<string>();
