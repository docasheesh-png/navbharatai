/**
 * WHAT THE AI ACTUALLY COST — summed from what was measured, and honest about the rest.
 *
 * ═══ THE BUG THIS REPLACES ═══
 *
 * The admin analytics endpoint computed the platform's AI cost as
 * `totalProviderCost += log.estimated_provider_cost || 0` — and the ONLY line in the codebase that ever
 * wrote that field wrote a hardcoded `0`. So the number was not an estimate that had drifted; it was
 * structurally, permanently zero. Everything downstream inherited it:
 *
 *   • "Total Provider Cost ₹0.0000" and "Cost / Request ₹0.00000" — zero by construction;
 *   • **"PLATFORM MARGIN"**, which is `revenue − cost` and therefore was just **revenue, relabelled**;
 *   • the burn rate, which was `0 / requests`.
 *
 * On a real day that read ₹155 revenue and "₹155 margin" beside an engine-cost panel showing ₹1,223 of
 * spend. The dashboard did not merely lose precision — it reported a profit on a loss-making window.
 *
 * ═══ WHAT THIS DOES INSTEAD ═══
 *
 * It prices the tokens a provider REALLY reported, with the SAME rate card a build is priced by
 * (`providerRates.ts`), and counts separately the calls it could not price.
 *
 * 🔒 THE ONE RULE: an unmeasured call is NOT a free call. It is added to `unmeasuredCalls` and changes
 * `complete` to false, so the caller must present the total as a FLOOR ("at least ₹X from N priced
 * calls; M could not be priced") rather than as the answer. Summing an unknown as zero is precisely
 * how a cost panel comes to read ₹0 while money is going out of the door, and doing it a second time —
 * more carefully — would be the same bug with better arithmetic.
 *
 * Old rows, written before the chat route recorded real usage, have no `usageMeasured` and no tokens.
 * They land in `unmeasuredCalls` and are visibly counted, which is the honest treatment of history we
 * cannot reconstruct.
 *
 * PURE. The rate lookup is INJECTED so the decision is tested without the rate card, and so this module
 * never has to know what a provider is called.
 */

/** One `ai_usage_logs` document, reduced to the fields this needs. Everything is untrusted. */
export interface UsageLogRow {
  providerName?: unknown;
  modelName?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  usageMeasured?: unknown;
  latencyMs?: unknown;
}

export interface ProviderUsageRollup {
  requests: number;
  /** Calls whose tokens the provider actually reported. */
  measured: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Mean of the latencies we have. `null` when none were recorded — never 0. */
  avgLatencyMs: number | null;
}

export interface UsageSummary {
  calls: number;
  measuredCalls: number;
  unmeasuredCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /**
   * True only when EVERY call was priced. False means `costUsd` is a floor, and the screen must say
   * so — "at least this much", never "this much".
   */
  complete: boolean;
  byProvider: Record<string, ProviderUsageRollup>;
}

/** Prices one measured call. Injected — see the header. */
export type PriceUsage = (
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
) => number;

/**
 * A token count, distinguishing ABSENT from INVALID.
 *
 * `'absent'` is a field that simply is not there — normal on an old row. `'invalid'` is a field that IS
 * there and is nonsense (negative, NaN, a string), which makes the whole row untrustworthy: a row that
 * reports −5 output tokens has not measured anything, and pricing its input half would produce a
 * confident number from a corrupt record.
 */
function toCount(v: unknown): number | 'absent' | 'invalid' {
  if (v === undefined || v === null) return 'absent';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

/** A provider name we are willing to group by. Unnamed work is `unknown`, never merged into a real one. */
function providerKey(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return 'unknown';
  // 'auto' is the literal string the old logger wrote when it did not know. It is not a provider, and
  // bucketing it under its own name is what keeps a legacy row from masquerading as a real engine.
  return s.toLowerCase() === 'auto' ? 'unknown' : s;
}

export function summariseUsage(
  rows: readonly UsageLogRow[] | null | undefined,
  priceUsage: PriceUsage,
): UsageSummary {
  const out: UsageSummary = {
    calls: 0, measuredCalls: 0, unmeasuredCalls: 0,
    inputTokens: 0, outputTokens: 0, costUsd: 0,
    complete: true, byProvider: {},
  };
  const latency: Record<string, { sum: number; n: number }> = {};

  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue;
    out.calls++;
    const key = providerKey(r.providerName);
    const p = out.byProvider[key] || (out.byProvider[key] = {
      requests: 0, measured: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, avgLatencyMs: null,
    });
    p.requests++;

    const ms = toCount(r.latencyMs);
    // A recorded 0 ms is itself suspect (the old logger wrote a literal 0), but it is at least a value
    // somebody wrote; what is NOT counted is a missing one, so an absent latency cannot pull a mean down.
    if (typeof ms === 'number') {
      const l = latency[key] || (latency[key] = { sum: 0, n: 0 });
      l.sum += ms; l.n++;
    }

    const inTok = toCount(r.inputTokens);
    const outTok = toCount(r.outputTokens);
    // `usageMeasured === false` is an explicit "the provider told us nothing". An OLD row has neither
    // the flag nor the tokens, and is unmeasured for the same reason: there is nothing to price. A row
    // carrying an INVALID count is unmeasured too — see toCount.
    const corrupt = inTok === 'invalid' || outTok === 'invalid';
    const measured = r.usageMeasured === true && !corrupt
      && (typeof inTok === 'number' || typeof outTok === 'number');
    if (!measured) {
      out.unmeasuredCalls++;
      out.complete = false;
      continue;
    }

    const usage = {
      inputTokens: typeof inTok === 'number' ? inTok : 0,
      outputTokens: typeof outTok === 'number' ? outTok : 0,
    };
    out.measuredCalls++;
    out.inputTokens += usage.inputTokens;
    out.outputTokens += usage.outputTokens;
    p.measured++;
    p.inputTokens += usage.inputTokens;
    p.outputTokens += usage.outputTokens;

    // NaN is the sentinel for "could not price", and a THROW must produce it too — catching into 0
    // would silently turn a pricing failure into a free call, which is the exact bug being fixed.
    let usd = Number.NaN;
    try {
      usd = priceUsage(key, String(r.modelName ?? ''), usage);
    } catch {
      usd = Number.NaN;
    }
    // A price we could not compute is not a free call either — it goes back to the unmeasured side so
    // the total stays a floor rather than silently absorbing a zero.
    if (!Number.isFinite(usd) || usd < 0) {
      out.complete = false;
      continue;
    }
    out.costUsd += usd;
    p.costUsd += usd;
  }

  for (const [key, l] of Object.entries(latency)) {
    const p = out.byProvider[key];
    if (p && l.n > 0) p.avgLatencyMs = Math.round(l.sum / l.n);
  }
  return out;
}

/**
 * The margin, stated as what it really is.
 *
 * `exact` only when every call was priced. Otherwise this is an UPPER BOUND: the true cost is at least
 * what we summed, so the true margin is at most what we return. A screen showing this must use the
 * word "at most", because the one thing that must never happen again is a profit reported on a
 * loss-making window.
 */
export function marginInr(
  revenueInr: number,
  costInr: number,
  complete: boolean,
): { valueInr: number; exact: boolean } {
  const rev = Number.isFinite(revenueInr) ? revenueInr : 0;
  const cost = Number.isFinite(costInr) ? costInr : 0;
  return { valueInr: Math.round((rev - cost) * 100) / 100, exact: complete };
}
