import { AIProvider, AIProviderResponse, ProviderTelemetry } from './ProviderTypes';
import { providerCooldownStore } from '../../lib/ProviderCooldownStore';
import { getBreaker, allBreakerNames } from './CircuitBreaker';
import { tracer } from '../../observability/Tracer';

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

  async routeStream(
    prompt: string,
    systemPrompt: string | undefined,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) return;

    // Get available providers (skip cooldowns on first pass)
    const available = this.providers.filter(p => !isOnCooldown(p.name) && p.executeStream);
    const allProviders = available.length > 0 ? available : this.providers.filter(p => p.executeStream);

    if (allProviders.length === 0) {
      if (!signal?.aborted) onChunk('AI service temporarily unavailable. 🙏');
      return;
    }

    // ── Race top 2 providers: first chunk sent commits that provider ─────────
    const [p1, p2, ...rest] = allProviders;

    if (!p2) {
      // Only one available — use it directly
      if (!this.acquire(p1.name)) { onChunk('AI service at capacity. Try again.'); return; }
      const t = Date.now();
      try {
        await p1.executeStream!(prompt, systemPrompt, onChunk);
        recordProviderLatency(p1.name, Date.now() - t, false);
      } catch (err: any) {
        setCooldown(p1.name, cooldownSeconds(err));
        recordProviderLatency(p1.name, 0, true);
        if (!signal?.aborted) onChunk('AI service temporarily busy. Please try again. 🙏');
      } finally { this.release(p1.name); }
      return;
    }

    // Race p1 and p2
    let committed: string | null = null;
    let commitResolve!: () => void;
    const commitPromise = new Promise<void>(res => { commitResolve = res; });

    const runStream = (p: typeof p1, index: number): Promise<void> => {
      if (!this.acquire(p.name)) return Promise.resolve();
      const t = Date.now();
      return p.executeStream!(prompt, systemPrompt, (chunk) => {
        if (signal?.aborted) return;
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
      // Neither committed in time — try sequential fallbacks
      console.warn('[RACE_STREAM] No commit in 12s — trying sequential fallbacks');
      for (const p of rest) {
        if (signal?.aborted || !p.executeStream) continue;
        if (!this.acquire(p.name)) continue;
        const t = Date.now();
        try {
          await p.executeStream(prompt, systemPrompt, onChunk);
          recordProviderLatency(p.name, Date.now() - t, false);
          this.release(p.name);
          return;
        } catch (err: any) {
          setCooldown(p.name, cooldownSeconds(err));
          recordProviderLatency(p.name, 0, true);
          this.release(p.name);
        }
      }
      if (!signal?.aborted) onChunk('AI service temporarily busy. Please try again in 1-2 minutes. 🙏');
      return;
    }

    // Wait for the committed provider to finish its stream
    if (committed === p1.name) await s1.catch(() => {});
    else await s2.catch(() => {});
  }

  private async execute(prompt: string, schema?: any, systemPrompt?: string, images?: string[], modelOverride?: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    const targetSchema = schema?.type === 'OBJECT' ? schema : undefined;
    const errors: string[] = [];

    // Pass 1: skip providers on cooldown — try fast path first
    // Pass 2: if all on cooldown, try them anyway (better than error)
    for (const pass of [1, 2]) {
      for (const provider of this.providers) {
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
