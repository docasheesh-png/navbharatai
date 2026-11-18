import { assertFreeAnswerDispatch, currentFreeAnswerSignal } from '../../lib/freeAnswerQuotaContext';
import { strictFreeRequired, StrictFreeCapabilityError } from '../inferencePolicy';
import { strictFreeText } from '../LiveRegistry/runtime';
import type { FreeTextResult } from '../LiveRegistry/dispatcher';
import { assertAiAvailable } from '../../lib/aiMaintenance';
import { freeBusyMessage, isFreeTierUniverse } from '../../lib/freeBusyMessage';
import { maybeGatewayText } from '../InferenceGateway/runtime';

import { AIProvider, AIProviderResponse, ProviderTelemetry } from './ProviderTypes';
import { providerCooldownStore } from '../../lib/ProviderCooldownStore';
import { getBreaker, allBreakerNames } from './CircuitBreaker';
import { tracer } from '../../observability/Tracer';
import { shouldRaceStreams } from './streamRacePolicy';
import { noteProviderCall, providerInFlight, shouldSkipProvider } from '../ProviderHealth/trafficHealth';

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
  freeChain?: import('../FreeChain/telemetry').FreeChainTelemetry;
  inferenceGateway?: AIProviderResponse['inferenceGateway'];
  gatewayPricingProof?: AIProviderResponse['gatewayPricingProof'];
  usage?: AIProviderResponse['usage'];
  pricingProof?: FreeTextResult['pricingProof'];
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

export function acquireSlot(name: string): boolean {
  const count = inFlight.get(name) || 0;
  if (count >= MAX_IN_FLIGHT) return false;
  inFlight.set(name, count + 1);
  return true;
}

export function releaseSlot(name: string) {
  inFlight.set(name, Math.max(0, (inFlight.get(name) || 1) - 1));
}

/**
 * Does this failure say something about the PROVIDER's health — or only about THIS request? PURE.
 *
 * 🔴 FORENSIC AUDIT 2026-10-04 (P1, breaker poisoning). Every failure opened the provider-wide breaker,
 * shared across instances and escalating to minutes. A 400 caused by one caller's input (a prompt over
 * the context window, a malformed request, a refused content class) therefore benched the free leader
 * for EVERY user, pushing all free chat onto paid rungs — and a script sending an oversized prompt every
 * few seconds could keep it there. Only a failure that the next caller would also hit opens the breaker:
 * rate limits, quota, 5xx/overload, timeouts, network errors, a dead key, an empty answer. A request
 * the provider refused BECAUSE of the request fails that request alone.
 */
export function isProviderHealthFailure(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown; code?: unknown } | null;
  const status = Number(e?.status ?? e?.statusCode ?? NaN);
  const msg = String(e?.message ?? '').toLowerCase();
  if (Number.isFinite(status)) {
    if (status === 429 || status >= 500 || status === 401 || status === 403 || status === 408) return true;
    if (status >= 400 && status < 500) return false;
  }
  if (/\b(?:400|413|422)\b/.test(msg) || /context (?:length|window)|too long|maximum context|max(?:imum)? tokens|invalid (?:request|argument)|bad request|unsupported|content policy|safety|blocked/.test(msg)) {
    return false;
  }
  return true;
}

/** Record a failure: the provider's breaker opens only for a provider-health failure (see above). */
function noteProviderFailure(name: string, error: unknown): void {
  if (!isProviderHealthFailure(error)) {
    console.warn(`[CIRCUIT] ${name} refused THIS request (${String((error as { message?: unknown })?.message ?? '').slice(0, 80)}) — breaker left closed`);
    return;
  }
  setCooldown(name, cooldownSeconds(error));
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
  private trafficSurface(): 'chat' | 'professional' {
    return this.universe.includes('professional') ? 'professional' : 'chat';
  }
  private managedTrafficHealth(name: string): boolean { return this.providers.some(p => p.name === name && p.managesTrafficHealth); }
  private acquire(name: string): boolean {
    // Claim a recovery probe only at the actual dispatch boundary, after health/capacity checks.
    if (this.inFlightCount(name) >= MAX_IN_FLIGHT || (!this.managedTrafficHealth(name) && shouldSkipProvider(name))) return false;
    if (!acquireSlot(this.slotKey(name))) return false;
    if (!this.managedTrafficHealth(name)) providerInFlight(name, 1);
    return true;
  }
  private release(name: string): void { releaseSlot(this.slotKey(name)); if (!this.managedTrafficHealth(name)) providerInFlight(name, -1); }
  private inFlightCount(name: string): number { return inFlight.get(this.slotKey(name)) || 0; }

  private async routeVerifiedFree(prompt: string, systemPrompt?: string, schema?: unknown, images?: string[], modelOverride?: string, signal?: AbortSignal): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    await assertAiAvailable();
    if (schema || images?.length || modelOverride) throw new StrictFreeCapabilityError('unsupported-schema-image-or-model-override');
    const response = await strictFreeText({ prompt, systemPrompt, signal });
    return { response, telemetry: { provider: response.provider, retries: 0, latency: response.latencyMs, success: true } };
  }

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

  async route(prompt: string, systemPrompt?: string, images?: string[], modelOverride?: string, signal?: AbortSignal): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    return this.execute(prompt, undefined, systemPrompt, images, modelOverride, signal);
  }

  /**
   * RACED routing (used by the PROFESSIONAL universe): fire all non-last-resort
   * providers CONCURRENTLY and return the first non-empty success (Promise.any).
   * Only if every racer fails do we fall back — sequentially — to the last-resort
   * provider(s) (e.g. Claude Haiku). This gives the lowest-latency answer while
   * keeping Claude strictly as the final safety net (Grok-primary/Claude-last law).
   */
  async routeRaced(prompt: string, systemPrompt?: string, images?: string[], signal?: AbortSignal): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    // Selected gateway turns own their complete sequential fallback chain. They
    // must never enter this legacy speculative race, including on refusal/error.
    signal = signal ?? currentFreeAnswerSignal();
    assertFreeAnswerDispatch(); signal?.throwIfAborted();
    const gateway = await maybeGatewayText({ prompt, systemPrompt, images, signal });
    if (gateway) return { response: gateway, telemetry: { provider: gateway.provider, retries: 0, latency: gateway.latencyMs, success: gateway.ok } };
    if (strictFreeRequired()) return this.routeVerifiedFree(prompt, systemPrompt, undefined, images, undefined, signal);
    await assertAiAvailable();
    signal?.throwIfAborted();
    const racers = this.providers.filter(p => !p.lastResort);
    const fallbacks = this.providers.filter(p => p.lastResort);
    const errors: string[] = [];

    // Eligible racers: healthy, not on cooldown, with capacity.
    const eligible: AIProvider[] = [];
    for (const p of racers) {
      signal?.throwIfAborted();
      if (isOnCooldown(p.name)) { console.log(`[RACE] skip ${p.name} (cooldown)`); continue; }
      assertFreeAnswerDispatch();
      const healthy = await p.healthCheck().catch(() => false);
      signal?.throwIfAborted();
      if (!healthy) { console.log(`[RACE] skip ${p.name} (unhealthy)`); continue; }
      if (this.inFlightCount(p.name) >= MAX_IN_FLIGHT) { console.log(`[RACE] skip ${p.name} (at capacity)`); continue; }
      eligible.push(p);
    }

    if (eligible.length > 0) {
      console.log(`[RACE] racing: ${eligible.map(p => p.name).join(' × ')}`);
      const attempts = eligible.map(async (p) => {
        if (!this.acquire(p.name)) throw new Error(`${p.name}: no slot`);
        const t = Date.now();
        try {
          assertFreeAnswerDispatch(); signal?.throwIfAborted();
          const response = assertNonEmpty(await p.execute(prompt, undefined, undefined, systemPrompt, images, signal), p.name);
          signal?.throwIfAborted();
          recordProviderLatency(p.name, Date.now() - t, false, { surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
          return { response, name: p.name };
        } catch (err: any) {
          // Genuine failure → cool the provider down. (Slow-but-successful losers
          // resolve instead of rejecting, so they are never wrongly penalized.)
          signal?.throwIfAborted();
          noteProviderFailure(p.name, err);
          recordProviderLatency(p.name, 0, true, { error: err, surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
          errors.push(`${p.name}: ${String(err?.message).slice(0, 60)}`);
          throw err;
        } finally {
          this.release(p.name);
        }
      });
      try {
        const winner = await Promise.any(attempts);
        signal?.throwIfAborted();
        console.log(`[RACE] won by ${winner.name}`);
        recordRouterOutcome(true);
        return {
          response: winner.response,
          telemetry: { provider: winner.name, retries: errors.length, latency: winner.response.latencyMs, success: true },
        };
      } catch {
        signal?.throwIfAborted();
        console.warn('[RACE] all racers failed → last resort');
      }
    }

    // Last-resort fallback (sequential) — e.g. Claude Haiku.
    for (const p of fallbacks) {
      signal?.throwIfAborted();
      assertFreeAnswerDispatch();
      const healthy = await p.healthCheck().catch(() => false);
      signal?.throwIfAborted();
      if (!healthy) continue;
      if (!this.acquire(p.name)) continue;
      const t = Date.now();
      try {
        console.log(`[RACE] last-resort: ${p.name}`);
        assertFreeAnswerDispatch(); signal?.throwIfAborted();
        const response = assertNonEmpty(await p.execute(prompt, undefined, undefined, systemPrompt, images, signal), p.name);
        signal?.throwIfAborted();
        recordProviderLatency(p.name, Date.now() - t, false, { surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
        recordRouterOutcome(true);
        return {
          response,
          telemetry: { provider: p.name, retries: errors.length, latency: response.latencyMs, success: true, fallbackReason: errors.length ? `Race failed: ${errors.slice(0, 3).join('; ')}` : undefined },
        };
      } catch (err: any) {
        signal?.throwIfAborted();
        noteProviderFailure(p.name, err);
        recordProviderLatency(p.name, 0, true, { error: err, surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
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
      assertFreeAnswerDispatch();
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
    onChunk: (text: string, source?: 'notice') => void,
    signal?: AbortSignal,
  ): Promise<StreamOutcome> {
    for (const p of providers) {
      await assertAiAvailable();
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      if (!p.executeStream) continue;
      if (!this.acquire(p.name)) continue;
      const t = Date.now();
      const attempt = new AbortController();
      const attemptSignal = signal ? AbortSignal.any([signal, attempt.signal]) : attempt.signal;
      let physical: Promise<string> | undefined;
      let released = false;
      const release = () => { if (!released) { released = true; this.release(p.name); } };
      let delivered = false;
      let active = true;
      let prefix = '';
      // Commit only actual answer text. A whitespace/reasoning-only stream may safely
      // fall back; once visible text is sent, this turn must never mix in another answer.
      const run = (cb: (text: string) => void) => {
        physical = Promise.resolve().then(() => {
          assertFreeAnswerDispatch(); attemptSignal.throwIfAborted();
          return p.executeStream!(prompt, systemPrompt, (text) => {
            if (!active || attemptSignal.aborted || !text) return;
            if (!delivered) {
              prefix += text;
              if (!prefix.trim()) return;
              delivered = true;
              text = prefix;
              prefix = '';
            }
            cb(text);
          }, undefined, attemptSignal);
        });
        // A watchdog ends the observer, not physical occupancy. Both settlement branches release
        // exactly once; a non-cooperative SDK keeps its slot instead of multiplying zombie calls.
        void physical.then(release, release);
        return physical;
      };
      try {
        // 🔴 THE ONLY THING THAT COULD END A STREAMED TURN WAS THE CLIENT DISCONNECTING (2026-09-17).
        // This `await` had no bound of any kind, so a provider that accepted the connection and then
        // never spoke stalled the turn for ever — and chat.ts's 20-second keepalive ping held the dead
        // turn open. The bound is SILENCE, not duration (see streamWatchdog.ts), so a slow provider
        // that is still emitting is never cut off. `CHAT_STREAM_WATCHDOG=off` restores this exact line.
        //
        // 🔴 AND `signal` IS WHAT MAKES THE DISCONNECT COST NOTHING (Q-621, second half). Until it
        // was threaded through here, this method only checked `signal.aborted` BETWEEN rungs: the
        // request already in flight ran to completion and was billed in full, so a user who closed
        // the tab after one word still paid for the whole answer.
        assertFreeAnswerDispatch(); signal?.throwIfAborted();
        const limits = watchdogLimits(process.env, this.universe);
        if (!limits) {
          await run(onChunk);
        } else {
          const watched = await runWatchedStream(
            run,
            onChunk,
            limits,
          );
          if (watched.verdict !== 'completed' && watched.verdict !== 'failed') attempt.abort(new Error(watched.verdict));
          if (signal?.aborted) return { ok: false, reason: 'aborted' };
          if (watched.verdict === 'failed') throw watched.error ?? new Error('stream failed');
          if (mayTryNextRung(watched)) {
            // Nothing reached the user, so the next rung can answer with nothing duplicated. The
            // provider is benched: it accepted a request and did not answer, which is a real failure
            // however it looks from the outside.
            setCooldown(p.name, cooldownSeconds(new Error(watched.verdict)));
            recordProviderLatency(p.name, 0, true, { error: new Error(watched.verdict), surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
            console.warn(`[STREAM] ${p.name} ${watched.verdict} — next rung`);
            continue;
          }
          if (watched.verdict !== 'completed') {
            // Text is already on screen. A second rung would repeat itself, so the turn ends here with
            // what was delivered — partial and honest beats duplicated.
            recordProviderLatency(p.name, Date.now() - t, false, { surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
            console.warn(`[STREAM] ${p.name} ${watched.verdict} after delivering — ending the turn`);
            return { ok: true, provider: p.name, model: p.pinnedModel, latencyMs: Date.now() - t, raced: false, reason: 'stalled' };
          }
        }
        if (signal?.aborted) return { ok: false, reason: 'aborted' };
        if (!delivered) throw new Error('stream produced no content');
        recordProviderLatency(p.name, Date.now() - t, false, { surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
        return { ok: true, provider: p.name, model: p.pinnedModel, latencyMs: Date.now() - t, raced: false };
      } catch (err: any) {
        if (signal?.aborted) return { ok: false, reason: 'aborted' };
        noteProviderFailure(p.name, err);
        recordProviderLatency(p.name, 0, true, { error: err, surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
        if (delivered) {
          console.warn(`[STREAM] ${p.name} failed after delivering — ending the turn`);
          return { ok: true, provider: p.name, model: p.pinnedModel, latencyMs: Date.now() - t, raced: false, reason: 'stalled' };
        }
        console.warn(`[STREAM] ${p.name} failed: ${String(err?.message).slice(0, 60)} — next rung`);
      } finally {
        active = false; attempt.abort();
        // Pre-dispatch fencing may throw before a provider promise exists. Otherwise that promise
        // alone owns release, including a late rejection after timeout or disconnect.
        if (!physical) release();
      }
    }
    // Every rung failed. An HONEST refusal, never a silent escalation to something dearer — the same
    // posture `buildProfessionalFreeFallback` states for the free build path.
    if (!signal?.aborted) onChunk(isFreeTierUniverse(this.universe) ? freeBusyMessage(prompt) : 'AI service temporarily busy. Please try again. 🙏', 'notice');
    return { ok: false, reason: 'all-failed' };
  }

  /**
   * 🔴 THE STREAMED TURN WAS INVISIBLE TO "AI LOAD" (admin Monitor capture, 2026-09-27). Chat streams,
   * and `recordRouterOutcome` was called only from `execute` and `routeRaced` — so the platform's "how
   * often did a user get no answer" figure was measured on everything EXCEPT the path that carries
   * nearly all the traffic. The fourth time the streaming path has been forgotten (see CLAUDE.md's money
   * audit). One outcome per streamed turn now; a turn the USER aborted is not counted either way,
   * because nothing was refused.
   */
  async routeStream(
    prompt: string,
    systemPrompt: string | undefined,
    onChunk: (text: string, source?: 'notice') => void,
    signal?: AbortSignal,
  ): Promise<StreamOutcome> {
    const gateway = await maybeGatewayText({ prompt, systemPrompt, onChunk, signal });
    if (gateway) return { ...gateway, raced: false };
    if (strictFreeRequired()) {
      await assertAiAvailable();
      const response = await strictFreeText({ prompt, systemPrompt, onChunk, signal });
      return { ok: true, provider: response.provider, model: response.model, latencyMs: response.latencyMs, usage: response.usage, pricingProof: response.pricingProof, raced: false };
    }
    const outcome = await this.routeStreamInner(prompt, systemPrompt, onChunk, signal);
    if (!(outcome.ok === false && outcome.reason === 'aborted')) recordRouterOutcome(outcome.ok === true);
    return outcome;
  }

  private async routeStreamInner(
    prompt: string,
    systemPrompt: string | undefined,
    onChunk: (text: string, source?: 'notice') => void,
    signal?: AbortSignal,
  ): Promise<StreamOutcome> {
    await assertAiAvailable();
    if (signal?.aborted) return { ok: false, reason: 'aborted' };

    // Get available providers (skip cooldowns on first pass)
    const available = this.providers.filter(p => !isOnCooldown(p.name) && p.executeStream);
    const allProviders = available.length > 0 ? available : this.providers.filter(p => p.executeStream);

    if (allProviders.length === 0) {
      if (!signal?.aborted) onChunk('AI service temporarily unavailable. 🙏', 'notice');
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

    // Race p1 and p2. Transport activity is not an answer: only visible output commits a racer.
    const raceStartedAt = Date.now();
    let lastChunkAt = raceStartedAt;
    let committed: string | null = null;
    let active = true;
    let commitResolve!: () => void;
    const commitPromise = new Promise<void>(res => { commitResolve = res; });
    type RaceTerminal = 'completed' | 'failed' | 'cancelled' | 'skipped';

    const runStream = (p: typeof p1, index: number): Promise<RaceTerminal> => {
      if (signal?.aborted) return Promise.resolve('cancelled');
      assertFreeAnswerDispatch();
      if (!this.acquire(p.name)) return Promise.resolve('skipped');
      const t = Date.now();
      let delivered = false;
      let prefix = '';
      let streaming = true;
      return (async (): Promise<RaceTerminal> => {
        try {
          // Keep the existing parent signal and both paid attempts. This does not cancel the loser.
          await p.executeStream!(prompt, systemPrompt, (chunk) => {
            if (!streaming || signal?.aborted || !chunk) return;
            if (!delivered) {
              prefix += chunk;
              if (!prefix.trim()) return;
              delivered = true;
              chunk = prefix;
              prefix = '';
            }
            // A loser may still finish (and is measured honestly), but a closed race cannot emit.
            if (!active) return;
            if (!committed) {
              committed = p.name;
              console.log(`[RACE_STREAM] ${p.name} (p${index+1}) won — committing`);
              commitResolve();
            }
            if (committed === p.name) {
              lastChunkAt = Date.now();
              onChunk(chunk);
            }
          }, undefined, signal);
          if (signal?.aborted) return 'cancelled';
          if (!delivered) throw new Error('stream produced no content');
          recordProviderLatency(p.name, Date.now() - t, false, { surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
          return 'completed';
        } catch (err: any) {
          // Only the observed caller signal proves cancellation. An adapter may implement a timeout
          // using AbortError too, so the error name alone must never hide a provider-health failure.
          if (signal?.aborted) return 'cancelled';
          noteProviderFailure(p.name, err);
          recordProviderLatency(p.name, 0, true, { error: err, surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(p.name) });
          console.warn(`[RACE_STREAM] ${p.name} failed: ${err?.message?.slice(0, 60)}`);
          return 'failed';
        } finally {
          streaming = false;
          this.release(p.name);
          if (committed === p.name) commitResolve();
        }
      })();
    };

    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const s1 = runStream(p1, 0);
      const s2 = runStream(p2, 1);
      // Preserve the existing 12-second commit budget and rest-of-ladder fallback policy.
      const commitTimeout = new Promise<void>(res => { commitTimer = setTimeout(res, 12000); });
      // Professional chat need not spend 12 seconds waiting for racers that have BOTH
      // already settled without output. Keep Pro/build timing unchanged. Waiting for both
      // physical promises also avoids starting an extra fallback beside an unfinished call.
      const commitWaiters = [commitPromise, commitTimeout];
      if (this.universe === 'professional') commitWaiters.push(Promise.all([s1, s2]).then(() => {}));
      await Promise.race(commitWaiters);
      if (commitTimer) clearTimeout(commitTimer);
      if (signal?.aborted) return { ok: false, reason: 'aborted' };

      if (!committed) {
        active = false; // Late racers must not interleave with the sequential fallback.
        console.warn('[RACE_STREAM] No committed output — trying sequential fallbacks');
        return await this.streamSequential(rest, prompt, systemPrompt, onChunk, signal);
      }

      const winner = committed === p1.name ? p1 : p2;
      const winnerStream = committed === p1.name ? s1 : s2;
      const raceLimits = watchdogLimits();
      // The idle waiter reports whether a promise settled, not whether its provider succeeded.
      // Retain the explicit terminal result so rejection/cancellation cannot become a clean finish.
      let terminal: RaceTerminal | undefined;
      const committedStream = winnerStream.then(result => { terminal = result; });
      let stalled = false;
      if (!raceLimits) {
        await committedStream;
      } else {
        const verdict = await awaitWithIdleBound(committedStream, () => lastChunkAt, raceStartedAt, raceLimits);
        stalled = verdict !== 'completed';
      }
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      stalled = stalled || terminal !== 'completed';
      if (stalled) console.warn(`[RACE_STREAM] ${winner.name} interrupted after committing — ending the turn`);
      return {
        ok: true, provider: winner.name, model: winner.pinnedModel,
        latencyMs: Date.now() - raceStartedAt, raced: true,
        ...(stalled ? { reason: 'stalled' as const } : {}),
      };
    } finally {
      active = false;
      if (commitTimer) clearTimeout(commitTimer);
    }
  }

  private async execute(prompt: string, schema?: any, systemPrompt?: string, images?: string[], modelOverride?: string, signal?: AbortSignal): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    // Keep the complete capability envelope. A schema, image or pinned model is
    // never silently downgraded to plain text when a selected route cannot serve it.
    signal = signal ?? currentFreeAnswerSignal();
    assertFreeAnswerDispatch(); signal?.throwIfAborted();
    const gateway = await maybeGatewayText({ prompt, systemPrompt, schema, images, modelOverride, signal });
    if (gateway) return { response: gateway, telemetry: { provider: gateway.provider, retries: 0, latency: gateway.latencyMs, success: gateway.ok } };
    if (strictFreeRequired()) return this.routeVerifiedFree(prompt, systemPrompt, schema, images, modelOverride, signal);
    await assertAiAvailable();
    signal?.throwIfAborted();
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
        signal?.throwIfAborted();
        if (pass === 2 && attempted.has(provider.name)) continue;

        const onCooldown = isOnCooldown(provider.name);
        if (pass === 1 && onCooldown) {
          console.log(`[CIRCUIT] Skipping ${provider.name} (cooldown active)`);
          continue;
        }

        await assertAiAvailable();
        signal?.throwIfAborted();
        assertFreeAnswerDispatch();
        const isHealthy = await provider.healthCheck().catch(() => false);
        signal?.throwIfAborted();
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
          assertFreeAnswerDispatch(); signal?.throwIfAborted();
          const response = assertNonEmpty(
            await provider.execute(prompt, targetSchema, modelOverride, systemPrompt, images, signal),
            provider.name,
          );
          signal?.throwIfAborted();
          const latency = Date.now() - startTime;
          console.log(`[ROUTER] ${provider.name} SUCCESS in ${latency}ms`);
          recordProviderLatency(provider.name, latency, false, { surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(provider.name) });
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
          signal?.throwIfAborted();
          console.error(`[ROUTER] ${provider.name} FAILED (${error?.message?.slice(0, 80)})`);
          noteProviderFailure(provider.name, error);
          recordProviderLatency(provider.name, 0, true, { error, surface: this.trafficSurface(), recordHealth: !this.managedTrafficHealth(provider.name) });
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
        content: isFreeTierUniverse(this.universe) ? freeBusyMessage(prompt) : 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏',
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

export function recordProviderLatency(name: string, latencyMs: number, failed: boolean, detail?: { error?: unknown; surface?: 'chat' | 'professional'; firstByteMs?: number; recordHealth?: boolean }) {
  const cur = latencyAccum.get(name) || { total: 0, count: 0, errors: 0 };
  latencyAccum.set(name, {
    total: cur.total + (failed ? 0 : latencyMs),
    count: cur.count + 1,
    errors: cur.errors + (failed ? 1 : 0),
  });
  try {
    if (detail?.recordHealth !== false) noteProviderCall({
      provider: name, surface: detail?.surface ?? 'chat', ok: !failed,
      totalMs: failed ? 0 : latencyMs, firstByteMs: detail?.firstByteMs, error: detail?.error,
    });
  } catch { /* health recording never changes the route */ }
  // P1.3 — success is the single chokepoint that closes the breaker (every router
  // success path funnels through here with failed=false). Failures open it via setCooldown.
  if (!failed) markProviderSuccess(name);
  // P2.1 — emit a child tracing span for this AI provider call under the active request
  // trace (no-op outside a request). Best-effort, never throws.
  tracer.recordChildSpan(`ai.provider.${name}`, latencyMs, failed ? 'error' : 'ok', { provider: name, success: !failed });
}

/**
 * What an admin panel lists as providers: every row except an idle concurrency pool (capacityOnly with nothing in
 * flight). A pool with calls in flight is kept, flagged, so the panel can say what it is. PURE over the stats.
 */
export function visibleProviderStats<T extends { capacityOnly?: boolean; inFlight?: number }>(stats: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(stats).filter(([, s]) => !(s.capacityOnly && !(Number(s.inFlight) > 0))));
}

export function getProviderStats(): Record<string, { cooldownUntil: number; circuitState: string; consecutiveFailures: number; inFlight: number; inFlightByUniverse: Record<string, number>; avgLatencyMs: number; errorCount: number; requestCount: number; capacityOnly: boolean }> {
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
  // A name known ONLY from the in-flight pool (no breaker, no recorded call) is a concurrency pool, not a
  // provider — e.g. the Free Chain claims `free-chat-chain:<account>` slots, whose calls are recorded under
  // `free-chat-chain:<rung>`. It is flagged so a panel never presents it as an engine that was "not used yet"
  // (admin 2026-11-04: `glm`, `groq`, `dsv4flash`, `cloudflare` twins of the real Free Chain rows).
  const breakerNames = new Set(allBreakerNames());
  const allNames = new Set([...breakerNames, ...inFlightTotal.keys(), ...latencyAccum.keys()]);
  for (const name of allNames) {
    const capacityOnly = !breakerNames.has(name) && !latencyAccum.has(name);
    const acc = latencyAccum.get(name) || { total: 0, count: 0, errors: 0 };
    // getBreaker CREATES a breaker for an unknown name — for a pool that would invent a provider (and make it
    // stop being capacity-only on the next read). A pool has no circuit: report it closed, untouched.
    const breaker = capacityOnly ? { openedUntil: 0, state: 'closed', consecutiveFailures: 0 } : getBreaker(name).snapshot();
    result[name] = {
      cooldownUntil: breaker.openedUntil,
      circuitState: breaker.state,
      consecutiveFailures: breaker.consecutiveFailures,
      inFlight: inFlightTotal.get(name) || 0,
      inFlightByUniverse: inFlightByUniverse.get(name) || {},
      avgLatencyMs: acc.count > 0 ? Math.round(acc.total / Math.max(1, acc.count - acc.errors)) : 0,
      errorCount: acc.errors,
      requestCount: acc.count,
      capacityOnly,
    };
  }
  return result;
}
