import { AIProvider, AIProviderResponse, ProviderTelemetry } from './ProviderTypes';

// Per-provider cooldown tracker (module-level singleton — shared across all requests)
const cooldownUntil = new Map<string, number>();
// Per-provider in-flight request counter (concurrency limiter)
const inFlight = new Map<string, number>();
const MAX_IN_FLIGHT = 8;

function isOnCooldown(name: string): boolean {
  return Date.now() < (cooldownUntil.get(name) || 0);
}

function setCooldown(name: string, seconds: number) {
  const until = Date.now() + seconds * 1000;
  cooldownUntil.set(name, until);
  console.log(`[CIRCUIT] ${name} on cooldown for ${seconds}s (until ${new Date(until).toISOString()})`);
}

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

  registerProvider(provider: AIProvider) {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  async route(prompt: string, systemPrompt?: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    return this.execute(prompt, undefined, systemPrompt);
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
      if (!acquireSlot(p1.name)) { onChunk('AI service at capacity. Try again.'); return; }
      const t = Date.now();
      try {
        await p1.executeStream!(prompt, systemPrompt, onChunk);
        recordProviderLatency(p1.name, Date.now() - t, false);
      } catch (err: any) {
        setCooldown(p1.name, cooldownSeconds(err));
        recordProviderLatency(p1.name, 0, true);
        if (!signal?.aborted) onChunk('AI service temporarily busy. Please try again. 🙏');
      } finally { releaseSlot(p1.name); }
      return;
    }

    // Race p1 and p2
    let committed: string | null = null;
    let commitResolve!: () => void;
    const commitPromise = new Promise<void>(res => { commitResolve = res; });

    const runStream = (p: typeof p1, index: number): Promise<void> => {
      if (!acquireSlot(p.name)) return Promise.resolve();
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
        releaseSlot(p.name);
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
        if (!acquireSlot(p.name)) continue;
        const t = Date.now();
        try {
          await p.executeStream(prompt, systemPrompt, onChunk);
          recordProviderLatency(p.name, Date.now() - t, false);
          releaseSlot(p.name);
          return;
        } catch (err: any) {
          setCooldown(p.name, cooldownSeconds(err));
          recordProviderLatency(p.name, 0, true);
          releaseSlot(p.name);
        }
      }
      if (!signal?.aborted) onChunk('AI service temporarily busy. Please try again in 1-2 minutes. 🙏');
      return;
    }

    // Wait for the committed provider to finish its stream
    if (committed === p1.name) await s1.catch(() => {});
    else await s2.catch(() => {});
  }

  private async execute(prompt: string, schema?: any, systemPrompt?: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
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

        const concurrent = inFlight.get(provider.name) || 0;
        if (concurrent >= MAX_IN_FLIGHT) {
          console.log(`[CAPACITY] ${provider.name} at max ${MAX_IN_FLIGHT} concurrent, skipping`);
          continue;
        }
        if (!acquireSlot(provider.name)) continue;
        try {
          const startTime = Date.now();
          console.log(`[ROUTER] Trying ${provider.name} (pass ${pass}, in-flight ${concurrent + 1})...`);
          const response = await provider.execute(prompt, targetSchema, undefined, systemPrompt);
          const latency = Date.now() - startTime;
          console.log(`[ROUTER] ${provider.name} SUCCESS in ${latency}ms`);
          recordProviderLatency(provider.name, latency, false);

          return {
            response,
            telemetry: { provider: provider.name, retries: errors.length, latency, success: true },
          };
        } catch (error: any) {
          const secs = cooldownSeconds(error);
          console.error(`[ROUTER] ${provider.name} FAILED (${error?.message?.slice(0, 80)}), cooldown ${secs}s`);
          setCooldown(provider.name, secs);
          recordProviderLatency(provider.name, 0, true);
          errors.push(`${provider.name}: ${error?.message?.slice(0, 60)}`);
        } finally {
          releaseSlot(provider.name);
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
}

export function getProviderStats(): Record<string, { cooldownUntil: number; inFlight: number; avgLatencyMs: number; errorCount: number; requestCount: number }> {
  const result: Record<string, any> = {};
  const allNames = new Set([...cooldownUntil.keys(), ...inFlight.keys(), ...latencyAccum.keys()]);
  for (const name of allNames) {
    const acc = latencyAccum.get(name) || { total: 0, count: 0, errors: 0 };
    result[name] = {
      cooldownUntil: cooldownUntil.get(name) || 0,
      inFlight: inFlight.get(name) || 0,
      avgLatencyMs: acc.count > 0 ? Math.round(acc.total / Math.max(1, acc.count - acc.errors)) : 0,
      errorCount: acc.errors,
      requestCount: acc.count,
    };
  }
  return result;
}
