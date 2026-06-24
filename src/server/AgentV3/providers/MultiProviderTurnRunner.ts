// AgentV3 — multi-provider cost-routing orchestrator (phase 3).
//
// Wraps an ORDERED chain of TurnRunners so v3.0 runs each turn on the cheapest provider
// that can do it, falling through to the next on failure, with the LAST runner as a
// GUARANTEED backstop (Claude). This is the inverse of makeResilientTurnRunner (which is
// Claude-primary → text fallback): here the cheap providers (Vertex→Gemini→Grok, each via
// a native tool-use runner) go first, and Claude catches anything they fumble — so the
// build never breaks while NavBharatAI's real Claude cost drops to a minimum.
//
// Per-turn selection is by ERROR only (a thrown provider error → try the next). Quality-
// based fallback (a cheap model returns a valid-but-poor turn) is intentionally NOT done
// here — it needs live measurement and would risk false fallbacks; the agent loop's own
// validation + the Claude backstop cover hard failures. PURE control flow; the runners are
// injected, so this is fully unit-testable without any provider key.

import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';

export interface NamedRunner {
  /** Display/telemetry name, e.g. 'GROK', 'CLAUDE'. */
  name: string;
  runner: TurnRunner;
}

export interface MultiProviderOptions {
  /**
   * Called when a turn succeeds, with the provider that answered and the names of any
   * higher-priority providers that failed first. Drives cost telemetry (how often the
   * cheap providers carried the turn vs. how often Claude was needed).
   */
  onProviderUsed?: (used: string, fellBackFrom: string[]) => void;
  /** Called when a provider throws before the next is tried (greppable diagnostics). */
  onProviderError?: (name: string, error: unknown) => void;
}

/**
 * Build a TurnRunner that tries each runner in `chain` order and returns the first that
 * succeeds. The final entry is the guaranteed backstop — keep Claude last. Throws only if
 * EVERY runner (including the backstop) fails.
 */
export function makeMultiProviderTurnRunner(
  chain: NamedRunner[],
  opts: MultiProviderOptions = {},
): TurnRunner {
  if (!chain.length) {
    throw new Error('makeMultiProviderTurnRunner: chain must have at least one runner (the backstop).');
  }
  return {
    async runTurn(params: RunTurnParams): Promise<TurnResult> {
      const fellBackFrom: string[] = [];
      let lastError: unknown;
      for (let i = 0; i < chain.length; i++) {
        const { name, runner } = chain[i];
        try {
          const result = await runner.runTurn(params);
          opts.onProviderUsed?.(name, [...fellBackFrom]);
          return result;
        } catch (err) {
          lastError = err;
          fellBackFrom.push(name);
          opts.onProviderError?.(name, err);
          // Fall through to the next provider; the last one is the backstop.
        }
      }
      // Every provider failed — surface the final (backstop) error honestly.
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`All v3.0 providers failed (${fellBackFrom.join(' → ')}). Last error: ${reason}`);
    },
  };
}
