/**
 * UsageSink — a single build-level token accumulator (billing accounting fix, 2026-07-10).
 *
 * ROOT CAUSE it fixes: the user charge was derived from ONE `AgentRunner.run()`'s own `usage`. But a
 * real v5.0 build spends most of its tokens OUTSIDE that one object — inside sub-agents (whose usage
 * was dropped), and inside heal/fix/retry/judge/reviewer runs (whose `result` REPLACED the main
 * build's, discarding its billing). So ~89% of real spend was never billed.
 *
 * The fix threads ONE UsageSink through the whole build. Every token-spending unit — the main runner,
 * every sub-agent, every heal/fix/escalation runner, the fast-lane generator, and the raw auxiliary
 * model calls — ADDS its tokens here. The final charge is computed from the sink's total, so nothing a
 * build actually spent can be silently thrown away. Pure + tiny so it is trivially testable and safe.
 */
export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSink {
  /** Add one unit of token spend. Non-finite / negative values are ignored (never corrupt the total). */
  add(u: UsageDelta | null | undefined): void;
  /** The accumulated total so far. */
  total(): UsageDelta;
}

export function createUsageSink(): UsageSink {
  let inputTokens = 0;
  let outputTokens = 0;
  return {
    add(u) {
      if (!u) return;
      if (Number.isFinite(u.inputTokens) && u.inputTokens > 0) inputTokens += u.inputTokens;
      if (Number.isFinite(u.outputTokens) && u.outputTokens > 0) outputTokens += u.outputTokens;
    },
    total() {
      return { inputTokens, outputTokens };
    },
  };
}
