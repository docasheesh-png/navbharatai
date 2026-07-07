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
 * FATAL (deterministic, non-retryable) provider errors — retrying these within the same build is pure
 * waste. Real case (build report 2026-07-07): the Anthropic account ran out of credits; the first
 * "credit balance is too low" 400 landed at +165s, yet the build kept re-grinding the full ladder —
 * GLM timeouts ×6, KIMI ×2, then the SAME credit error again — and died at +670s. A billing/auth
 * failure will return the identical answer on every retry until a HUMAN fixes the account, so the
 * provider must be marked dead for the remainder of the run. Deliberately narrow: overloads, rate
 * limits, timeouts and 5xx are TRANSIENT and stay retryable. PURE + unit-tested.
 */
const FATAL_PROVIDER_PATTERNS: readonly RegExp[] = [
  /credit balance is too low/i,           // Anthropic: account out of credits
  /\bauthentication_error\b/i,            // bad/revoked API key (Anthropic error type)
  /\bpermission_error\b/i,                // key lacks access to the model
  /invalid (?:x-)?api[- ]?key/i,          // generic invalid-key phrasing
  /api key (?:is )?(?:invalid|expired|revoked|disabled)/i,
  /account (?:is )?(?:disabled|suspended|deactivated)/i,
];

export function isFatalProviderError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return FATAL_PROVIDER_PATTERNS.some((re) => re.test(text));
}

/**
 * An honest, admin-facing hint appended when a FATAL provider error is the final failure — the user
 * must see "the platform's account needs attention", not a generic "providers failed". PURE.
 */
export function fatalProviderHint(reason: string): string {
  if (/credit balance is too low/i.test(reason)) {
    return ' [PLATFORM ISSUE — not your app: the AI provider account has run out of credits. Every build will fail until the NavBharatAI admin tops it up (Anthropic Console → Plans & Billing).]';
  }
  if (isFatalProviderError(reason)) {
    return ' [PLATFORM ISSUE — not your app: the AI provider account/key needs attention from the NavBharatAI admin.]';
  }
  return '';
}

/**
 * Wrap a runner so it ALWAYS runs with `model`, ignoring the caller's `params.model`.
 * Used to add a fixed cheaper-model backstop (e.g. Claude Haiku) at the END of a provider
 * chain: if the primary model (Sonnet/Opus) is overloaded or rate-limited, the forced-Haiku
 * runner still completes the turn — so a model-specific outage never breaks the build (P7
 * failover hardening). Pure; the wrapped runner is injected, so it's fully unit-testable.
 */
export function forceModelRunner(runner: TurnRunner, model: string): TurnRunner {
  return {
    runTurn(params: RunTurnParams): Promise<TurnResult> {
      return runner.runTurn({ ...params, model });
    },
  };
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
  // Providers that failed FATALLY (billing/auth — deterministic) are dead for this runner's whole
  // life (one runner instance = one build). A transient failure (overload/timeout/5xx) is NOT
  // remembered — the provider is retried on the next turn, exactly as before.
  const deadForRun = new Map<string, string>(); // name → the fatal reason
  return {
    async runTurn(params: RunTurnParams): Promise<TurnResult> {
      const fellBackFrom: string[] = [];
      let lastError: unknown;
      let alive = 0;
      for (let i = 0; i < chain.length; i++) {
        const { name, runner } = chain[i];
        const fatalReason = deadForRun.get(name);
        if (fatalReason !== undefined) {
          // Known-fatal from an earlier turn — skipping saves the whole re-grind (the report's build
          // burned 8+ minutes re-discovering the same "credit balance too low" answer).
          fellBackFrom.push(name);
          if (lastError === undefined) lastError = new Error(fatalReason);
          continue;
        }
        alive++;
        try {
          const result = await runner.runTurn(params);
          opts.onProviderUsed?.(name, [...fellBackFrom]);
          return result;
        } catch (err) {
          lastError = err;
          fellBackFrom.push(name);
          opts.onProviderError?.(name, err);
          if (isFatalProviderError(err)) {
            deadForRun.set(name, err instanceof Error ? err.message : String(err));
          }
          // Fall through to the next provider; the last one is the backstop.
        }
      }
      // Every provider failed (or was known-dead) — surface the final error honestly, and when the
      // cause is a FATAL account problem, say so in plain words (it is the platform, not the app).
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      const prefix = alive === 0 ? 'All v3.0 providers are unavailable (known-fatal from earlier in this build)' : `All v3.0 providers failed (${fellBackFrom.join(' → ')})`;
      throw new Error(`${prefix}. Last error: ${reason}${fatalProviderHint(reason)}`);
    },
  };
}
