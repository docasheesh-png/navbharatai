
import { AIProvider, AIProviderResponse, ProviderTelemetry } from './ProviderTypes';
import { providerCooldownStore } from '../../lib/ProviderCooldownStore';
import { getBreaker, allBreakerNames } from './CircuitBreaker';
import { tracer } from '../../observability/Tracer';
import { shouldRaceStreams } from './streamRacePolicy';

/**
 * Which rung actually served a streamed turn.
 *
 * 🔴 `routeStream` used to return `Promise<void>` — it reported NOTHING. So `ai_usage_logs`, which the
 * admin dashboard is built on, was written only on the NON-streaming branch of the chat route, and
 * chat streams. The provider, the model and the outcome of real chat traffic were therefore invisible:
 * there was no way to see which rung served, whether a paid one was firing, or whether removing the
 * last-resort rungs had started costing users an answer. Found the same day as two other bugs of this
 * exact shape (the model pin and Vertex's hardcoded stream model) — the streaming path in this repo
 * has a habit of being forgotten.
 */
import { watchdogLimits, runWatchedStream, mayTryNextRung, awaitWithIdleBound } from './streamWatchdog';

export interface StreamOutcome {
  ok: boolean;
  /** The provider that actually delivered, when one did. */
  provider?: string;
  /** The model that rung pins, when it pins one (see `slot()`). */
  model?: string;
  latencyMs?: number;
  /** Did this turn pay for a second model to save latency? */
  raced?: boolean;
  /**
   * ⚠️ `stalled` is NOT a failure of the answer the user received. It means the provider went silent
   * mid-stream and we stopped waiting, so `ok` stays true and whatever was delivered stands. A reader
   * that treats every non-empty `reason` as an error would report a partially-answered turn as broken.
   */
  reason?: 'aborted' | 'no-provider' | 'all-failed' | 'stalled';
}

// P1.3 — per-provider state is now backed by a real CircuitBreaker (CLOSED / OPEN /
// HALF_OPEN) instead of a flat cooldown map. The three router chokepoints below
// (isOnCooldown / setCooldown / success) drive the breaker; the rest of the routing
// control flow is unchanged, so this is a strict, break-proof superset of the old behaviour.
//
// Per-provider in-flight request counter (concurrency limiter)
const inFlight = new Map<string, number>();
const MAX_IN_FLIGHT = 8;

function isOnCooldown(name: string): boolean {
  // OPEN → skip on the fast path. HALF_OPEN (cooldown elapsed) returns false so the
  // next request flows through as a recovery trial probe.
  return getBreaker(name).isBlocking();
}

/**
 * A provider that returns HTTP 200 with empty/whitespace `content` has NOT answered — it happens on
 * ordinary outcomes (Gemini SAFETY/RECITATION block, Anthropic thinking-only/tool-only reply, a
 * MAX_TOKENS-with-no-text response), and none of the providers throw on it. Treating it as success
 * would hand the user a BLANK reply, skip the lower-priority providers that could have answered, and
 * mark the breaker healthy on a non-answer. So we throw here and let the caller fall through to the
 * next provider. Centralized so EVERY routing path (sequential + raced + last-resort) enforces the
 * same invariant and it can't drift out of one of them again.
 */
function assertNonEmpty(response: AIProviderResponse, name: string): AIProviderResponse {
  if (!response.content?.trim()) throw new Error(`${name}: empty`);
  return response;
}

function setCooldown(name: string, seconds: number) {
  // A failure → open the breaker (escalates on consecutive failures, capped).
  const until = getBreaker(name).recordFailure(seconds * 1000);
  console.log(`[CIRCUIT] ${name} OPEN for ~${seconds}s (until ${new Date(until).toISOString()}, state=${getBreaker(name).state()})`);
  // Phase 4.1 — share this cooldown with other Cloud Run instances (fire-and-forget).
  void providerCooldownStore.write(name, until);
}

/** A successful call → close the breaker and reset the failure streak. */
function markProviderSuccess(name: string) {
  getBreaker(name).recordSuccess();
}

/**
 * Phase 4.1 — merge cooldowns set by OTHER instances into our breakers.
 * Called by the background sync loop. Honors the later (max) deadline so a longer
 * remote cooldown sticks; never shortens a local cooldown.
 */
function mergeRemoteCooldowns(remote: Record<string, number>) {
  const now = Date.now();
  for (const [name, until] of Object.entries(remote)) {
    if (until <= now) continue; // expired remotely
    getBreaker(name).honorRemoteOpenUntil(until);
  }
}

// Start the cross-instance cooldown sync once at module load (no-op under tests).
providerCooldownStore.startSync(mergeRemoteCooldowns);

function acquireSlot(name: string): boolean {
  const count = inFlight.get(name) || 0;
  if (count >= MAX_IN_FLIGHT) return false;
  inFlight.set(name, count + 1);
  return true;
}

function releaseSlot(name: string) {
  inFlight.set(name, Math.max(0, (inFlight.get(name) || 1) - 1));
}

function cooldownSeconds(error: any): number {
  const msg = String(error?.message || error?.status || '');
  let base: number;
  if (msg.includes('429') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota')) base = 90;
  else if (msg.includes('503') || msg.includes('overloaded')) base = 45;
  else if (msg.toLowerCase().includes('timeout')) base = 15;
  else base = 10;
  // ±20% jitter — prevents thundering herd when many users retry simultaneously
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export class AIRouter {
  private providers: AIProvider[] = [];
  /**
   * P2.3 — Bulkhead isolation. Each universe (free / pro / professional) gets its OWN
   * in-flight concurrency pool, keyed `${universe}:${provider}`, so a FREE-tier traffic
   * spike that saturates a shared provider (e.g. Grok) can never starve PRO/SDA of slots.
   * The circuit breaker stays keyed by provider NAME (shared) — a 429 is a provider-wide
   * health signal that SHOULD back every universe off, whereas concurrency is local capacity.
   */
  private readonly universe: string;



  constructor(universe: string = 'default') {
    this.universe = universe;
  }

  /** Per-universe slot key for the bulkhead concurrency pool. */
  private slotKey(name: string): string { return `${this.universe}:${name}`; }
  private acquire(name: string): boolean { return acquireSlot(this.slotKey(name)); }
  private release(name: string): void { releaseSlot(this.slotKey(name)); }
  private inFlightCount(name: string): number { return inFlight.get(this.slotKey(name)) || 0; }

  registerProvider(provider: AIProvider) {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Read-only view of the registered provider chain, in resolved priority order.
   * Used by tests (to prove per-universe routing isolation) and observability —
   * never mutate the returned objects.
   */
  getProviderChain(): Array<{ name: string; priority: number; lastResort: boolean }> {
    return this.providers.map(p => ({ name: p.name, priority: p.priority, lastResort: !!p.lastResort }));
  }

  async route(prompt: string, systemPrompt?: string, images?: string[], modelOverride?: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    return this.execute(prompt, undefined, systemPrompt, images, modelOverride);
  }

  /**
   * RACED routing (used by the PROFESSIONAL universe): fire all non-last-resort
   * providers CONCURRENTLY and return the first non-empty success (Promise.any).
   * Only if every racer fails do we fall back — sequentially — to the last-resort
   * provider(s) (e.g. Claude Haiku). This gives the lowest-latency answer while
   * keeping Claude strictly as the final safety net (Grok-primary/Claude-last law).
   */
  async routeRaced(prompt: string, systemPrompt?: string, images?: string[]): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    const racers = this.providers.filter(p => !p.lastResort);
    const fallbacks = this.providers.filter(p => p.lastResort);
    const errors: string[] = [];

    // Eligible racers: healthy, not on cooldown, with capacity.
    const eligible: AIProvider[] = [];
    for (const p of racers) {
      if (isOnCooldown(p.name)) { console.log(`[RACE] skip ${p.name} (cooldown)`); continue; }
      if (!(await p.healthCheck().catch(() => false))) { console.log(`[RACE] skip ${p.name} (unhealthy)`); continue; }
      if (this.inFlightCount(p.name) >= MAX_IN_FLIGHT) { console.log(`[RACE] skip ${p.name} (at capacity)`); continue; }
      eligible.push(p);
    }

    if (eligible.length > 0) {
      console.log(`[RACE] racing: ${eligible.map(p => p.name).join(' × ')}`);
      const attempts = eligible.map(async (p) => {
        if (!this.acquire(p.name)) throw new Error(`${p.name}: no slot`);
        const t = Date.now();
        try {
          const response = assertNonEmpty(await p.execute(prompt, undefined, undefined, systemPrompt, images), p.name);
          recordProviderLatency(p.name, Date.now() - t, false);
          return { response, name: p.name };
        } catch (err: any) {
          // Genuine failure → cool the provider down. (Slow-but-successful losers
          // resolve instead of rejecting, so they are never wrongly penalized.)
          setCooldown(p.name, cooldownSeconds(err));
          recordProviderLatency(p.name, 0, true);
          errors.push(`${p.name}: ${String(err?.message).slice(0, 60)}`);
          throw err;
        } finally {
          this.release(p.name);
        }
      });
      try {
        const winner = await Promise.any(attempts);
        console.log(`[RACE] won by ${winner.name}`);
        recordRouterOutcome(true);
        return {
          response: winner.response,
          telemetry: { provider: winner.name, retries: errors.length, latency: winner.response.latencyMs, success: true },
        };
      } catch {
        console.warn('[RACE] all racers failed → last resort');
      }
    }

    // Last-resort fallback (sequential) — e.g. Claude Haiku.
    for (const p of fallbacks) {
      if (!(await p.healthCheck().catch(() => false))) continue;
      if (!this.acquire(p.name)) continue;
      const t = Date.now();
      try {
        console.log(`[RACE] last-resort: ${p.name}`);
        const response = assertNonEmpty(await p.execute(prompt, undefined, undefined, systemPrompt, images), p.name);
        recordProviderLatency(p.name, Date.now() - t, false);
        recordRouterOutcome(true);
        return {
          response,
          telemetry: { provider: p.name, retries: errors.length, latency: response.latencyMs, success: true, fallbackReason: errors.length ? `Race failed: ${errors.slice(0, 3).join('; ')}` : undefined },
        };
      } catch (err: any) {
        setCooldown(p.name, cooldownSeconds(err));
        recordProviderLatency(p.name, 0, true);
        errors.push(`${p.name}: ${String(err?.message).slice(0, 60)}`);
      } finally {
        this.release(p.name);
      }
    }

    console.error('[RACE] race + last-resort all failed:', errors);
    recordRouterOutcome(false);
    return {
      response: { content: 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏', latencyMs: 0, provider: 'GEMINI', model: 'fallback' },
      telemetry: { provider: 'NONE', retries: errors.length, latency: 0, success: false },
    };
  }

  /** Returns true if at least one registered provider passes its health check. */
  async hasHealthyProvider(): Promise<boolean> {
    for (const p of this.providers) {
      if (await p.healthCheck().catch(() => false)) return true;
    }
    return false;
  }

  async generate(prompt: string, schema: any): Promise<any> {
    const { response } = await this.execute(prompt, schema);
    return JSON.parse(response.content);
  }

  /**
   * Walk the ladder in order, paying for a rung only when the one before it did not deliver.
   *
   * This is what the FREE universe does on every streamed turn, and what ANY universe does when only
   * one provider is available. A rung that throws is cooled down and the next is tried; a rung that
   * delivers ends the walk. Nothing runs concurrently, so nothing is billed speculatively.
   */
  private async streamSequential(
    providers: AIProvider[],
    prompt: string,
    systemPrompt: string | undefined,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<StreamOutcome> {
    for (const p of providers) {
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      if (!p.executeStream) continue;
      if (!this.acquire(p.name)) continue;
      const t = Date.now();
      try {
        // 🔴 THE ONLY THING THAT COULD END A STREAMED TURN WAS THE CLIENT DISCONNECTING (2026-09-17).
        // This `await` had no bound of any kind, so a provider that accepted the connection and then
        // never spoke stalled the turn for ever — and chat.ts's 20-second keepalive ping held the dead
        // turn open. The bound is SILENCE, not duration (see streamWatchdog.ts), so a slow provider
        // that is still emitting is never cut off. `CHAT_STREAM_WATCHDOG=off` restores this exact line.
        const limits = watchdogLimits();
        if (!limits) {
          await p.executeStream(prompt, systemPrompt, onChunk);
        } else {
          const watched = await runWatchedStream(
            (cb) => p.executeStream!(prompt, systemPrompt, cb),
            onChunk,
            limits,
          );
          if (watched.verdict === 'failed') throw watched.error ?? new Error('stream failed');
          if (mayTryNextRung(watched)) {
            // Nothing reached the user, so the next rung can answer with nothing duplicated. The
            // provider is benched: it accepted a request and did not answer, which is a real failure
            // however it looks from the outside.
            setCooldown(p.name, cooldownSeconds(new Error(watched.verdict)));
            recordProviderLatency(p.name, 0, true);
            console.warn(`[STREAM] ${p.name} ${watched.verdict} — next rung`);
            continue;
          }
          if (watched.verdict !== 'completed') {
            // Text is already on screen. A second rung would repeat itself, so the turn ends here with
            // what was delivered — partial and honest beats duplicated.
            recordProviderLatency(p.name, Date.now() - t, false);
            console.warn(`[STREAM] ${p.name} ${watched.verdict} after delivering — ending the turn`);
            return { ok: true, provider: p.name, model: p.pinnedModel, latencyMs: Date.now() - t, raced: false, reason: 'stalled' };
          }
        }
        recordProviderLatency(p.name, Date.now() - t, false);
        return { ok: true, provider: p.name, model: p.pinnedModel, latencyMs: Date.now() - t, raced: false };
      } catch (err: any) {
        setCooldown(p.name, cooldownSeconds(err));
        recordProviderLatency(p.name, 0, true);
        console.warn(`[STREAM] ${p.name} failed: ${String(err?.message).slice(0, 60)} — next rung`);
      } finally { this.release(p.name); }
    }
    // Every rung failed. An HONEST refusal, never a silent escalation to something dearer — the same
    // posture `buildProfessionalFreeFallback` states for the free build path.
    if (!signal?.aborted) onChunk('AI service temporarily busy. Please try again. 🙏');
    return { ok: false, reason: 'all-failed' };
  }

  async routeStream(
    prompt: string,
    systemPrompt: string | undefined,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<StreamOutcome> {
    if (signal?.aborted) return { ok: false, reason: 'aborted' };

    // Get available providers (skip cooldowns on first pass)
    const available = this.providers.filter(p => !isOnCooldown(p.name) && p.executeStream);
    const allProviders = available.length > 0 ? available : this.providers.filter(p => p.executeStream);

    if (allProviders.length === 0) {
      if (!signal?.aborted) onChunk('AI service temporarily unavailable. 🙏');
      return { ok: false, reason: 'no-provider' };
    }

    const [p1, p2, ...rest] = allProviders;

    // 🔴 A RACE COSTS TWO MODELS AND BUYS ONE SECOND. See `streamRacePolicy.ts`: starting the top two
    // providers concurrently bills BOTH — the loser's answer is discarded, its invoice is not. On the
    // FREE universe that meant every single turn also paid for the second rung (which, until the money
    // audit of 2026-09-12, was `gemini-2.5-pro` at $10/MTok). Paid universes still race; free walks the
    // ladder, paying for a second model only when the first genuinely failed.
    if (!p2 || !shouldRaceStreams(this.universe)) {
      return await this.streamSequential(allProviders, prompt, systemPrompt, onChunk, signal);
    }

    // Race p1 and p2
    const raceStartedAt = Date.now();
    let lastChunkAt = raceStartedAt;
    let committed: string | null = null;
    let commitResolve!: () => void;
    const commitPromise = new Promise<void>(res => { commitResolve = res; });

    const runStream = (p: typeof p1, index: number): Promise<void> => {
      if (!this.acquire(p.name)) return Promise.resolve();
      const t = Date.now();
      return p.executeStream!(prompt, systemPrompt, (chunk) => {
        if (signal?.aborted) return;
        lastChunkAt = Date.now(); // the moving target the idle bound below watches
        if (!committed) {
          committed = p.name;
          console.log(`[RACE_STREAM] ${p.name} (p${index+1}) won — committing`);
          commitResolve();
        }
        if (committed === p.name) onChunk(chunk);
      }).then(() => {
        recordProviderLatency(p.name, Date.now() - t, false);
      }).catch((err: any) => {
        setCooldown(p.name, cooldownSeconds(err));
        recordProviderLatency(p.name, 0, true);
        console.warn(`[RACE_STREAM] ${p.name} failed: ${err?.message?.slice(0, 60)}`);
      }).finally(() => {
        this.release(p.name);
        // If this was the committed provider and it's done, resolve
        if (committed === p.name) commitResolve();
      });
    };

    const s1 = runStream(p1, 0);
    const s2 = runStream(p2, 1);

    // Wait for commit (first chunk from either) with 12s timeout
    const commitTimeout = new Promise<void>(res => setTimeout(() => { commitResolve(); res(); }, 12000));
    await Promise.race([commitPromise, commitTimeout]);

    if (!committed) {
      // Neither committed in time — walk the REST of the ladder, one rung at a time. Same walker the
      // free universe uses, so "what happens when a rung fails" has one implementation, not two.
      console.warn('[RACE_STREAM] No commit in 12s — trying sequential fallbacks');
      return await this.streamSequential(rest, prompt, systemPrompt, onChunk, signal);
    }

    // 🔎 SIBLING (rule 3): the 12-second COMMIT timeout above only asks "did anyone start speaking?".
    // This final await used to be as unbounded as the sequential path's, so a provider that spoke one
    // word and then hung stalled a PRO/PROFESSIONAL turn for ever. Bounded by SILENCE, same rule.
    const winner = committed === p1.name ? p1 : p2;
    const committedStream = committed === p1.name ? s1 : s2;
    const raceLimits = watchdogLimits();
    let stalled = false;
    if (!raceLimits) {
      await committedStream.catch(() => {});
    } else {
      const verdict = await awaitWithIdleBound(committedStream, () => lastChunkAt, raceStartedAt, raceLimits);
      if (verdict !== 'completed') {
        stalled = true;
        console.warn(`[RACE_STREAM] ${winner.name} ${verdict} after committing — ending the turn`);
      }
    }
    return {
      ok: true, provider: winner.name, model: winner.pinnedModel,
      latencyMs: Date.now() - raceStartedAt, raced: true,
      ...(stalled ? { reason: 'stalled' as const } : {}),
    };
  }

  private async execute(prompt: string, schema?: any, systemPrompt?: string, images?: string[], modelOverride?: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    const targetSchema = schema?.type === 'OBJECT' ? schema : undefined;
    const errors: string[] = [];
    // Providers actually invoked this request. Pass 2 exists to retry providers that pass 1 SKIPPED
    // (cooldown), NOT to re-run one that already ran and failed — re-invoking a provider that just
    // failed deterministically (e.g. a 400 on a malformed prompt) only doubles latency and spend.
    const attempted = new Set<string>();

    // Pass 1: skip providers on cooldown — try fast path first
    // Pass 2: if all on cooldown, try them anyway (better than error) — but never a provider we
    //         already attempted (and failed) in pass 1.
    for (const pass of [1, 2]) {
      for (const provider of this.providers) {
        if (pass === 2 && attempted.has(provider.name)) continue;

        const onCooldown = isOnCooldown(provider.name);
        if (pass === 1 && onCooldown) {
          console.log(`[CIRCUIT] Skipping ${provider.name} (cooldown active)`);
          continue;
        }

        const isHealthy = await provider.healthCheck().catch(() => false);
        if (!isHealthy) {
          console.log(`[ROUTER] ${provider.name} healthCheck=false, skipping`);
          continue;
        }

        const concurrent = this.inFlightCount(provider.name);
        if (concurrent >= MAX_IN_FLIGHT) {
          console.log(`[CAPACITY] ${provider.name} at max ${MAX_IN_FLIGHT} concurrent, skipping`);
          continue;
        }
        if (!this.acquire(provider.name)) continue;
        attempted.add(provider.name); // committed to actually calling this provider now
        try {
          const startTime = Date.now();
          console.log(`[ROUTER] Trying ${provider.name} (pass ${pass}, in-flight ${concurrent + 1})...`);
          const response = assertNonEmpty(
            await provider.execute(prompt, targetSchema, modelOverride, systemPrompt, images),
            provider.name,
          );
          const latency = Date.now() - startTime;
          console.log(`[ROUTER] ${provider.name} SUCCESS in ${latency}ms`);
          recordProviderLatency(provider.name, latency, false);
          recordRouterOutcome(true);

          return {
            response,
            telemetry: {
              provider: provider.name,
              retries: errors.length,
              latency,
              success: true,
              // Populated when ≥1 higher-priority provider failed before this one succeeded
              fallbackReason: errors.length > 0 ? `Skipped: ${errors.slice(0, 3).join('; ')}` : undefined,
            },
          };
        } catch (error: any) {
          const secs = cooldownSeconds(error);
          console.error(`[ROUTER] ${provider.name} FAILED (${error?.message?.slice(0, 80)}), cooldown ${secs}s`);
          setCooldown(provider.name, secs);
          recordProviderLatency(provider.name, 0, true);
          errors.push(`${provider.name}: ${error?.message?.slice(0, 60)}`);
        } finally {
          this.release(provider.name);
        }
      }
    }

    // All 4 providers failed both passes — last-resort graceful message
    console.error('[ROUTER] ALL PROVIDERS FAILED:', errors);
    recordRouterOutcome(false);
    return {
      response: {
        content: 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏',
        latencyMs: 0,
        provider: 'GEMINI',
        model: 'fallback',
      },
      telemetry: { provider: 'NONE', retries: errors.length, latency: 0, success: false },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 A LADDER RUNG THAT FAILED IS NOT A USER WHO WAS REFUSED (admin Monitor capture, 2026-09-18).
//
// The admin's board showed **AI load: 50% refused**, in red, under the words *"Engines are refusing
// requests."* Nobody had been refused. `recordProviderLatency` is called once per ATTEMPT, and this
// router's whole design is to walk down a ladder: the free leader is rate-limited, the next rung
// answers, the user gets their reply. That is one success and one error, which is exactly 50%.
//
// So the number rose when the fallback was doing its job, and it reset to nothing on every deploy,
// which is how a two-attempt sample came to be painted as a platform-wide refusal rate.
//
// The honest question is per REQUEST: did this person get an answer? That is what these two counters
// hold, and the per-provider accumulator below is left exactly as it is — it answers a different,
// still-useful question (which vendor is flaky), and the admin board simply stopped asking it the
// wrong one.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const routerOutcomes = { requests: 0, failed: 0 };

/** Record ONE user-facing routing request and whether the user ended up with an answer. */
export function recordRouterOutcome(success: boolean): void {
  routerOutcomes.requests += 1;
  if (!success) routerOutcomes.failed += 1;
}

/**
 * Requests served by this process since boot, and how many ended with NO answer from any provider.
 *
 * ⚠️ Per PROCESS and since BOOT, like every counter in this module — it resets on each deploy. A
 * caller that grades it must say so, or a small sample reads as a platform verdict.
 */
export function getRouterOutcomeStats(): { requests: number; failed: number } {
  return { ...routerOutcomes };
}

/** Test-only reset. */
export function _resetRouterOutcomes(): void {
  routerOutcomes.requests = 0;
  routerOutcomes.failed = 0;
}

// Per-provider latency accumulator for stats
const latencyAccum = new Map<string, { total: number; count: number; errors: number }>();

export function recordProviderLatency(name: string, latencyMs: number, failed: boolean) {
  const cur = latencyAccum.get(name) || { total: 0, count: 0, errors: 0 };
  latencyAccum.set(name, {
    total: cur.total + (failed ? 0 : latencyMs),
    count: cur.count + 1,
    errors: cur.errors + (failed ? 1 : 0),
  });
  // P1.3 — success is the single chokepoint that closes the breaker (every router
  // success path funnels through here with failed=false). Failures open it via setCooldown.
  if (!failed) markProviderSuccess(name);
  // P2.1 — emit a child tracing span for this AI provider call under the active request
  // trace (no-op outside a request). Best-effort, never throws.
  tracer.recordChildSpan(`ai.provider.${name}`, latencyMs, failed ? 'error' : 'ok', { provider: name, success: !failed });
}

export function getProviderStats(): Record<string, { cooldownUntil: number; circuitState: string; consecutiveFailures: number; inFlight: number; inFlightByUniverse: Record<string, number>; avgLatencyMs: number; errorCount: number; requestCount: number }> {
  const result: Record<string, any> = {};
  // P2.3 — in-flight is now keyed `${universe}:${provider}`. Aggregate it back per
  // provider name (total + per-universe breakdown) so the Admin dashboard shape is kept
  // and the bulkhead pools are visible.
  const inFlightTotal = new Map<string, number>();
  const inFlightByUniverse = new Map<string, Record<string, number>>();
  for (const [key, count] of inFlight.entries()) {
    const sep = key.indexOf(':');
    const universe = sep >= 0 ? key.slice(0, sep) : 'default';
    const name = sep >= 0 ? key.slice(sep + 1) : key;
    inFlightTotal.set(name, (inFlightTotal.get(name) || 0) + count);
    const byU = inFlightByUniverse.get(name) || {};
    byU[universe] = (byU[universe] || 0) + count;
    inFlightByUniverse.set(name, byU);
  }
  const allNames = new Set([...allBreakerNames(), ...inFlightTotal.keys(), ...latencyAccum.keys()]);
  for (const name of allNames) {
    const acc = latencyAccum.get(name) || { total: 0, count: 0, errors: 0 };
    const breaker = getBreaker(name).snapshot();
    result[name] = {
      cooldownUntil: breaker.openedUntil,
      circuitState: breaker.state,
      consecutiveFailures: breaker.consecutiveFailures,
      inFlight: inFlightTotal.get(name) || 0,
      inFlightByUniverse: inFlightByUniverse.get(name) || {},
      avgLatencyMs: acc.count > 0 ? Math.round(acc.total / Math.max(1, acc.count - acc.errors)) : 0,
      errorCount: acc.errors,
      requestCount: acc.count,
    };
  }
  return result;
}
