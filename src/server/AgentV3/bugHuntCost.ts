/**
 * WHAT THE DEEP BUG HUNT COST, SAID IN THE REPORT (Q-1042, admin 2026-10-13).
 *
 * 🔴 WHY THIS EXISTS BEFORE ANY ROUTING CHANGE. The admin's own instinct about the post-build review is
 * the right one — *"aap help ko glm se chalo to sayad sasta chale?"* — and the figure behind it is on the
 * record: autopsy b6f88a72, quoted in the route beside the reviewer call, *"523,374 input tokens = 34.4%
 * of the build … all of it billed at ×4"*. One build, one number, found by reading a report by hand.
 *
 * The decision that number argues for (run the hunt on the cheap rung) is a MODEL ROUTING change, and
 * `cheapBuildFloorRunners` carries six separate verbatim admin decisions with env overrides that always
 * win — CLAUDE.md says to confirm before touching any of it. So this module does not touch routing. It
 * makes the number the decision needs appear on EVERY build instead of one archaeological read, so the
 * choice can be made from a trend rather than from a single anecdote.
 *
 * It is also the other half of Q-1040: now that the user is ASKED to pay for the hunt, the record should
 * say what that yes actually cost them.
 *
 * 🔒 THREE THINGS IT DELIBERATELY DOES NOT DO.
 *
 * 1. **It names no engine.** The build report reaches the USER (⋮ More → Report), and the White-Label Law
 *    is absolute: a user never sees a vendor or model name. The share answers the question anyway — which
 *    is what 34.4% did — and the per-rung detail already exists on the admin-only surfaces.
 * 2. **It invents no rupee figure for the slice.** The bill is the markup (and then the discount) applied
 *    to the build's TOTAL, not to each slice, so a per-slice ₹ would be a number nobody computed. That is
 *    the exact class this repo keeps paying for (Q-1035's un-failable test, Q-1036's `charged`). The share
 *    of the ENGINE cost is a real measurement; a rupee slice would be a plausible fabrication.
 * 3. **It says nothing when the hunt did not run.** Consistent with Q-1040's not-run line: a pass that did
 *    not happen has no cost to report, and a "0%" line would read as a hunt that found nothing for free.
 *
 * The cost itself comes from `realProviderCostUsd` — the ONE cost function — never a re-derivation.
 */

import { realProviderCostUsd, type ProviderCostEntry } from './providerRates';
import { PHASE_POST_BUILD_REVIEW } from './billingPhase';

/** What a ledger slice looks like to this module: the shape `ProviderUsageLedger.entries()` returns. */
export interface PhasedEntry extends ProviderCostEntry {
  phase?: string;
}

export interface HuntCostReading {
  /** Did any slice carry the hunt's phase? FALSE ⇒ it did not run, and nothing is reported. */
  ran: boolean;
  /** The hunt's own provider cost in USD, priced by `realProviderCostUsd`. */
  realUsd: number;
  /** Its share of the build's whole provider cost, 0–100, or null when the build's cost is zero. */
  sharePct: number | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The hunt's slice of this build's engine cost. PURE.
 *
 * `entries` is the whole build's ledger; the hunt's slices are the ones carrying its phase. The total is
 * recomputed from the SAME entries by the same function, so the share can never be a ratio of two numbers
 * priced differently — which is how a plausible wrong percentage gets written down.
 */
export function bugHuntCostReading(entries: readonly PhasedEntry[]): HuntCostReading {
  const mine = entries.filter((e) => e.phase === PHASE_POST_BUILD_REVIEW);
  if (mine.length === 0) return { ran: false, realUsd: 0, sharePct: null, inputTokens: 0, outputTokens: 0 };
  const realUsd = realProviderCostUsd(mine as ProviderCostEntry[]);
  const totalUsd = realProviderCostUsd(entries as ProviderCostEntry[]);
  const sharePct = totalUsd > 0 && Number.isFinite(totalUsd) && Number.isFinite(realUsd)
    ? Math.round((realUsd / totalUsd) * 1000) / 10
    : null;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of mine) {
    inputTokens += Number.isFinite(e.usage.inputTokens) ? e.usage.inputTokens : 0;
    outputTokens += Number.isFinite(e.usage.outputTokens) ? e.usage.outputTokens : 0;
  }
  return { ran: true, realUsd, sharePct, inputTokens, outputTokens };
}

/**
 * The report line, or null when there is nothing honest to say.
 *
 * Names no engine (the report reaches the user) and states no rupee figure for the slice (the markup is
 * applied to the build's total, not per slice — see this file's header).
 */
export function bugHuntCostLine(r: HuntCostReading): string | null {
  if (!r.ran) return null;
  const tokens = `${r.inputTokens.toLocaleString('en-IN')} in / ${r.outputTokens.toLocaleString('en-IN')} out`;
  const share = r.sharePct === null
    ? 'its share of this build\'s engine cost could not be measured (the build recorded no engine cost)'
    : `${r.sharePct}% of this build's engine cost`;
  return `The deep bug hunt ran and was ${share} (${tokens} tokens). `
    + 'It is the one pass you are asked about before it runs, so this is what that choice cost.';
}
