// AgentV3 — multi-provider cost-routing orchestrator (phase 3).
//
// Wraps an ORDERED chain of TurnRunners so v5.0 runs each turn on the cheapest provider
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
import { pacerEnabled, getSharedPacer } from '../RateLimitPacer';
import { parseEnvFlag } from '../../lib/envFlag';

export interface NamedRunner {
  /** Bench/identity name, e.g. 'GROK', 'CLAUDE'. UNIQUE per rung — the timeout/429 bench keys on it,
   *  so two rungs that must fail INDEPENDENTLY (e.g. two GLM API keys in a rotation pool) MUST carry
   *  distinct names, or a bench on one silently sidelines the other. */
  name: string;
  runner: TurnRunner;
  /** Optional NORMALIZED name for telemetry/delivery reporting (onProviderUsed / onProviderError /
   *  onTurnComplete). Lets a key-pool expose distinct bench `name`s ('GLM', 'GLM#2', …) while every
   *  rung still reports as the base provider ('GLM') — so deliveredVia, the per-provider token ledger,
   *  and the no-Claude honesty detector keep their clean single label. Defaults to `name`. */
  reportAs?: string;
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
   * Billing Phase 3 — called when a turn succeeds, with the provider that answered, its measured
   * token usage, AND the exact model id that answered (TurnResult.model — used by REAL-cost billing
   * to price a GLM-flash turn as free and a glm-5.2 turn at the flagship rate). Feeds the
   * per-provider/model ProviderUsageLedger. Purely observational: it never changes which provider
   * runs or how the turn is billed. `model` is optional so older callers keep compiling.
   */
  onTurnComplete?: (used: string, usage: { inputTokens: number; outputTokens: number }, model?: string, cacheReadInputTokens?: number) => void;
  /**
   * Shared 429-cooldown registry (StudySync autopsy 2026-07-16) — the cross-instance memory of which
   * bench names are currently rate-limit-saturated. Defaults to the process-wide singleton so every
   * runner (fast lane, heal gates, judge, escalation) sees the same cooldowns; tests inject their own.
   */
  cooldowns?: RateLimitCooldowns;
  /** Clock override for tests (defaults to Date.now). */
  now?: () => number;
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

/**
 * A SERVICE-OVERLOADED failure — the provider's BACKEND is saturated, which every API key of that
 * provider sees identically (unlike a per-key quota 429, where rotating to the next key genuinely
 * helps). Real case (quiz-app report 2026-07-17): "429 The service may be temporarily overloaded,
 * please try again later" ×4 across different GLM keys — key rotation just re-proved the same
 * saturation. Used to POOL-strike the shared cooldown so the whole provider benches at once. Pure.
 */
export function isServiceOverloadedError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /temporarily overloaded|service (?:is |may be )?(?:temporarily )?(?:overloaded|unavailable)|overloaded_error|\b(?:503|529)\b/i.test(text);
}

/**
 * A RATE-LIMIT (429) failure — transient, but STORM-prone. Real case (Kanban build report 2026-07-13):
 * a 59-file build hammered GLM, which returned "429 Rate limit reached" on turn after turn (repeatCount
 * up to 12), and because a 429 is neither fatal nor a timeout it fell through to the next provider EVERY
 * time — so GLM was re-tried on every single file and 429'd every single time (a wasteful storm that also
 * defeats the cheap floor). Benched like a timeout so one throttled provider can't grind the whole run.
 * A size-gate skip ("skipped: prompt … exceeds the cheap-floor limit") is deliberately NOT matched. Pure. */
export function isRateLimitProviderError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /\b429\b|rate[ _-]?limit|too many requests/i.test(text);
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
 * PROACTIVE PACER decorator (admin-chosen 2026-07-18). Wraps a runner so its calls go through the shared
 * per-provider token-bucket + AIMD pacer (RateLimitPacer): stay under the provider's rate so most 429s
 * never happen, and auto-shrink concurrency on a 429/timeout so a stampede can't cause a timeout storm
 * (deep-test `e0db3243`: GLM timed out 23×). DEFAULT-OFF — when `AGENTV3_RATE_PACER` is not `on` this is a
 * no-op passthrough, so wiring it changes nothing until the flag flips. Never alters the result: `run`
 * re-throws any error unchanged, so the chain's own backoff/rotation still handles a real failure.
 */
export function pacedRunner(inner: TurnRunner, pacerKey: string): TurnRunner {
  return {
    runTurn(params: RunTurnParams): Promise<TurnResult> {
      if (!pacerEnabled()) return inner.runTurn(params);
      return getSharedPacer(pacerKey).run(() => inner.runTurn(params));
    },
  };
}

/**
 * SHARED, TIME-BASED 429 COOLDOWN (StudySync autopsy 2026-07-16). The per-instance
 * `rateLimitStreak` bench below is real but structurally blind two ways, proven by 172 GLM
 * failures in one build DESPITE the bench: (1) every call site (fast-lane generate, heal gates,
 * judge, escalation) constructs its OWN runner instance, so each re-learns the same saturated
 * provider from zero; (2) the fast lane fires 8 CONCURRENT turns, all of which start before any
 * streak reaches 2. This registry is the cross-instance, cross-turn memory: after `benchAfter`
 * consecutive 429s on a bench name, EVERY runner skips that name until the cooldown expires —
 * then it is tried again automatically (unlike the run-long bench, a recovered provider comes
 * BACK mid-build; deliberately SOFTER, so cheap GLM capacity is never permanently sidelined to
 * a pricier fallback — the sibling autopsy's honest "cost backfire" concern). A success clears
 * the name instantly. Injectable (tests use a fake clock); production uses the module singleton.
 */
export interface RateLimitCooldowns {
  /** ms timestamp until which this bench name is cooling down (0 = not cooling). */
  until(name: string): number;
  /** Record one 429 for the name; arms/extends the cooldown once the consecutive threshold is hit. */
  strike(name: string, nowMs: number): void;
  /** The provider answered — clear its strikes and any active cooldown. */
  clear(name: string): void;
  /** Reset all state (tests). */
  reset(): void;
}

/**
 * CIRCUIT-BREAKER options layered ON TOP of the short cooldown (CollabDesk/PaisaTrack GLM-storm autopsy
 * 2026-07-19). The short cooldown recovers a saturated provider after ~60s, so a genuinely rate-limited
 * provider is RE-PROBED every minute and storms again (79 GLM 429s in one build). The breaker tracks the
 * ROLLING 429 RATE: once `breakerTripAfter` strikes land within `breakerWindowMs`, the name is benched
 * for the much longer `breakerMs` and is NOT auto-recovered by the short 60s cycle — so the WHOLE build
 * leads with the next provider (Kimi) instead of poking the throttled one turn after turn. Time-based
 * recovery only (after `breakerMs` it is tried again); a single success does NOT un-trip a proven-
 * saturated provider. Disabled when `breakerTripAfter` or `breakerMs` is 0 (existing 2-arg callers).
 *
 * ESCALATING BENCH (MediConnect autopsy 2026-07-19). The single fixed `breakerMs` still RE-PROBES a
 * genuinely-throttled provider each cycle: a 31-min build tripped GLM ~6 times (bench 300s → probe →
 * re-storm 8×429 → bench 300s → …), producing 67 GLM failures for 27 deliveries (71% fail rate). The
 * fix: each REPEAT trip within `breakerEscalationWindowMs` benches the name for `breakerMs × 2^(trips-1)`,
 * capped at `breakerMaxMs`. So a persistently-saturated provider's 2nd trip benches it long past the end
 * of a typical build (it stops being re-probed), while a provider that behaves for the window ages its
 * trips out and returns to the base bench — process-safe self-healing, never a permanent kill.
 */
export interface CircuitBreakerOptions {
  /** Strikes within the window that trip the long breaker. 0 = breaker disabled. */
  breakerTripAfter?: number;
  /** Rolling window (ms) over which strikes are counted toward the trip threshold. */
  breakerWindowMs?: number;
  /** How long (ms) a tripped name stays benched on the FIRST trip — the base of the escalation. */
  breakerMs?: number;
  /** Cap (ms) on the escalated bench. Escalation is active only when this exceeds `breakerMs`. */
  breakerMaxMs?: number;
  /** Rolling window (ms) over which repeat trips are counted toward the escalation multiplier. */
  breakerEscalationWindowMs?: number;
}

export function createRateLimitCooldowns(cooldownMs = 60_000, benchAfter = 2, breaker: CircuitBreakerOptions = {}, cooldownMaxMs?: number): RateLimitCooldowns {
  const strikes = new Map<string, number>();
  const untilMs = new Map<string, number>();
  // ESCALATING RE-PROBE BENCH (restaurant-build autopsy 2026-07-21, 32 GLM failures): the short cooldown
  // used to be FIXED — bench 60s, re-probe, 429, bench 60s again, forever. On a long build against a
  // saturated provider that is a steady drip of ~1 wasted probe per minute (27 min → ~30 failures), and the
  // singles never reach the breaker's 8-in-120s trip. Track BENCH EPISODES per name: each time the bench
  // re-arms within 2× the base window of the previous bench expiring (the genuine failed-re-probe drip),
  // the window doubles (60s → 120s → 240s → …, capped at `cooldownMaxMs`, default 10×base). A rare 429
  // long after the previous bench is NOT linked and starts fresh at the base window. Strikes landing
  // while ALREADY benched (the fast lane's concurrent stragglers) extend nothing and do NOT escalate —
  // one burst is one episode. Any success resets episodes to zero.
  const benchEpisodes = new Map<string, number>();
  const capMs = Math.max(cooldownMs, cooldownMaxMs ?? cooldownMs * 10);
  // Circuit breaker: rolling strike timestamps + the long "breaker open" expiry per name.
  const strikeTimes = new Map<string, number[]>();
  const breakerUntil = new Map<string, number>();
  // Escalating bench: timestamps of past TRIPS per name (rolling), so a repeat trip benches longer.
  const tripTimes = new Map<string, number[]>();
  const tripAfter = Math.max(0, Math.floor(breaker.breakerTripAfter ?? 0));
  const windowMs = Math.max(0, breaker.breakerWindowMs ?? 120_000);
  const openMs = Math.max(0, breaker.breakerMs ?? 0);
  const maxMs = Math.max(openMs, breaker.breakerMaxMs ?? 0);
  const escWindowMs = Math.max(windowMs, breaker.breakerEscalationWindowMs ?? 1_800_000);
  const breakerOn = tripAfter > 0 && openMs > 0;
  return {
    // The effective bench is the LATER of the short cooldown and the long breaker window.
    until: (name) => Math.max(untilMs.get(name) ?? 0, breakerUntil.get(name) ?? 0),
    strike(name, nowMs) {
      const n = (strikes.get(name) ?? 0) + 1;
      strikes.set(name, n);
      if (cooldownMs > 0 && n >= benchAfter) {
        const prevUntil = untilMs.get(name) ?? 0;
        if (prevUntil <= nowMs) {
          // (Re-)arming after expiry (or for the first time). Escalate ONLY when this failure is LINKED
          // to the previous bench — it landed within 2× the base window of that bench expiring (the
          // genuine "re-probe failed again" drip). A rare, spread-out 429 from an otherwise-quiet
          // provider is NOT linked and starts fresh at the base window (no creeping punishment).
          const linked = prevUntil > 0 && nowMs - prevUntil <= cooldownMs * 2;
          const episodes = linked ? (benchEpisodes.get(name) ?? 0) + 1 : 1;
          benchEpisodes.set(name, episodes);
          untilMs.set(name, nowMs + Math.min(cooldownMs * Math.pow(2, episodes - 1), capMs));
        }
        // else: already benched — a concurrent straggler; keep the current window (no escalation).
      }
      if (breakerOn) {
        // Keep only strikes inside the rolling window, add this one, and trip if the rate crosses.
        const recent = (strikeTimes.get(name) ?? []).filter((t) => t >= nowMs - windowMs);
        recent.push(nowMs);
        strikeTimes.set(name, recent);
        if (recent.length >= tripAfter) {
          // A trip fires. Escalate the bench by how many times this name has tripped within the rolling
          // escalation window: bench = openMs × 2^(trips-1), capped at maxMs. A repeat offender is
          // benched long past the build; a one-off returns to the base bench once its trips age out.
          const trips = (tripTimes.get(name) ?? []).filter((t) => t >= nowMs - escWindowMs);
          trips.push(nowMs);
          tripTimes.set(name, trips);
          const escalated = maxMs > openMs
            ? Math.min(openMs * Math.pow(2, trips.length - 1), maxMs)
            : openMs;
          breakerUntil.set(name, nowMs + escalated);
          // The rolling strike list is consumed by the trip — start the next window fresh so the NEXT
          // trip reflects a genuinely new storm (not the same strikes counted twice).
          strikeTimes.set(name, []);
        }
      }
    },
    clear(name) {
      // A success clears the SHORT cooldown + consecutive streak + the escalation episodes (a recovered
      // provider starts fresh at the base window). The breaker is deliberately STICKY — one call sneaking
      // through does not prove a saturated provider recovered; it re-opens only by time (breakerMs), so
      // the build stays off the throttled provider instead of re-storming it.
      strikes.delete(name);
      untilMs.delete(name);
      benchEpisodes.delete(name);
    },
    reset() {
      strikes.clear();
      untilMs.clear();
      benchEpisodes.clear();
      strikeTimes.clear();
      breakerUntil.clear();
      tripTimes.clear();
    },
  };
}

/**
 * Circuit-breaker config for the production singleton, from env. DEFAULT ON (admin-requested 2026-07-19
 * as the code-side GLM-storm fix on top of the pacer + key-pool). `AGENTV3_CIRCUIT_BREAKER=off` disables
 * it (breaker trip = 0 → pure short-cooldown behaviour). Thresholds are tunable without a deploy.
 */
export function circuitBreakerConfig(env: NodeJS.ProcessEnv = process.env): CircuitBreakerOptions {
  if (parseEnvFlag(env.AGENTV3_CIRCUIT_BREAKER) === false) return { breakerTripAfter: 0 };
  const num = (name: string, def: number): number => {
    const n = Number((env[name] ?? '').trim());
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    breakerTripAfter: num('AGENTV3_CIRCUIT_BREAKER_TRIP', 8),
    breakerWindowMs: num('AGENTV3_CIRCUIT_BREAKER_WINDOW_MS', 120_000),
    breakerMs: num('AGENTV3_CIRCUIT_BREAKER_MS', 300_000),
    // ESCALATING BENCH (MediConnect autopsy): repeat trips within the window bench the provider for
    // openMs × 2^(trips-1), capped here — so a persistently-throttled GLM's 2nd/3rd trip benches it past
    // the end of a typical build instead of re-storming every 5 min (67 GLM failures → ~2-3 trips' worth).
    breakerMaxMs: num('AGENTV3_CIRCUIT_BREAKER_MAX_MS', 1_800_000),
    breakerEscalationWindowMs: num('AGENTV3_CIRCUIT_BREAKER_ESC_WINDOW_MS', 1_800_000),
  };
}

/** Cooldown length (ms). Env-tunable; `0`/`off` disables the shared cooldown (per-instance bench remains). */
function rateLimitCooldownMs(): number {
  const raw = (process.env.AGENTV3_RATE_LIMIT_COOLDOWN_MS ?? '').trim().toLowerCase();
  if (raw === 'off') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

/**
 * Consecutive throttle strikes (429 / timeout / overload) on ONE bench name before the SHARED
 * cross-instance cooldown benches it. Env-tunable (`AGENTV3_RATE_LIMIT_BENCH_AFTER`); DEFAULT 1.
 *
 * ROOT CAUSE (LearnLoop autopsy — the "GLM 429 storm", 44 provider failures in one build): this
 * cooldown used to arm only on the SECOND strike, but the fast lane fires up to 8 CONCURRENT turns
 * that ALL 429 before any single name reaches 2 — so the very machinery built to stop the storm never
 * armed, and the build hammered the throttled provider turn after turn before finally falling to the
 * backstop. Arming on the FIRST throttle collapses the storm: after one GLM 429/timeout, every
 * subsequent turn (and every sibling runner instance) skips that name for the cooldown window, then
 * retries it automatically when the window expires (soft bench — cheap capacity is never permanently
 * sidelined). A HEALTHY provider is never benched — a successful turn clears its strikes instantly.
 * Set to `2` to restore the old, slower-to-arm behavior.
 */
export function rateLimitBenchAfter(): number {
  const n = Number((process.env.AGENTV3_RATE_LIMIT_BENCH_AFTER ?? '').trim());
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Cap (ms) on the escalating re-probe bench (base × 2^episodes, capped here). Env-tunable
 *  (`AGENTV3_RATE_LIMIT_COOLDOWN_MAX_MS`); default 10× the base cooldown (60s base → 10 min cap). */
function rateLimitCooldownMaxMs(): number {
  const n = Number((process.env.AGENTV3_RATE_LIMIT_COOLDOWN_MAX_MS ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : rateLimitCooldownMs() * 10;
}

/** The production singleton — one shared memory across every runner instance in the process. Carries the
 *  short cooldown (with the escalating re-probe bench) AND the per-build circuit breaker (default-on;
 *  `AGENTV3_CIRCUIT_BREAKER=off` disables). */
export const sharedRateLimitCooldowns: RateLimitCooldowns = createRateLimitCooldowns(rateLimitCooldownMs(), rateLimitBenchAfter(), circuitBreakerConfig(), rateLimitCooldownMaxMs());

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
  const rateLimitStreak = new Map<string, number>(); // name → consecutive 429 count
  const TIMEOUT_BENCH_AFTER = 2;
  const RATE_LIMIT_BENCH_AFTER = 2; // 2 consecutive 429s → stop hammering a throttled provider this run
  // Cross-instance 429 memory (see RateLimitCooldowns above) — the per-instance streak alone was
  // structurally blind to concurrent turns and to sibling runner instances (172 GLM failures in one
  // real build). Default = the process-wide singleton; tests inject a fake registry + clock.
  const cooldowns = opts.cooldowns ?? sharedRateLimitCooldowns;
  const now = opts.now ?? Date.now;
  // KEY-POOL membership (quiz-app autopsy 2026-07-17): rungs sharing one base name ('GLM', 'GLM#2'
  // reportAs 'GLM', …) are keys of the SAME provider service. A SERVICE-level failure (timeout /
  // "temporarily overloaded") looks identical from every key, so per-key strikes alone let a 5-key
  // pool burn up to 10 full timeout windows before every rung benched (real turns: 76s/68s/50s).
  // Pool strikes live under a separate `pool:<base>` cooldown key so a per-key quota 429 on one key
  // can never bench its siblings (key rotation must keep working for genuine per-key limits).
  const poolSizes = new Map<string, number>();
  for (const e of chain) {
    const base = e.reportAs ?? e.name;
    poolSizes.set(base, (poolSizes.get(base) ?? 0) + 1);
  }
  const isPoolMember = (entry: NamedRunner): boolean => (poolSizes.get(entry.reportAs ?? entry.name) ?? 0) >= 2;
  return {
    async runTurn(params: RunTurnParams): Promise<TurnResult> {
      const fellBackFrom: string[] = [];
      let lastError: unknown;
      let alive = 0;
      for (let i = 0; i < chain.length; i++) {
        const { name, runner } = chain[i];
        const reportName = chain[i].reportAs ?? name; // normalized label for telemetry/delivery (key-pool)
        if ((timeoutStreak.get(name) ?? 0) >= TIMEOUT_BENCH_AFTER) {
          fellBackFrom.push(name); // benched — skip without spending its timeout again this run
          continue;
        }
        if ((rateLimitStreak.get(name) ?? 0) >= RATE_LIMIT_BENCH_AFTER) {
          fellBackFrom.push(name); // rate-limited — skip so we don't 429-storm it every remaining turn
          continue;
        }
        if (cooldowns.until(name) > now()) {
          fellBackFrom.push(name); // SHARED cooldown — another turn/instance already proved it saturated
          continue;
        }
        if (isPoolMember(chain[i]) && cooldowns.until(`pool:${reportName}`) > now()) {
          fellBackFrom.push(name); // POOL cooldown — the provider SERVICE is saturated; every key skips
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
          rateLimitStreak.delete(name); // …and the consecutive-429 streak (the provider recovered)
          cooldowns.clear(name); // …and the SHARED cooldown — the provider is back for everyone
          if (isPoolMember(chain[i])) cooldowns.clear(`pool:${reportName}`); // …and the POOL cooldown (service recovered)
          opts.onProviderUsed?.(reportName, [...fellBackFrom]);
          // Billing Phase 3 — attribute this turn's real tokens to the provider that answered.
          // Best-effort + observational: a throw here must never break a delivered turn.
          try {
            opts.onTurnComplete?.(reportName, {
              inputTokens: result.usage?.inputTokens ?? 0,
              outputTokens: result.usage?.outputTokens ?? 0,
            }, result.model, result.usage?.cacheReadInputTokens ?? 0);
          } catch { /* telemetry attribution must never disturb the build */ }
          return result;
        } catch (err) {
          lastError = err;
          fellBackFrom.push(reportName);
          opts.onProviderError?.(reportName, err);
          if (isFatalProviderError(err)) {
            deadForRun.set(name, err instanceof Error ? err.message : String(err));
          } else if (isTimeoutProviderError(err)) {
            timeoutStreak.set(name, (timeoutStreak.get(name) ?? 0) + 1); // bench after 2 in a row
            // TaskFlow autopsy 2026-07-17: 212 GLM TIMEOUTS in one build — the same cross-instance
            // blindness the 429 cooldown fixed, in the other transient class. A timeout wastes far
            // MORE wall-clock than a 429 (the full timeout window burns before the fallback), so the
            // shared cooldown matters even more here. Same registry, same recovery semantics.
            cooldowns.strike(name, now());
            // Quiz-app autopsy 2026-07-17: a timeout is SERVICE saturation, not one key's quota — strike
            // the POOL too, so 2 service-level failures across ANY keys bench the whole provider for the
            // cooldown window (soft — the same registry recovery brings it back automatically).
            if (isPoolMember(chain[i])) cooldowns.strike(`pool:${reportName}`, now());
          } else if (isRateLimitProviderError(err)) {
            rateLimitStreak.set(name, (rateLimitStreak.get(name) ?? 0) + 1); // bench after 2 consecutive 429s
            cooldowns.strike(name, now()); // shared memory — concurrent turns/instances stop hammering too
            // A "service overloaded" 429 is service-wide (every key sees the same saturated backend) —
            // pool-strike it like a timeout. A per-key quota 429 ("rate limit reached for requests") is
            // NOT pool-struck: the next key genuinely may have quota left, so rotation must keep working.
            if (isPoolMember(chain[i]) && isServiceOverloadedError(err)) cooldowns.strike(`pool:${reportName}`, now());
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
      const prefix = alive === 0 ? 'All v5.0 providers are unavailable (known-fatal from earlier in this build)' : `All v5.0 providers failed (${fellBackFrom.join(' → ')})`;
      throw new Error(`${prefix}. Last error: ${reason}${fatalProviderHint(reason)}`);
    },
  };
}
