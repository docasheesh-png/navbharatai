// A CEILING ON WHAT ONE BUILD MAY COST US — the mid-build stop.
//
// THE GAP THIS CLOSES (admin 2026-09-13, two screenshots one day apart: an account at −₹506.03 and
// another at −₹1,198.41). Every START gate was already correct — `decideAffordability` refuses a new
// build at a balance of 0 or less. And since the wallet floor shipped, the USER's bill is bounded too.
// What remained unbounded is the thing in the middle: **the build already running.** Nothing looked at
// its cost while it ran, so a build legitimately allowed to begin could spend for its whole wall clock
// and present the invoice at the end. Clamping the debit bounds what the user PAYS; it does not
// un-spend what the model already cost us. Only stopping does that.
//
// 🔒 THIS IS A STOP, NOT A KILL — which is what makes a conservative ceiling safe against the one
// absolute rule. `AgentRunner` ends BETWEEN turns, the files written so far are already persisted, and
// `abortSummary` tells the user their work is saved and one message resumes it. A build that reaches
// the ceiling therefore loses no work; it pauses. That is a completely different act from failing one,
// and it is why this can ship on by default instead of hiding behind a flag nobody turns on.
//
// 🔴 THE NUMBER IS NOT INVENTED, AND ITS PROVENANCE MATTERS MORE THAN ITS VALUE. $5 is this repo's own
// existing answer to "a build has run away" — `sessionCostCapUsd()` has carried that default since the
// "$26 todo app" incident. Reusing it means no new constant was made up to sound rigorous (the exact
// failure mode CLAUDE.md records for the E2B rate). It lives under its OWN key because extending the
// meaning of `SESSION_COST_CAP_USD` would silently re-purpose a value an admin may already have set
// for the empty-build retry budget — one key must never quietly govern two things.
//
// For scale: real builds in this repo's own reports cost us **$0.4–$1.0** (the ₹566.96 Shiv Medical
// Store build was 776k tokens at cheap-floor rates; PaisaTrack's real cost was ₹39 ≈ $0.45). So $5 is
// five to ten times a heavy normal build — generous enough that no legitimate build is near it, and
// still the difference between a bounded ~₹435 and an unbounded loss.
//
// ⚠️ THE LIVE NUMBER IS AN UNDER-ESTIMATE, AND THAT IS THE SAFE DIRECTION. The ledger sees the
// architect, its sub-agents and every heal runner; it does NOT see the auxiliary calls (blueprint,
// plan, judge), which reconcile into the 'other' bucket only at settle. So the cost this module reads
// is always ≤ the build's true cost, and the stop therefore fires LATER than a complete number would
// justify — never earlier. Reporting it as complete would be the lie; under-reading it is merely
// cautious.

import { realProviderCostUsd, type ProviderCostEntry } from './providerRates';

/** The default ceiling on ONE build's real provider cost (USD). See the header for its provenance. */
export const DEFAULT_BUILD_COST_CEILING_USD = 5;

/** The highest ceiling an env value may set. A typo of `500` must not restore an unbounded build. */
export const MAX_BUILD_COST_CEILING_USD = 50;

/**
 * The configured ceiling, in USD of REAL provider cost.
 *
 * `AGENTV3_BUILD_COST_CEILING_USD` overrides it. An explicit `0` — and only an explicit `0` — means
 * "no ceiling", because an operator who wants the old unbounded behaviour deserves a way to say so
 * that cannot be reached by accident. Everything else unreadable (empty, `abc`, negative) falls back
 * to the default: a value that is PRESENT and unparseable can never have been intended as "off",
 * which is the same reasoning `parseRolloutPercent` already applies to a malformed percentage.
 */
export function buildCostCeilingUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.AGENTV3_BUILD_COST_CEILING_USD ?? '').trim().replace(/[$,\s]/g, '');
  if (raw === '0') return 0; // explicit opt-out
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return DEFAULT_BUILD_COST_CEILING_USD;
  return Math.min(n, MAX_BUILD_COST_CEILING_USD);
}

/** What the live ledger currently prices at, in USD. Pure — it never reads the environment. */
export function ledgerCostUsd(entries: ProviderCostEntry[]): number {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  return realProviderCostUsd(entries);
}

export interface CeilingVerdict {
  /** Stop the build between turns. */
  stop: boolean;
  /** The cost read off the ledger at this moment (USD) — an under-estimate, see the header. */
  costUsd: number;
  /** The ceiling it was compared against (USD). 0 means no ceiling is configured. */
  ceilingUsd: number;
}

/**
 * Has this build spent past its ceiling?
 *
 * A ceiling of 0 (explicitly opted out) never stops anything. A non-finite cost never stops anything
 * either — a measurement we could not take must not end somebody's build.
 */
export function checkCostCeiling(costUsd: number, ceilingUsd: number): CeilingVerdict {
  const cost = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
  const ceiling = Number.isFinite(ceilingUsd) && ceilingUsd > 0 ? ceilingUsd : 0;
  return { stop: ceiling > 0 && cost >= ceiling, costUsd: cost, ceilingUsd: ceiling };
}

/**
 * The ADMIN-facing line for the build report.
 *
 * Admin-only, so it may carry our own cost — the user never sees what a build cost NavBharatAI, only
 * what they were charged (the White-Label Law's billing half).
 */
export function costCeilingDetail(v: CeilingVerdict): string {
  return `Build stopped at the cost ceiling: about $${v.costUsd.toFixed(2)} of measured provider cost `
    + `against a ceiling of $${v.ceilingUsd.toFixed(2)}. The measured figure excludes unattributed aux `
    + `calls, so the real cost is at least this much. Raise or disable it with `
    + `AGENTV3_BUILD_COST_CEILING_USD (0 = no ceiling).`;
}
