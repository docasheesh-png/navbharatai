// HOW DEEP DID THIS BUILD GO DOWN ITS LADDER? — the number nobody had, and every argument needed.
//
// 🔴 WHY THIS EXISTS (admin, 2026-09-20). Asked whether model "thinking" could simply be switched off,
// the honest answer turned out to be that it already IS off wherever it can be: Anthropic adaptive
// thinking is hardcoded `false` in the panel, and the lead rung `glm-4.7-flashx` is sent
// `thinking: disabled` (see providers/glmThinking.ts). What the admin was seeing came from the rungs
// BELOW the lead — `kimi-k2.7-code` and `glm-5.3`, both of which reason unconditionally and expose no
// switch. So the size of that problem is exactly one question: **how often does a build leave rung 1?**
//
// Nothing in this repo could answer it. `deliveredVia` records the VENDOR ('GLM'), and on Weak and
// Normal the vendor GLM occupies rung 1 (`glm-4.7-flashx`) AND rung 3 (`glm-5.3`) — so a build that
// fell two rungs and one that never left the first are indistinguishable in that field. `escalations`
// counts TIER escalations, a different mechanism entirely (a whole re-run on a higher tier), and is 0
// for every ordinary fall down the rungs inside one tier.
//
// ⚠️ THIS MODULE MEASURES AND DECIDES NOTHING. It reads what already happened and produces a number.
// It must never be allowed to influence routing: a rung is chosen by `tierLadder.ts`, and a
// measurement that feeds back into the thing it measures stops being a measurement.
//
// 🔒 AN UNRECOGNISED MODEL IS NEVER GUESSED INTO A RUNG. A build whose ledger names a model no rung
// claims returns `unmatched` and leaves `depth` null rather than rounding to the nearest rung — the
// same default-deny this repo already applies in glmThinking.ts, and for the same reason: a plausible
// wrong number is worse than an honest absence, because only one of them stops being trusted.

import type { LadderRung } from './tierLadder';
import { UNATTRIBUTED_PROVIDER } from './ProviderUsageLedger';

/** The slice of a provider-ledger entry this module needs. Structural, so the ledger can grow. */
export interface DeliveredSlice {
  provider: string;
  model?: string;
  usage: { outputTokens: number };
}

export interface LadderDepth {
  /** 1-based index of the DEEPEST rung that produced output, or null when nothing matched a rung. */
  depth: number | null;
  /** How many rungs the tier's ladder has, so `depth` can be read as "2 of 5". */
  rungCount: number;
  /** Slices that matched a rung, and slices that named a model no rung claims. */
  matched: number;
  unmatched: number;
}

/**
 * The Claude rungs name a FAMILY ('haiku' / 'sonnet' / 'opus'), while the ledger records the real
 * versioned id ('claude-3-5-haiku-20241022'). Every other rung names the exact id the provider is
 * called with, so those match exactly and must NOT be substring-matched — `glm-4.7-flash` is a
 * substring of `glm-4.7-flashx`, two different models at different prices, and a loose match here
 * would silently report the wrong rung.
 */
const FAMILY_RUNGS: ReadonlySet<string> = new Set(['haiku', 'sonnet', 'opus']);

function normalise(id: string | undefined): string {
  return typeof id === 'string' ? id.trim().toLowerCase() : '';
}

/**
 * Which rung did this slice come from? PURE. Returns a 0-based index, or null when nothing claims it.
 *
 * Matching is deliberately ordered from most specific to least:
 *   1. exact model id — the only match allowed for a rung that names a concrete id;
 *   2. family word inside the id — only for the Claude rungs, which name a family by design;
 *   3. provider alone — only when the rung's provider appears EXACTLY ONCE in the ladder, so "GLM"
 *      can never be silently resolved to rung 1 on a ladder where GLM is also rung 3.
 */
export function rungIndexFor(slice: DeliveredSlice, rungs: readonly LadderRung[]): number | null {
  const provider = normalise(slice.provider);
  if (!provider || provider === UNATTRIBUTED_PROVIDER) return null;
  const model = normalise(slice.model);

  if (model) {
    const exact = rungs.findIndex((r) => normalise(r.model) === model);
    if (exact >= 0) return exact;

    const family = rungs.findIndex((r) => {
      const rungModel = normalise(r.model);
      return FAMILY_RUNGS.has(rungModel) && new RegExp(`\\b${rungModel}\\b`).test(model);
    });
    if (family >= 0) return family;
  }

  // Provider-only, and ONLY when it is unambiguous on this ladder.
  const byProvider = rungs
    .map((r, i) => ({ i, provider: normalise(r.provider) }))
    .filter((r) => r.provider === provider || r.provider.replace(/_.*$/, '') === provider);
  if (byProvider.length === 1) return byProvider[0].i;

  return null;
}

/**
 * The deepest rung that actually DELIVERED. PURE.
 *
 * ⚠️ Only a slice that produced OUTPUT tokens counts. A rung that was tried and threw spends input
 * and returns nothing, and counting it would report a build as "fell to rung 3" when rung 3 never
 * wrote a character — the opposite of what the number is for. This is the same distinction
 * `slowRungBench.ts` draws when it refuses to score an unmeasured turn.
 */
export function ladderDepthUsed(
  slices: readonly DeliveredSlice[],
  rungs: readonly LadderRung[],
): LadderDepth {
  let depth: number | null = null;
  let matched = 0;
  let unmatched = 0;

  for (const slice of slices) {
    const out = Number(slice?.usage?.outputTokens);
    if (!Number.isFinite(out) || out <= 0) continue;
    if (normalise(slice.provider) === UNATTRIBUTED_PROVIDER) continue;

    const idx = rungIndexFor(slice, rungs);
    if (idx == null) {
      unmatched++;
      continue;
    }
    matched++;
    const oneBased = idx + 1;
    if (depth == null || oneBased > depth) depth = oneBased;
  }

  return { depth, rungCount: rungs.length, matched, unmatched };
}

/** One admin-readable line for the build report. Never shown to a user (it names rungs). */
export function describeLadderDepth(d: LadderDepth): string {
  if (d.depth == null) {
    return d.unmatched > 0
      ? `Ladder depth unknown — ${d.unmatched} delivered slice(s) named a model no rung of this tier claims.`
      : 'Ladder depth unknown — no delivered slice could be attributed to a rung.';
  }
  const tail = d.unmatched > 0 ? ` (${d.unmatched} slice(s) unattributed)` : '';
  return d.depth === 1
    ? `Finished on rung 1 of ${d.rungCount} — the lead rung delivered the whole build${tail}.`
    : `Fell to rung ${d.depth} of ${d.rungCount}${tail}.`;
}
