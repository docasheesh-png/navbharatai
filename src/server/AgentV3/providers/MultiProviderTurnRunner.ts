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
  /**
   * Billing Phase 3 — called when a turn succeeds, with the provider that answered AND its measured
   * token usage. Feeds the per-provider ProviderUsageLedger (admin usage-report + optional per-tier
   * billing). Purely observational: it never changes which provider runs or how the turn is billed.
   */
  onTurnComplete?: (used: string, usage: { inputTokens: number; outputTokens: number }) => void;
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

/** A TIMEOUT failure (transient class, but grind-prone — see the consecutive-timeout bench). Pure. */
export function isTimeoutProviderError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /timed? ?out|timeout/i.test(text);
}

/** The largest context window any provider in the fleet offers (Claude/Vertex/Gemini ≈ 1M tokens). */
const MAX_FLEET_CONTEXT_TOKENS = 1_048_576;

/**
 * A prompt so large that NO provider in the fleet can accept it — falling through the ladder is
 * guaranteed-fail (real case, 2026-07-07: a reviewer sub-agent on a 100-file CoreUI template grew its
 * transcript to 2,204,128 tokens; CLAUDE(1M) → HAIKU(200k) → VERTEX(1M) → GEMINI(1M) all rejected the
 * SAME doomed request — 4 wasted round-trips). Only classified hopeless when the error itself reports
 * a token count above the fleet maximum — a merely-large prompt (e.g. 500k that a smaller provider
 * bounced) still falls through, because a bigger-window provider later in the chain might fit it. Pure.
 */
export function isHopelesslyOversizedError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (!/prompt is too long|input token count|exceeds the maximum number of tokens|context length/i.test(text)) return false;
  const m = /(\d{6,})\s*(?:tokens)?/.exec(text.replace(/[,_]/g, ''));
  return !!m && Number(m[1]) > MAX_FLEET_CONTEXT_TOKENS;
}

/** Rough prompt size (chars) of a turn — system + every message's text/tool content. Pure. */
export function estimatePromptChars(params: RunTurnParams): number {
  let n = typeof params.system === 'string' ? params.system.length : 0;
  for (const m of params.messages ?? []) {
    const c = (m as { content?: unknown }).content;
    if (typeof c === 'string') { n += c.length; continue; }
    if (Array.isArray(c)) {
      for (const b of c) {
        const bb = b as { text?: unknown; content?: unknown };
        if (typeof bb.text === 'string') n += bb.text.length;
        if (typeof bb.content === 'string') n += bb.content.length;
      }
    }
  }
  return n;
}

/**
 * PROMPT DIET for the cheap floor (admin design, 2026-07-07: "prompt chote karo"): shrink a turn's
 * messages before they reach GLM/KIMI by truncating OVERSIZED individual content blocks (giant
 * tool_results — file dumps — are the bulk of a big prompt). Structure is preserved (no message or
 * block is dropped, so tool_use/tool_result pairing stays intact); each oversized string keeps its
 * head + tail with an honest truncation marker. Claude always receives the FULL context. PURE.
 */
export function capMessageContentForCheapFloor(params: RunTurnParams, perBlockCap = 6_000): RunTurnParams {
  const cap = (s: string): string => s.length <= perBlockCap
    ? s
    : `${s.slice(0, perBlockCap - 1_200)}\n…[${s.length - perBlockCap} chars trimmed for the fast model]…\n${s.slice(-1_000)}`;
  const messages = (params.messages ?? []).map((m) => {
    const c = (m as { content?: unknown }).content;
    if (typeof c === 'string') return { ...(m as object), content: cap(c) };
    if (Array.isArray(c)) {
      return {
        ...(m as object),
        content: c.map((b) => {
          const bb = b as { text?: unknown; content?: unknown };
          if (typeof bb.text === 'string' && bb.text.length > perBlockCap) return { ...(b as object), text: cap(bb.text) };
          if (typeof bb.content === 'string' && bb.content.length > perBlockCap) return { ...(b as object), content: cap(bb.content) };
          return b;
        }),
      };
    }
    return m;
  }) as RunTurnParams['messages'];
  return { ...params, messages };
}

/**
 * Wrap a CHEAP-FLOOR runner with the admin's combined design (2026-07-07):
 *   1. prompt-size-aware routing — a turn whose prompt exceeds `skipOverChars` SKIPS this runner
 *      instantly (throws a cheap, non-timeout error → the chain falls through in ~0ms) instead of
 *      gambling a long timeout on it. ADMIN OVERRIDE (2026-07-11, "kimi/glm se limit hata do — 1st
 *      try for every file glm/kimi"): a skip limit of 0 (or negative) DISABLES this skip entirely, so
 *      GLM/Kimi are tried FIRST for every prompt regardless of size — Claude still backstops any real
 *      timeout/failure, so the app never breaks, it just may run a slower turn on a huge prompt.
 *   2. prompt diet — turns that go to the cheap model get oversized blocks trimmed first. This ALWAYS
 *      applies (even with the skip disabled), so the cheap model never chokes on a giant single block.
 * PURE wrapper; the inner runner is injected (unit-testable without providers).
 */
export function sizeGatedRunner(inner: TurnRunner, skipOverChars: number, perBlockCap = 6_000): TurnRunner {
  return {
    runTurn(params: RunTurnParams): Promise<TurnResult> {
      // skipOverChars <= 0 → no size skip (admin: GLM/Kimi lead every prompt); only the diet applies.
      if (skipOverChars > 0) {
        const size = estimatePromptChars(params);
        if (size > skipOverChars) {
          return Promise.reject(new Error(`skipped: prompt ${size} chars exceeds the cheap-floor limit ${skipOverChars} (routed to the next provider)`));
        }
      }
      return inner.runTurn(capMessageContentForCheapFloor(params, perBlockCap));
    },
  };
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
  // remembered — EXCEPT the timeout BENCH (admin design 2026-07-07): 2 CONSECUTIVE timeouts bench
  // the provider for the rest of the run, so a degraded GLM/KIMI evening can't grind every turn.
  const deadForRun = new Map<string, string>(); // name → the fatal reason
  const timeoutStreak = new Map<string, number>(); // name → consecutive timeout count
  const TIMEOUT_BENCH_AFTER = 2;
  return {
    async runTurn(params: RunTurnParams): Promise<TurnResult> {
      const fellBackFrom: string[] = [];
      let lastError: unknown;
      let alive = 0;
      for (let i = 0; i < chain.length; i++) {
        const { name, runner } = chain[i];
        if ((timeoutStreak.get(name) ?? 0) >= TIMEOUT_BENCH_AFTER) {
          fellBackFrom.push(name); // benched — skip without spending its timeout again this run
          continue;
        }
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
          timeoutStreak.delete(name); // a success resets the consecutive-timeout streak
          opts.onProviderUsed?.(name, [...fellBackFrom]);
          // Billing Phase 3 — attribute this turn's real tokens to the provider that answered.
          // Best-effort + observational: a throw here must never break a delivered turn.
          try {
            opts.onTurnComplete?.(name, {
              inputTokens: result.usage?.inputTokens ?? 0,
              outputTokens: result.usage?.outputTokens ?? 0,
            });
          } catch { /* telemetry attribution must never disturb the build */ }
          return result;
        } catch (err) {
          lastError = err;
          fellBackFrom.push(name);
          opts.onProviderError?.(name, err);
          if (isFatalProviderError(err)) {
            deadForRun.set(name, err instanceof Error ? err.message : String(err));
          } else if (isTimeoutProviderError(err)) {
            timeoutStreak.set(name, (timeoutStreak.get(name) ?? 0) + 1); // bench after 2 in a row
          } else if (isHopelesslyOversizedError(err)) {
            // The PROMPT exceeds every window in the fleet — no later provider can save this turn.
            // Abort now instead of replaying the same doomed multi-megabyte request down the chain.
            const reason0 = err instanceof Error ? err.message : String(err);
            throw new Error(`This request is too large for every AI provider (${fellBackFrom.join(' → ')} tried). Last error: ${reason0} [The conversation/sub-agent transcript has grown past the largest context window — a shorter request or a fresh turn is required.]`);
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
