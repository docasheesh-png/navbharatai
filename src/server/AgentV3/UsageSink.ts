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
  /** Shares of `inputTokens` served from / written to a prompt cache (Q-343) — never additional. */
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
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
  let cacheReadInputTokens = 0;
  let cacheCreationInputTokens = 0;
  return {
    add(u) {
      if (!u) return;
      if (Number.isFinite(u.inputTokens) && u.inputTokens > 0) inputTokens += u.inputTokens;
      if (Number.isFinite(u.outputTokens) && u.outputTokens > 0) outputTokens += u.outputTokens;
      const r = u.cacheReadInputTokens ?? 0;
      if (Number.isFinite(r) && r > 0) cacheReadInputTokens += r;
      const w = u.cacheCreationInputTokens ?? 0;
      if (Number.isFinite(w) && w > 0) cacheCreationInputTokens += w;
    },
    total() {
      // The cache shares appear only when there are some, so a build with no cache reports exactly as before.
      return {
        inputTokens,
        outputTokens,
        ...(cacheReadInputTokens > 0 ? { cacheReadInputTokens } : {}),
        ...(cacheCreationInputTokens > 0 ? { cacheCreationInputTokens } : {}),
      };
    },
  };
}
