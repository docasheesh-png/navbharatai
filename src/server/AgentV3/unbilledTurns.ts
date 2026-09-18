// AgentV3 — A TURN THAT PRODUCED NOTHING IS OUR COST, NEVER THE USER'S BILL.
//
// ROOT CAUSE (admin 2026-09-18, build b6f88a72). The admin's own question was "kya ham ₹ kuch jyada
// hi charge to nahi kar rahe hai?", and the honest answer was: the 4× markup is not the problem —
// applying it to work that delivered nothing is. That build's post-build reviewer consumed ~520,000
// input tokens and returned `responseChars: 0` on every single call, and the user paid the full
// tiered markup on all of it.
//
// THE CLASS, stated so it is recognised again: `turnStarvedItsBudget` (floorBudget.ts) already names
// the exact turn that carries nothing a caller can use — no text, no tool call, and either truncated
// or reasoning-only. Two completely different things then happened to those tokens depending on
// WHICH runner produced them, and both were wrong in opposite directions:
//
//   • A runner that THROWS on starvation (OpenAiToolRunner, i.e. every GLM/Kimi rung) rejects before
//     `onTurnComplete` is ever called. So the tokens reached NEITHER the ledger NOR the build sink:
//     real money we paid a provider, recorded nowhere, invisible to the admin cost card and to
//     `buildCostCeiling`'s mid-build stop. This is the "abandoned provider call recorded as zero
//     tokens" open root cause, closed here.
//   • A runner that does NOT throw (the Claude path — AgentRunner carries its own net at the loop
//     level instead) returns the starved turn as a success, so the tokens went into the sink AND the
//     ledger AND straight onto the user's bill at ×4.
//
// THE RULE, one sentence: those tokens are counted in full as OUR cost (the admin's figure, and the
// mid-build cost ceiling, must see every rupee we really spent) and are subtracted from the base the
// user's markup is applied to. The gap is therefore visible by construction on the admin cost card,
// which already prints real cost beside the bill — a clamp that quietly shrank OUR number too would
// hide our own bleeding on the very panel used to judge it, which is exactly the shape of the
// `E2B_USD_PER_HOUR` drift this repo already paid for once.
//
// ⚠️ WHAT THIS IS NOT. It is the honesty layer (rule 5), not the cost fix (rule 4). The real saving
// is not spending those tokens at all — a reviewer that cannot write to a green app should not be
// reading the whole project at full budget either. That is a separate change. This one only
// guarantees that when it happens anyway, the user does not pay for it.
//
// PURE: no clock, no environment, no I/O. Every rule here is unit-testable and cannot lie.

import { realProviderCostUsd, type ProviderCostEntry } from './providerRates';
import { NO_BARREN_PHASES, type BarrenPhases } from './billingPhase';

/** The token counts of one turn, in the shape the ledger and the rate card both already use. */
export interface UnbilledTokens {
  inputTokens: number;
  outputTokens: number;
  /** The cache-hit share of `inputTokens` (already INCLUDED in it, never additional). */
  cacheReadInputTokens?: number;
}

/**
 * A ledger slice, plus the subset of it that produced nothing.
 *
 * `unbilled` is a SUBSET of `usage`, never additional — the same relationship `cacheReadInputTokens`
 * has to `inputTokens`. Keeping it as a separate field rather than deducting it from `usage` is the
 * load-bearing choice: `usage` stays the truth about what we spent, so `realProviderCostUsd` and the
 * cost ceiling keep pricing the whole thing, and only the code that builds the USER's bill subtracts.
 */
export interface UnbilledAwareEntry extends ProviderCostEntry {
  usage: ProviderCostEntry['usage'] & { cacheReadInputTokens?: number };
  unbilled?: UnbilledTokens;
  /** Which part of the build spent this slice — see `billingPhase.ts`. */
  phase?: string;
}

/** Non-finite and negative counts are dropped rather than trusted. */
function clean(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Add `add` into `into`, in place. Both are token counts, never costs. */
export function addUnbilled(into: UnbilledTokens, add: UnbilledTokens): void {
  into.inputTokens += clean(add.inputTokens);
  into.outputTokens += clean(add.outputTokens);
  const cache = clean(add.cacheReadInputTokens);
  if (cache > 0) into.cacheReadInputTokens = clean(into.cacheReadInputTokens) + cache;
}

/**
 * The entries as the USER should be billed: each slice minus the tokens that produced nothing.
 *
 * Clamped at zero per field, so a malformed `unbilled` larger than its own slice can only ever bill
 * the user LESS — the only direction the billing law permits being wrong in. Returns NEW objects;
 * the input is never mutated, because the caller still needs the full figures for OUR cost.
 *
 * A slice belonging to a BARREN PHASE is unbilled in its ENTIRETY, whatever its own `unbilled` says.
 * 🔒 That is a UNION, never a sum: a starved turn inside a barren pass is already counted in
 * `unbilled`, and adding the two would subtract the same tokens twice and hand back money we never
 * spent. Taking the whole slice is idempotent — the two rules may overlap freely and the answer does
 * not move.
 */
export function billableEntries(
  entries: readonly UnbilledAwareEntry[],
  barrenPhases: BarrenPhases = NO_BARREN_PHASES,
): ProviderCostEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    if (e.phase && barrenPhases.has(e.phase)) {
      return { provider: e.provider, ...(e.model ? { model: e.model } : {}), usage: { inputTokens: 0, outputTokens: 0 } };
    }
    const u = e.unbilled;
    if (!u) return { provider: e.provider, ...(e.model ? { model: e.model } : {}), usage: { ...e.usage } };
    const inputTokens = Math.max(0, clean(e.usage.inputTokens) - clean(u.inputTokens));
    const outputTokens = Math.max(0, clean(e.usage.outputTokens) - clean(u.outputTokens));
    const cacheRead = Math.max(0, clean(e.usage.cacheReadInputTokens) - clean(u.cacheReadInputTokens));
    return {
      provider: e.provider,
      ...(e.model ? { model: e.model } : {}),
      // The cache share can never exceed the input it is a share OF — `usageCostUsd` clamps this
      // too, but a slice that leaves here already coherent cannot be misread by a future caller.
      usage: { inputTokens, outputTokens, ...(cacheRead > 0 ? { cacheReadInputTokens: Math.min(inputTokens, cacheRead) } : {}) },
    };
  });
}

/**
 * Split one build's ledger into what the user is billed for and what we absorb, in USD.
 *
 * Both halves are priced by the SAME rate card through the SAME function, and the absorbed figure is
 * DERIVED as the difference rather than priced separately — so the two can never disagree, and an
 * explanation shown to the admin can never diverge from the amount actually charged. The
 * `remainder` (the unattributed aux calls) is billable by definition: we have no per-turn record of
 * it at all, so we cannot claim any of it produced nothing — and it carries no phase either, so a
 * barren phase can never reach it.
 */
export function splitUnbilledCost(
  entries: readonly UnbilledAwareEntry[],
  remainder: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
  barrenPhases: BarrenPhases = NO_BARREN_PHASES,
): { realCostUsd: number; billableCostUsd: number; absorbedCostUsd: number } {
  const realCostUsd = realProviderCostUsd(entries as ProviderCostEntry[], remainder);
  const billableCostUsd = realProviderCostUsd(billableEntries(entries, barrenPhases), remainder);
  // Clamped, and never allowed to exceed the real cost: absorbing more than we spent would be an
  // invented number, which is the one thing the billing law forbids in either direction.
  const absorbedCostUsd = Math.min(realCostUsd, Math.max(0, realCostUsd - billableCostUsd));
  return { realCostUsd, billableCostUsd: Math.max(0, billableCostUsd), absorbedCostUsd };
}

/**
 * The usage of a turn that was ABANDONED — thrown away by its own runner because it carried nothing.
 *
 * Carried ON the error rather than through a second callback, deliberately. `onTurnComplete` is
 * already the one choke point every build turn and every heal turn passes through, and this file's
 * own header records what a second parallel channel costs: the heal gates that forgot to thread
 * `onTurnComplete` had their tokens silently attributed to 'other' for months. One channel, one
 * place to remember.
 */
export interface AbandonedTurn {
  usage: UnbilledTokens;
  /** The model that was called, when the thrower knew it. */
  model?: string;
}

/** Property key for the carried usage. A Symbol so it can never collide with a provider SDK's own
 *  error fields, and `Symbol.for` so two copies of this module in one process still agree. */
const ABANDONED_TURN = Symbol.for('navbharatai.agentv3.abandonedTurn');

/**
 * Attach a doomed turn's measured usage to the error that discards it, and return that same error so
 * the call site stays a single `throw`.
 *
 * Best-effort by construction: a frozen or non-object error is returned untouched rather than
 * throwing a second error out of a failure path. Unmeasured usage (all zeros) attaches nothing —
 * "we do not know" must never be recorded as a measured zero.
 */
export function markAbandonedTurn<E>(err: E, usage: UnbilledTokens | null | undefined, model?: string): E {
  if (!err || typeof err !== 'object' || !usage) return err;
  const carried: UnbilledTokens = {
    inputTokens: clean(usage.inputTokens),
    outputTokens: clean(usage.outputTokens),
    ...(clean(usage.cacheReadInputTokens) > 0 ? { cacheReadInputTokens: clean(usage.cacheReadInputTokens) } : {}),
  };
  if (carried.inputTokens === 0 && carried.outputTokens === 0) return err;
  try {
    Object.defineProperty(err, ABANDONED_TURN, {
      value: { usage: carried, ...(model && model.trim() ? { model } : {}) } satisfies AbandonedTurn,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch { /* an error we cannot annotate is still an error — never fail a failure path */ }
  return err;
}

/** Read back what `markAbandonedTurn` attached, or null. PURE. */
export function abandonedTurnUsage(err: unknown): AbandonedTurn | null {
  if (!err || typeof err !== 'object') return null;
  const carried = (err as Record<symbol, unknown>)[ABANDONED_TURN];
  if (!carried || typeof carried !== 'object') return null;
  const { usage, model } = carried as AbandonedTurn;
  if (!usage || typeof usage !== 'object') return null;
  return { usage, ...(typeof model === 'string' && model ? { model } : {}) };
}
